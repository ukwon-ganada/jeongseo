/* 법무법인 정서 PWA - 기일연기/변경신청서 (yeongi.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. index.html 에는 진입점 버튼 + <script src="yeongi.js"> 만 둔다.
   화면(입력폼)·전용 CSS 는 이 파일이 <body>에 1회 주입한다.

   흐름: goYeongi() → 입력폼(검색 자동완성) → [✨클로드로 사유 작성] → [📄 HWPX 다운로드]
     · 사유 작성 = Supabase Edge Function 'draft-yeongi'(Claude) 호출 (API키는 서버 시크릿)
     · HWPX 생성 = 이 파일이 templates/*.hwpx 를 JSZip 으로 채워 다운로드 (시크릿 불필요)

   분기:
     · 형사      : 피고인의 (국선)변호인, 단일 서명
     · 민사 동의  : 원고→피고 양측 소송대리인, '위 동의함', 위동의함부터 2페이지
     · 민사 부동의 / 대리인부존재 : 우리측 소송대리인만, 부동의 문구, 자동맞춤 v4

   의존: showScreen · initAutofillFor(autofill.js) · JU(util.js) · FSDoc(fsdoc.js)
        · SUPABASE_URL·SUPABASE_KEY(index.html) · JSZip(CDN)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var ATTORNEYS_SEED = ['서고은', '양선화', '이예나'];
  var ATTORNEYS_KEY = 'jeongseo_attorneys';
  var TPL = {
    criminal: './templates/yeongi_criminal.hwpx',
    consent: './templates/yeongi_civil_consent.hwpx',
    dissent: './templates/yeongi_civil_dissent.hwpx'
  };
  var BUDGET_PT = 590;        // A4 1장 예산(머리/꼬리말 반영 ~601pt - 여유)
  var ROLE_LABEL = {          // 상단 칸 라벨(정렬 공백 포함)
    '피고인': '피 고 인', '원고': '원    고', '피고': '피    고',
    '신청인': '신 청 인', '피신청인': '피신청인', '채권자': '채 권 자', '채무자': '채 무 자'
  };
  var INTRO_CIVIL = '위 사건에 관하여 {dt}으로 변론기일이 지정되었으나, 귀 재판부께서 다음과 같은 사유를 혜량해주시어 변론기일을 변경하여 주시기 요청드립니다.';
  var DISSENT_BODY = '상대방 소송대리인에게 그 동의를 구하였으나, 부동의하여 부득이 일방으로 제출하게 되었습니다.';
  var NOAGENT_BODY = '상대방의 소송대리인이 지정되어 있지 아니하여 그 동의를 구할 수 없어 부득이 일방으로 제출하게 되었습니다.';

  function esc(v) { return JU.esc(v); }
  function todayISO() { return JU.todayISO(); }
  function xmlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function loadAttorneys() { return FSDoc.roster(ATTORNEYS_KEY, ATTORNEYS_SEED).load(); }
  function saveAttorney(n) { FSDoc.roster(ATTORNEYS_KEY, ATTORNEYS_SEED).save(n); }
  function fnUrl(name) { return (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/' + name; }

  /* ══════════════════════════════════════════════════════════════
     HWPX 채우기 엔진 (Python 프로토타입 이식) — 서식 보존, 텍스트만 치환.
     ══════════════════════════════════════════════════════════════ */
  var PARA_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;

  function splitParas(sec) { return sec.match(PARA_RE) || []; }
  function headOf(sec, paras) { return sec.slice(0, sec.indexOf(paras[0])); }
  function tailOf(sec) { var i = sec.lastIndexOf('</hp:p>'); return sec.slice(i + 7); }
  function pText(p) {
    var out = '', re = /<hp:t>([\s\S]*?)<\/hp:t>/g, m;
    while ((m = re.exec(p))) out += m[1].replace(/<[^>]+>/g, '');
    return out;
  }
  // 첫 <hp:t> 내용 교체(내부 tab 등 제거)
  function setT(p, txt) { return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/, '<hp:t>' + xmlEsc(txt) + '</hp:t>'); }
  // n번째 <hp:t> 교체
  function setNthT(p, n, txt) {
    var i = -1;
    return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/g, function (m) { i++; return i === n ? '<hp:t>' + xmlEsc(txt) + '</hp:t>' : m; });
  }
  // charPrIDRef="9" 런 텍스트만 교체(선행 공백 런 보존) — 형사 담당변호사
  function setRun9(p, txt) {
    return p.replace(/(charPrIDRef="9"><hp:t>)[\s\S]*?(<\/hp:t>)/, '$1' + xmlEsc(txt) + '$2');
  }
  function setPB(p) { return p.replace(/pageBreak="0"/, 'pageBreak="1"'); }

  function units(t) { var u = 0; for (var i = 0; i < t.length; i++) u += t.charCodeAt(i) >= 0x1100 ? 1 : 0.5; return u; }
  function estimateList(paras, hdr, sp220) {
    var ls = {}, ch = {}, m;
    var lre = /<hh:paraPr id="(\d+)"[\s\S]*?<hh:lineSpacing[^>]*value="(\d+)"/g;
    while ((m = lre.exec(hdr))) ls[m[1]] = parseInt(m[2], 10);
    var cre = /<hh:charPr id="(\d+)" height="(\d+)"/g;
    while ((m = cre.exec(hdr))) ch[m[1]] = parseInt(m[2], 10);
    var tot = 0;
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      var ppr = (p.match(/paraPrIDRef="(\d+)"/) || [])[1];
      var cpr = (p.match(/charPrIDRef="(\d+)"/) || [])[1];
      var sp = ls[ppr] != null ? ls[ppr] : 160; if (sp === 220) sp = sp220;
      var pt = (cpr != null && ch[cpr] != null ? ch[cpr] : 1200) / 100;
      var t = pText(p), cpl = Math.max(1, 36 * 12 / pt);
      var lines = t.trim() ? Math.max(1, Math.ceil(units(t) / cpl)) : 1;
      tot += lines * pt * sp / 100;
    }
    return tot;
  }
  // 자동맞춤 v4: (줄간격, 나눔인덱스) — 첨부 세트 보존 + 단일 나눔 + 2페이지 완결
  function planPage(out, hdr, dateKey) {
    if (estimateList(out, hdr, 220) <= BUDGET_PT) return [220, -1];
    if (estimateList(out, hdr, 190) <= BUDGET_PT) return [190, -1];
    var dateI = -1, attachI = -1;
    for (var i = 0; i < out.length; i++) {
      var t = pText(out[i]).trim();
      if (dateI < 0 && t.indexOf(dateKey) >= 0) dateI = i;
      if (attachI < 0 && (t === '첨부서류' || t === '첨 부 서 류')) attachI = i;
    }
    if (dateI >= 0 && estimateList(out.slice(0, dateI), hdr, 220) <= BUDGET_PT) return [220, dateI];
    if (attachI >= 0) return [220, attachI];
    return [220, dateI];
  }
  function applySpacing(hdr, sp) {
    return sp === 220 ? hdr : hdr.replace(/(<hh:lineSpacing[^>]*value=")220(")/g, '$1' + sp + '$2');
  }
  function fixIntent(hdr, bodyPpr, val) {
    var re = new RegExp('<hh:paraPr id="' + bodyPpr + '"[\\s\\S]*?</hh:paraPr>');
    return hdr.replace(re, function (blk) { return blk.replace(/(<hc:intent value=")-?\d+(")/, '$1' + val + '$2'); });
  }

  // ── 형사 ──
  function fillCriminal(sec, hdr, c) {
    var P = splitParas(sec), head = headOf(sec, P), tail = tailOf(sec);
    var plural = c.parties.length > 1, gukseon = !!c.gukseon;
    var role = c.role || '피고인', label = ROLE_LABEL[role] || role;
    var title = (c.titleKind || '') + '기일' + (c.titleAction || '변경') + '신청서';
    var p0 = P[0].replace(/<hp:t>[\s\S]*?기일[\s\S]*?신청서<\/hp:t>/, '<hp:t>' + xmlEsc(title) + '</hp:t>');
    var pCase = setT(P[2], '사    건  ' + c.caseNo + ' ' + c.caseName);
    var pParty = setT(P[3], label + '  ' + c.parties.join(', '));
    var pReason = setT(P[6], c.reason);
    var pDate = setT(P[12], c.date);
    var sig = '  위 ' + role + (plural ? '들' : '') + '의 ' + (gukseon ? '국선변호인' : '변호인');
    var pSig = setT(P[13], sig);
    var pCourt = setT(P[17], c.court + ' 귀중');
    var lw = c.lawyers;
    var pLaw = setRun9(P[15], '담당변호사 ' + lw[0]);
    var extra = [];
    for (var i = 1; i < lw.length; i++) extra.push(setRun9(P[15], '　　　　　 ' + lw[i]));

    var out = [p0, P[1], pCase, pParty, P[4], P[5], pReason, P[7]];
    var attach = c.attachments || [];
    if (attach.length) {
      out.push(setT(P[8], '첨 부 서 류'));
      for (var j = 0; j < attach.length; j++) out.push(setT(P[9], (j + 1) + '. ' + attach[j]));
      out.push(P[11]);
    }
    out.push(pDate); out.push(pSig);
    if (!gukseon) out.push(P[14]);
    out.push(pLaw); out = out.concat(extra);
    out.push(P[16]); out.push(pCourt);

    var bodyPpr = (P[6].match(/paraPrIDRef="(\d+)"/) || [])[1];
    hdr = fixIntent(hdr, bodyPpr, 1321);
    var plan = planPage(out, hdr, c.date), sp = plan[0], brk = plan[1];
    if (brk >= 0) out[brk] = setPB(out[brk]);
    return [head + out.join('') + tail, applySpacing(hdr, sp)];
  }

  // ── 민사 부동의 / 대리인부존재 (dissent 템플릿) ──
  function fillCivilDissent(sec, hdr, c) {
    var P = splitParas(sec), head = headOf(sec, P), tail = tailOf(sec);
    var role = c.role, label = ROLE_LABEL[role] || role;
    var title = (c.titleKind || '변론') + '기일' + (c.titleAction || '변경') + '신청서';
    var p0 = P[0].replace(/<hp:t>[\s\S]*?신청서<\/hp:t>/, '<hp:t>' + xmlEsc(title) + '</hp:t>');
    var out = [
      p0, P[1],
      setT(P[2], '사    건    ' + c.caseNo + '  ' + c.caseName),
      setT(P[3], '원    고    ' + c.plaintiff),
      setT(P[4], '피    고    ' + c.defendant),
      P[5],
      setT(P[6], INTRO_CIVIL.replace('{dt}', c.hearingDt)),
      P[7], P[8], P[9],
      setT(P[10], '변경신청사유 : ' + c.reason),
      P[11],
      setNthT(P[12], 1, c.noAgent ? NOAGENT_BODY : DISSENT_BODY),
      P[13],
      setT(P[14], ' ※희망기일- ' + c.wish),
      P[15]
    ];
    var attach = c.attachments || [];
    if (attach.length) {
      out.push(setT(P[16], '첨부서류'));
      for (var j = 0; j < attach.length; j++) out.push(setT(P[18], (j + 1) + '. ' + attach[j]));
      out.push(P[19]);
    }
    out.push(setT(P[21], c.date));
    out.push(P[22]);
    out.push(setT(P[23], '                                   위 ' + role + '의 소송대리인'));
    var lw = c.lawyers;
    out.push(P[24].replace(/담당변호사 [^<]*/, '담당변호사 ' + lw[0]));
    for (var k = 1; k < lw.length; k++) out.push(setT(P[25], '                                                  ' + lw[k]));
    out.push(P[27]); out.push(setT(P[28], c.court + ' 귀중'));

    var plan = planPage(out, hdr, c.date), sp = plan[0], brk = plan[1];
    if (brk >= 0) out[brk] = setPB(out[brk]);
    return [head + out.join('') + tail, applySpacing(hdr, sp)];
  }

  // ── 민사 동의 (consent 템플릿) ──
  function fillCivilConsent(sec, hdr, c) {
    var P = splitParas(sec), head = headOf(sec, P), tail = tailOf(sec);
    var role = c.role, lw = c.lawyers;
    var title = (c.titleKind || '') + '기일' + (c.titleAction || '변경') + ' 신청서';
    P[0] = P[0].replace(/<hp:t>[\s\S]*?신청서<\/hp:t>/, '<hp:t>' + xmlEsc(title) + '</hp:t>');
    P[2] = setT(P[2], '사    건    ' + c.caseNo + '   ' + c.caseName);
    P[3] = setT(P[3], '원    고    ' + c.plaintiff);
    P[4] = setT(P[4], '피    고    ' + c.defendant);
    P[6] = setT(P[6], INTRO_CIVIL.replace('{dt}', c.hearingDt));
    P[10] = setT(P[10], '변경신청사유 : ' + c.reason);
    P[16] = setT(P[16], ' ※희망기일- ' + c.wish);
    P[22] = setT(P[22], c.date);
    var consent = setT(P[21], '위 동의함.');
    var court = setT(P[32], c.court + ' 귀중');
    function ourBlock(headLabel) {
      var rows = [setT(P[24], headLabel), setT(P[25], '법무법인 정서'), setT(P[30], '담당 변호사  ' + lw[0])];
      for (var i = 1; i < lw.length; i++) rows.push(setT(P[30], '                    ' + lw[i]));
      return rows;
    }
    function oppBlock(headLabel) {
      return [setT(P[24], headLabel), setT(P[25], c.oppOffice), setT(P[26], '변호사 ' + c.oppLawyer)];
    }
    var out = P.slice(0, 12);
    var attach = c.attachments || [];
    if (attach.length) {
      out.push(setT(P[12], '첨 부 서 류')); out.push(P[13]);
      for (var j = 0; j < attach.length; j++) out.push(setT(P[14], (j + 1) + '. ' + attach[j]));
      out.push(P[15]);
    }
    out = out.concat([P[16], P[17], P[18], P[19], P[20]]);
    if (role === '피고') {
      out.push(setPB(consent)); out.push(P[22]); out.push(P[23]);
      out = out.concat(oppBlock('위 원고의 소송대리인'), [P[27]]);
      out = out.concat(ourBlock('위 피고의 소송대리인'));
      out.push(P[31]); out.push(court);
    } else {
      out.push(P[22]); out.push(P[23]);
      out = out.concat(ourBlock('위 원고의 소송대리인'), [P[27]]);
      out.push(setPB(consent));
      out = out.concat(oppBlock('위 피고의 소송대리인'));
      out.push(P[31]); out.push(court);
    }
    return [head + out.join('') + tail, hdr]; // 동의는 220% 유지(무조건 2페이지)
  }

  // 템플릿 로드 → 채우기 → Blob
  function loadJSZip() {
    return new Promise(function (res, rej) {
      if (window.JSZip) return res(window.JSZip);
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = function () { res(window.JSZip); };
      s.onerror = function () { rej(new Error('JSZip 로드 실패')); };
      document.head.appendChild(s);
    });
  }
  function buildHwpx(cfg) {
    var tpl = cfg.caseType === '민사'
      ? (cfg.consent === '동의' ? TPL.consent : TPL.dissent)
      : TPL.criminal;
    var Zip;
    return loadJSZip()
      .then(function (JSZip) { Zip = JSZip; return fetch(tpl); })
      .then(function (r) { if (!r.ok) throw new Error('템플릿 로드 실패: ' + tpl); return r.arrayBuffer(); })
      .then(function (buf) { return Zip.loadAsync(buf); })
      .then(function (zip) {
        return Promise.all([
          zip.file('Contents/section0.xml').async('string'),
          zip.file('Contents/header.xml').async('string'),
          zip.file('mimetype').async('uint8array'),
          zip
        ]);
      })
      .then(function (arr) {
        var sec = arr[0], hdr = arr[1], mime = arr[2], zip = arr[3], out;
        if (cfg.caseType === '민사') {
          out = (cfg.consent === '동의') ? fillCivilConsent(sec, hdr, cfg) : fillCivilDissent(sec, hdr, cfg);
        } else {
          out = fillCriminal(sec, hdr, cfg);
        }
        // 재패키징: mimetype 최우선 STORE, 나머지 원본 유지, section0/header 교체
        var zo = new Zip();
        zo.file('mimetype', mime, { compression: 'STORE' });
        var names = Object.keys(zip.files).filter(function (n) { return n !== 'mimetype' && !zip.files[n].dir; });
        return Promise.all(names.map(function (n) {
          if (n === 'Contents/section0.xml') return Promise.resolve([n, out[0]]);
          if (n === 'Contents/header.xml') return Promise.resolve([n, out[1]]);
          return zip.file(n).async('uint8array').then(function (d) { return [n, d]; });
        })).then(function (entries) {
          entries.forEach(function (e) { zo.file(e[0], e[1]); });
          return zo.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip' });
        });
      });
  }

  /* ══════════════════════════════════════════════════════════════
     상태 + 폼
     ══════════════════════════════════════════════════════════════ */
  var state = null;
  function defaultState() {
    return {
      caseType: '형사', role: '피고인', consent: '부동의',
      titleKind: '공판', titleAction: '변경',
      caseNo: '', caseName: '', parties: '', plaintiff: '', defendant: '',
      hearingDt: '', wish: '', memo: '', reason: '',
      lawyers: '서고은', attachments: '', date: todayISO(),
      gukseon: false, noAgent: false, oppOffice: '', oppLawyer: '',
      court: '인천지방법원', courtDiv: ''
    };
  }

  var STYLE_ID = 'yeongi-style';
  var YG_CSS =
    '#yeongiForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#yeongiForm.active{display:flex;}' +
    '#yeongiForm .yg-seg{display:flex;gap:6px;flex-wrap:wrap;}' +
    '#yeongiForm .yg-seg button{flex:1 1 auto;min-width:64px;padding:9px 10px;border:1px solid #d0d3da;background:#f6f7f9;border-radius:9px;font:inherit;font-size:14px;color:#333;cursor:pointer;}' +
    '#yeongiForm .yg-seg button.on{background:#2b6fff;border-color:#2b6fff;color:#fff;font-weight:600;}' +
    '#yeongiForm .yg-civil,#yeongiForm .yg-crim,#yeongiForm .yg-consent-opp{display:none;}' +
    '#yeongiForm.is-civil .yg-civil{display:block;}' +
    '#yeongiForm.is-crim .yg-crim{display:block;}' +
    '#yeongiForm.show-opp .yg-consent-opp{display:block;}' +
    '#yeongiForm textarea.fs-input{min-height:96px;resize:vertical;line-height:1.5;}' +
    '#yeongiForm .yg-ai{display:flex;gap:8px;align-items:center;margin-top:6px;}' +
    '#yeongiForm .yg-ai-btn{white-space:nowrap;padding:9px 14px;border:1px solid #6a3df0;background:#f3efff;color:#5a2fd6;border-radius:9px;font:inherit;font-weight:600;cursor:pointer;}' +
    '#yeongiForm .yg-ai-btn:disabled{opacity:.6;cursor:default;}' +
    '#yeongiForm .yg-ai-hint{font-size:12px;color:#8a8f98;}' +
    '#yeongiForm .yg-dl{background:#0b8a4b;border-color:#0b8a4b;}';
  function injectStyle() { FSDoc.injectOnce(STYLE_ID, YG_CSS); }

  var SHELL_ID = 'yeongi-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="yeongiForm">' +
        '<div class="fs-card">' +
          '<div class="fs-head">' +
            '<button class="fs-close" onclick="closeYeongiForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '<div class="fs-title">기일연기·변경 신청서</div>' +
          '</div>' +
          '<div class="fs-body">' +
            '<div class="fs-section">사건 구분</div>' +
            '<div class="fs-field"><div class="yg-seg" id="yg-casetype">' +
              '<button data-v="형사" class="on" onclick="ygCaseType(\'형사\')">형사</button>' +
              '<button data-v="민사" onclick="ygCaseType(\'민사\')">민사</button></div></div>' +

            '<div class="fs-section">사건 정보</div>' +
            '<div class="fs-field"><label class="fs-label">사건번호</label><input type="text" class="fs-input" id="yg-caseno" data-af="l_code" placeholder="2024고단1234"></div>' +
            '<div class="fs-field"><label class="fs-label">사건명</label><input type="text" class="fs-input" id="yg-casename" data-af="l_name" placeholder="사기"></div>' +
            '<div class="fs-field"><label class="fs-label">법원</label><input type="text" class="fs-input" id="yg-court" data-af="court" placeholder="인천지방법원"></div>' +
            '<div class="fs-field"><label class="fs-label">재판부 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="text" class="fs-input" id="yg-courtdiv" placeholder="형사1단독"></div>' +

            /* 형사 전용 */
            '<div class="yg-crim">' +
              '<div class="fs-field"><label class="fs-label">피고인 <span class="fs-hint">(여러 명은 쉼표로)</span></label><input type="text" class="fs-input" id="yg-parties" data-af="l_client" placeholder="홍길동, 김철수"></div>' +
              '<div class="fs-field"><label class="fs-label"><input type="checkbox" id="yg-gukseon"> 국선사건 <span class="fs-hint">(법무법인 정서 줄 생략 + 국선변호인)</span></label></div>' +
            '</div>' +

            /* 민사 전용 */
            '<div class="yg-civil">' +
              '<div class="fs-field"><label class="fs-label">원고</label><input type="text" class="fs-input" id="yg-plaintiff" placeholder="원고 이름"></div>' +
              '<div class="fs-field"><label class="fs-label">피고</label><input type="text" class="fs-input" id="yg-defendant" placeholder="피고 이름"></div>' +
              '<div class="fs-field"><label class="fs-label">우리 측</label><div class="yg-seg" id="yg-side">' +
                '<button data-v="원고" onclick="ygSide(\'원고\')">원고</button>' +
                '<button data-v="피고" class="on" onclick="ygSide(\'피고\')">피고</button></div></div>' +
              '<div class="fs-field"><label class="fs-label">상대방 동의</label><div class="yg-seg" id="yg-consent">' +
                '<button data-v="동의" onclick="ygConsent(\'동의\')">동의</button>' +
                '<button data-v="부동의" class="on" onclick="ygConsent(\'부동의\')">부동의</button>' +
                '<button data-v="대리인부존재" onclick="ygConsent(\'대리인부존재\')">대리인 없음</button></div></div>' +
              '<div class="yg-consent-opp">' +
                '<div class="fs-field"><label class="fs-label">상대방 사무소</label><input type="text" class="fs-input" id="yg-oppoffice" placeholder="법률사무소 ○○"></div>' +
                '<div class="fs-field"><label class="fs-label">상대방 변호사</label><input type="text" class="fs-input" id="yg-opplawyer" placeholder="변호사 이름"></div>' +
              '</div>' +
            '</div>' +

            '<div class="fs-section">기일 · 사유</div>' +
            '<div class="fs-field yg-crim"><label class="fs-label">기일 종류</label><div class="yg-seg" id="yg-kind">' +
              '<button data-v="공판" class="on" onclick="ygKind(\'공판\')">공판</button>' +
              '<button data-v="변론" onclick="ygKind(\'변론\')">변론</button>' +
              '<button data-v="선고" onclick="ygKind(\'선고\')">선고</button>' +
              '<button data-v="" onclick="ygKind(\'\')">(없음)</button></div></div>' +
            '<div class="fs-field"><label class="fs-label">동작</label><div class="yg-seg" id="yg-action">' +
              '<button data-v="변경" class="on" onclick="ygAction(\'변경\')">변경</button>' +
              '<button data-v="연기" onclick="ygAction(\'연기\')">연기</button></div></div>' +
            '<div class="fs-field"><label class="fs-label">지정된 기일</label><input type="text" class="fs-input" id="yg-hearingdt" placeholder="2024. 3. 22. 10:00"></div>' +
            '<div class="fs-field"><label class="fs-label">희망기일 <span class="fs-hint">(재판부에서 받은 기일, 수기)</span></label><input type="text" class="fs-input" id="yg-wish" placeholder="2024. 4. 12., 4. 19."></div>' +
            '<div class="fs-field"><label class="fs-label">사유 메모 <span class="fs-hint">(간단히 적으면 클로드가 정서 문체로 작성)</span></label>' +
              '<textarea class="fs-input" id="yg-memo" placeholder="예: 같은날 다른 재판 있음 / 담당변호사 퇴사 / 기록등사 지연"></textarea>' +
              '<div class="yg-ai"><button type="button" class="yg-ai-btn" id="yg-ai-btn" onclick="ygDraft()">✨ 클로드로 사유 작성</button><span class="yg-ai-hint" id="yg-ai-hint"></span></div></div>' +
            '<div class="fs-field"><label class="fs-label">연기/변경 사유 <span class="fs-hint">(검토·수정 후 다운로드)</span></label>' +
              '<textarea class="fs-input" id="yg-reason" placeholder="여기에 사유 문단이 들어갑니다"></textarea></div>' +

            '<div class="fs-section">서명 · 첨부</div>' +
            '<div class="fs-field"><label class="fs-label">담당변호사 <span class="fs-hint">(여러 명은 쉼표로, 순서대로 나열)</span></label><input type="text" class="fs-input" id="yg-lawyers" placeholder="서고은, 이예나"></div>' +
            '<div class="fs-field"><label class="fs-label">첨부서류 <span class="fs-hint">(여러 개는 쉼표로, 없으면 비움)</span></label><input type="text" class="fs-input" id="yg-attach" placeholder="퇴직증명서"></div>' +
            '<div class="fs-field"><label class="fs-label">작성일</label><input type="text" class="fs-input" id="yg-date" placeholder="2024. 3. 7."></div>' +
          '</div>' +
          '<div class="fs-foot">' +
            '<button class="fs-btn ghost" onclick="closeYeongiForm()">취소</button>' +
            '<button class="fs-btn primary yg-dl" onclick="ygDownload()">📄 HWPX 다운로드</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function segSet(groupId, v) {
    var g = document.getElementById(groupId); if (!g) return;
    g.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
  }
  function fmtDate(iso) { // YYYY-MM-DD → 'YYYY. M. D.'
    var p = ('' + iso).split('-'); if (p.length !== 3) return iso;
    return p[0] + '. ' + parseInt(p[1], 10) + '. ' + parseInt(p[2], 10) + '.';
  }

  function ensureUI() { injectStyle(); injectShell(); }
  function applyCaseTypeClass() {
    var f = document.getElementById('yeongiForm'); if (!f) return;
    f.classList.toggle('is-civil', state.caseType === '민사');
    f.classList.toggle('is-crim', state.caseType === '형사');
    var showOpp = state.caseType === '민사' && state.consent === '동의';
    f.classList.toggle('show-opp', showOpp);
  }

  window.ygCaseType = function (v) { state.caseType = v; segSet('yg-casetype', v); applyCaseTypeClass(); };
  window.ygSide = function (v) { state.role = v; segSet('yg-side', v); };
  window.ygConsent = function (v) { state.consent = v; segSet('yg-consent', v); applyCaseTypeClass(); };
  window.ygKind = function (v) { state.titleKind = v; segSet('yg-kind', v); };
  window.ygAction = function (v) { state.titleAction = v; segSet('yg-action', v); };

  function fillFormFromState() {
    segSet('yg-casetype', state.caseType);
    setVal('yg-caseno', state.caseNo); setVal('yg-casename', state.caseName);
    setVal('yg-court', state.court); setVal('yg-courtdiv', state.courtDiv);
    setVal('yg-parties', state.parties);
    setVal('yg-plaintiff', state.plaintiff); setVal('yg-defendant', state.defendant);
    segSet('yg-side', state.role === '원고' ? '원고' : '피고');
    segSet('yg-consent', state.consent);
    setVal('yg-oppoffice', state.oppOffice); setVal('yg-opplawyer', state.oppLawyer);
    segSet('yg-kind', state.titleKind); segSet('yg-action', state.titleAction);
    setVal('yg-hearingdt', state.hearingDt); setVal('yg-wish', state.wish);
    setVal('yg-memo', state.memo); setVal('yg-reason', state.reason);
    setVal('yg-lawyers', state.lawyers); setVal('yg-attach', state.attachments);
    setVal('yg-date', state.date && state.date.indexOf('-') >= 0 ? fmtDate(state.date) : state.date);
    var gk = document.getElementById('yg-gukseon'); if (gk) gk.checked = !!state.gukseon;
    applyCaseTypeClass();
  }

  // 폼 → cfg (엔진 입력)
  function collect() {
    var caseType = state.caseType;
    var role = caseType === '민사' ? (segOn('yg-side') || '피고') : '피고인';
    var lawyers = getVal('yg-lawyers').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lawyers.length) lawyers = ['서고은'];
    var attach = getVal('yg-attach').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var cfg = {
      caseType: caseType, role: role,
      titleKind: segOn('yg-kind'), titleAction: segOn('yg-action') || '변경',
      caseNo: getVal('yg-caseno'), caseName: getVal('yg-casename'),
      court: getVal('yg-court') + (getVal('yg-courtdiv') ? ' ' + getVal('yg-courtdiv') : ''),
      hearingDt: getVal('yg-hearingdt'), wish: getVal('yg-wish'),
      reason: getVal('yg-reason'), lawyers: lawyers, attachments: attach,
      date: getVal('yg-date') || fmtDate(todayISO())
    };
    if (caseType === '민사') {
      cfg.plaintiff = getVal('yg-plaintiff'); cfg.defendant = getVal('yg-defendant');
      cfg.consent = segOn('yg-consent') || '부동의';
      cfg.noAgent = cfg.consent === '대리인부존재';
      cfg.oppOffice = getVal('yg-oppoffice'); cfg.oppLawyer = getVal('yg-opplawyer');
    } else {
      cfg.parties = getVal('yg-parties').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!cfg.parties.length) cfg.parties = [''];
      var gk = document.getElementById('yg-gukseon'); cfg.gukseon = !!(gk && gk.checked);
    }
    return cfg;
  }
  function segOn(groupId) {
    var g = document.getElementById(groupId); if (!g) return '';
    var b = g.querySelector('button.on'); return b ? b.getAttribute('data-v') : '';
  }

  function openForm() {
    ensureUI();
    fillFormFromState();
    document.getElementById('yeongiForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('yg-caseno', { courtDept: 'yg-courtdiv' });
  }

  window.goYeongi = function () { ensureUI(); state = defaultState(); openForm(); };
  window.closeYeongiForm = function () { var f = document.getElementById('yeongiForm'); if (f) f.classList.remove('active'); };

  // ✨ 클로드로 사유 작성
  window.ygDraft = function () {
    var btn = document.getElementById('yg-ai-btn'), hint = document.getElementById('yg-ai-hint');
    var memo = getVal('yg-memo');
    if (!memo && !getVal('yg-hearingdt')) { if (hint) hint.textContent = '사유 메모나 기일을 먼저 적어주세요.'; return; }
    btn.disabled = true; if (hint) hint.textContent = '클로드가 작성 중…';
    var payload = {
      caseType: state.caseType,
      role: state.caseType === '민사' ? (segOn('yg-side') + '의 소송대리인') : '피고인의 변호인',
      hearingKind: segOn('yg-kind'), action: segOn('yg-action'),
      hearingDt: getVal('yg-hearingdt'), caseNo: getVal('yg-caseno'), caseName: getVal('yg-casename'),
      memo: memo
    };
    fetch(fnUrl('draft-yeongi'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'apikey': (typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : '') },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (d) {
      btn.disabled = false;
      if (d && d.ok && d.reason) { setVal('yg-reason', d.reason); if (hint) hint.textContent = '작성 완료 — 검토·수정 후 다운로드하세요.'; }
      else { if (hint) hint.textContent = '작성 실패: ' + ((d && d.reason) || 'unknown') + ' (직접 입력 가능)'; }
    }).catch(function (e) { btn.disabled = false; if (hint) hint.textContent = '오류: ' + e.message; });
  };

  // 📄 HWPX 다운로드
  window.ygDownload = function () {
    var cfg = collect();
    if (!cfg.reason) { alert('사유를 먼저 작성해주세요 (✨ 버튼 또는 직접 입력).'); return; }
    buildHwpx(cfg).then(function (blob) {
      var name = (cfg.caseType === '민사' ? '민사' : '형사') + '_기일' + cfg.titleAction + '신청서.hwpx';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }).catch(function (e) { alert('HWPX 생성 실패: ' + e.message); });
  };

  /* node 검증용 (브라우저에서는 무시됨) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fillCriminal: fillCriminal, fillCivilConsent: fillCivilConsent, fillCivilDissent: fillCivilDissent,
      estimateList: estimateList, planPage: planPage, setT: setT
    };
  }
})();
