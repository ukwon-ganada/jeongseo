/* 법무법인 정서 PWA - 참고자료 서면작성 (chamgo.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. index.html 에는 진입점 버튼 + <script src="chamgo.js"> 만 둔다.
   화면(입력폼)·전용 CSS 는 이 파일이 <body>에 1회 주입한다.

   흐름(기일연기와 동일한 단일 단계):
     goChamgo() → [데이터 입력 폼] → [한글 다운로드] (확인창 없음)
     · 본문 작성 = Edge Function 'draft-chamgo'(간단/길게) 호출
     · 한글 다운로드 = templates/chamgo.hwpx 를 JSZip 으로 채워 다운로드
     · 도장 날인(선택) = 담당변호사 첫 번째가 '서고은'일 때 서명란에 직인 삽입

   폼: 지위(피고인/피의자) · [의뢰인명][사건명] · 제출기관(+국선) ·
       제출서류(여러 줄=목록, 번호 직접입력) · 사정 메모 · 간단/길게 ·
       본문(AI) · 담당변호사 · 작성일 · 도장

   의존: initAutofillFor(autofill.js) · JU(util.js) · FSDoc(fsdoc.js)
        · renderAttChips/addAttorney/attChipClick(index.html) · SUPABASE_URL·SUPABASE_KEY · JSZip(CDN)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TPL = './templates/chamgo.hwpx';
  var JIWI_LABEL = { '피고인': '피 고 인', '피의자': '피 의 자' };

  function esc(v) { return JU.esc(v); }
  function todayISO() { return JU.todayISO(); }
  function xmlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fnUrl(name) { return (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/' + name; }
  function cleanCaseName(name) { return String(name || '').replace(/\[전자\]\s*/g, '').trim(); }
  function splitLines(v) { return String(v || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean); }
  // 제출서류 목록 정규화: 줄바꿈/쉼표로 나눈 뒤, 각 항목의 (숫자)(서류명)만 추려 "숫자. 서류명" 으로 통일
  //  예) "1. 반성문, 2 탄원서, 2-1합의서" → ["1. 반성문","2. 탄원서","2-1. 합의서"]
  function parseDocs(raw) {
    return String(raw || '').split(/[\n,]/).map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean).map(function (item) {
      var m = item.match(/^(\d+(?:-\d+)*)\s*[.)]?\s*(.+)$/);
      return (m && m[2].trim()) ? (m[1] + '. ' + m[2].trim()) : item;
    });
  }
  function fmtDate(iso) {
    var p = ('' + iso).split('-'); if (p.length !== 3) return iso;
    return p[0] + '. ' + parseInt(p[1], 10) + '. ' + parseInt(p[2], 10) + '.';
  }
  function ymd(dateStr) {
    var m = String(dateStr || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : '';
  }

  /* ══════════ HWPX 채우기 엔진 ══════════ */
  var PARA_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;
  function splitParas(sec) { return sec.match(PARA_RE) || []; }
  function headOf(sec, paras) { return sec.slice(0, sec.indexOf(paras[0])); }
  function tailOf(sec) { var i = sec.lastIndexOf('</hp:p>'); return sec.slice(i + 7); }
  function setT(p, txt) { return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/, '<hp:t>' + xmlEsc(txt) + '</hp:t>'); }
  function setNthT(p, n, txt) {
    var i = -1;
    return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/g, function (m) { i++; return i === n ? '<hp:t>' + xmlEsc(txt) + '</hp:t>' : m; });
  }
  // 본문 채우기: 첫 <hp:t> 안의 선행 태그(들여쓰기 <hp:tab> 등)는 보존하고 텍스트만 교체, 2번째 run 비움
  function setBody(p, txt) {
    var first = true;
    p = p.replace(/<hp:t>([\s\S]*?)<\/hp:t>/, function (m, inner) {
      var lead = (inner.match(/^(?:<[^>]+>)*/) || [''])[0]; // 탭 등 선행 태그
      return '<hp:t>' + lead + xmlEsc(txt) + '</hp:t>';
    });
    var i = -1;
    return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/g, function (m) { i++; return i === 1 ? '<hp:t></hp:t>' : m; });
  }
  // 참고자료 목록의 자동번호 제거(직접 지정 방식) — ppr15 heading NUMBER→NONE
  function killListNumber(hdr) {
    return hdr.replace(/(<hh:paraPr id="15"[\s\S]*?)<hh:heading type="NUMBER" idRef="1" level="0"\/>/, '$1<hh:heading type="NONE" idRef="0" level="0"/>');
  }
  // 서명 세트(작성일 ppr16 · 서명/담당변호사 ppr17)를 '다음 문단과 함께' 로 묶어
  //  페이지를 넘길 때 {작성일·서명·기관 귀중} 이 통째로 다음 페이지로 넘어가게 한다.
  function keepSetTogether(hdr) {
    return hdr.replace(/(<hh:paraPr id="1[67]"[\s\S]*?<hh:breakSetting[^>]*?)keepWithNext="0" keepLines="0"/g,
      '$1keepWithNext="1" keepLines="1"');
  }

  function introText(c) {
    return ' 위 사건에 관하여 ' + c.jiwi + '의 ' + (c.gukseon ? '(국선)' : '') + '변호인은 다음과 같이 참고자료를 제출합니다.';
  }
  function sigLabel(c) {
    return '위 ' + c.jiwi + '의 ' + (c.gukseon ? '(국선)' : '') + '변호인';
  }

  // 참고자료 채우기 — P: 0제목 1사건 2지위+이름 4도입 6다음 8본문 10목록머리 11목록 14작성일 15서명 16법무법인 17담당변호사 18기관
  function fillChamgo(sec, hdr, c) {
    var P = splitParas(sec), head = headOf(sec, P), tail = tailOf(sec);
    var lw = c.lawyers || ['서고은'];
    var out = [
      P[0],
      setNthT(P[1], 1, c.caseLine),
      setNthT(setNthT(P[2], 0, (JIWI_LABEL[c.jiwi] || '피 고 인') + '     '), 1, c.name),
      P[3],
      setNthT(P[4], 1, introText(c)),
      P[5], P[6], P[7]
    ];
    // 본문(여러 문단 가능) — 문단 사이 빈 줄
    var bodyLines = splitLines(c.reason);
    if (!bodyLines.length) bodyLines = [''];
    for (var b = 0; b < bodyLines.length; b++) {
      out.push(setBody(P[8], bodyLines[b]));
      if (b < bodyLines.length - 1) out.push(P[9]);
    }
    out.push(P[9]); out.push(P[10]);
    // 참고자료 목록(입력한 줄 그대로)
    var docs = c.docsList || [];
    for (var d = 0; d < docs.length; d++) out.push(setT(P[11], docs[d]));
    out.push(P[13]);
    out.push(setT(P[14], c.date));
    out.push(setT(P[15], sigLabel(c)));
    if (!c.gukseon) out.push(P[16]);                      // 국선이면 법무법인 정서 줄 생략
    out.push(setT(P[17], '담당변호사 ' + lw[0]));
    for (var k = 1; k < lw.length; k++) out.push(setT(P[17], lw[k]));
    out.push(setT(P[18], c.court + ' 귀중'));
    return [head + out.join('') + tail, keepSetTogether(killListNumber(hdr))];
  }

  /* ── 도장(직인) 삽입 — yeongi 와 동일 규칙 ── */
  var SEAL_MM = 15, SEAL_HU = Math.round(SEAL_MM / 10 * 7200 / 2.54);
  var SEAL_HOFF = 700, SEAL_VOFF = -1150;
  function dataUrlToU8(u) {
    var b64 = String(u || '').split(',')[1] || '', bin = atob(b64), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function pngSize(u8) {
    if (!u8 || u8.length < 24) return [504, 480];
    var w = ((u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19]) >>> 0;
    var h = ((u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23]) >>> 0;
    return [w || 504, h || 480];
  }
  function buildPic(pxW, pxH) {
    var oW = pxW * 75, oH = pxH * 75, half = Math.round(SEAL_HU / 2);
    return '<hp:run charPrIDRef="0">' +
      '<hp:pic reverse="0" isBWModeOnly="0" id="1932510122" zOrder="20" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="1932510122">' +
      '<hp:offset x="0" y="0"/>' +
      '<hp:orgSz width="' + oW + '" height="' + oH + '"/>' +
      '<hp:curSz width="' + SEAL_HU + '" height="' + SEAL_HU + '"/>' +
      '<hp:flip horizontal="0" vertical="0"/>' +
      '<hp:rotationInfo angle="0" centerX="' + half + '" centerY="' + half + '" rotateimage="1"/>' +
      '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
      '<hc:img binaryItemIDRef="image1" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + SEAL_HU + '" y="0"/><hc:pt2 x="' + SEAL_HU + '" y="' + SEAL_HU + '"/><hc:pt3 x="0" y="' + SEAL_HU + '"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="' + oW + '" top="0" bottom="' + oH + '"/>' +
      '<hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:imgDim dimwidth="' + oW + '" dimheight="' + oH + '"/>' +
      '<hp:sz width="' + SEAL_HU + '" widthRelTo="ABSOLUTE" height="' + SEAL_HU + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="RIGHT" vertOffset="' + SEAL_VOFF + '" horzOffset="' + SEAL_HOFF + '"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic></hp:run>';
  }
  function injectSealPic(sec, pic) {
    var paras = sec.match(PARA_RE) || [];
    for (var i = 0; i < paras.length; i++) {
      var t = ''; var re = /<hp:t>([\s\S]*?)<\/hp:t>/g, m;
      while ((m = re.exec(paras[i]))) t += m[1].replace(/<[^>]+>/g, '');
      if (t.indexOf('담당') >= 0 && t.indexOf('서고은') >= 0) {
        return sec.replace(paras[i], paras[i].replace(/^(<hp:p\b[^>]*>)/, '$1' + pic));
      }
    }
    return sec;
  }
  function injectBinData(hdr) {
    if (hdr.indexOf('<hh:binDataList') >= 0) return hdr;
    return hdr.replace('<hh:refList>', '<hh:refList><hh:binDataList itemCnt="1"><hh:binData id="1" type="EMBEDDING"/></hh:binDataList>');
  }
  function injectHpfManifest(hpf) {
    if (hpf.indexOf('BinData/image1.png') >= 0) return hpf;
    return hpf.replace('<opf:manifest>', '<opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>');
  }
  function injectOdfManifest(s) {
    if (s.indexOf('BinData/image1.png') >= 0) return s;
    var entry = '<odf:file-entry odf:full-path="BinData/image1.png" odf:media-type="image/png"/>';
    if (s.indexOf('</odf:manifest>') >= 0) return s.replace('</odf:manifest>', entry + '</odf:manifest>');
    return s.replace(/<odf:manifest([^>]*)\/>/, '<odf:manifest$1>' + entry + '</odf:manifest>');
  }

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
    var wantSeal = !!cfg.stamp && cfg.lawyers && cfg.lawyers[0] === '서고은' &&
      typeof window !== 'undefined' && window.SEAL_SEOGOEUN;
    var Zip;
    return loadJSZip()
      .then(function (JSZip) { Zip = JSZip; return fetch(TPL); })
      .then(function (r) { if (!r.ok) throw new Error('템플릿 로드 실패: ' + TPL); return r.arrayBuffer(); })
      .then(function (buf) { return Zip.loadAsync(buf); })
      .then(function (zip) {
        return Promise.all([
          zip.file('Contents/section0.xml').async('string'),
          zip.file('Contents/header.xml').async('string'),
          zip.file('mimetype').async('uint8array'),
          wantSeal ? zip.file('Contents/content.hpf').async('string') : Promise.resolve(null),
          zip
        ]);
      })
      .then(function (arr) {
        var out = fillChamgo(arr[0], arr[1], cfg);
        var sec = out[0], hdr = out[1], mime = arr[2], hpf = arr[3], zip = arr[4], sealBin = null;
        if (wantSeal) {
          var u8 = dataUrlToU8(window.SEAL_SEOGOEUN), wh = pngSize(u8);
          var sec2 = injectSealPic(sec, buildPic(wh[0], wh[1]));
          if (sec2 !== sec) { sec = sec2; hdr = injectBinData(hdr); hpf = injectHpfManifest(hpf); sealBin = u8; }
        }
        var zo = new Zip();
        zo.file('mimetype', mime, { compression: 'STORE' });
        var names = Object.keys(zip.files).filter(function (n) { return n !== 'mimetype' && !zip.files[n].dir; });
        return Promise.all(names.map(function (n) {
          if (n === 'Contents/section0.xml') return Promise.resolve([n, sec]);
          if (n === 'Contents/header.xml') return Promise.resolve([n, hdr]);
          if (n === 'Contents/content.hpf' && sealBin) return Promise.resolve([n, hpf]);
          if (n === 'META-INF/manifest.xml' && sealBin) return zip.file(n).async('string').then(function (s) { return [n, injectOdfManifest(s)]; });
          return zip.file(n).async('uint8array').then(function (d) { return [n, d]; });
        })).then(function (entries) {
          entries.forEach(function (e) { zo.file(e[0], e[1]); });
          if (sealBin) zo.file('BinData/image1.png', sealBin);
          return zo.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip' });
        });
      });
  }

  /* ══════════ 상태 + cfg ══════════ */
  var state = null;
  function defaultState() {
    return {
      jiwi: '피고인', client: '', caseLine: '', court: '', gukseon: false,
      docs: '', memo: '', length: '간단', reason: '',
      attorneys: ['서고은'], date: fmtDate(todayISO()), stamp: true
    };
  }
  function toCfg(s) {
    return {
      jiwi: s.jiwi, name: s.client, caseLine: s.caseLine, court: s.court, gukseon: !!s.gukseon,
      docsList: parseDocs(s.docs), reason: s.reason,
      lawyers: (s.attorneys && s.attorneys.length) ? s.attorneys.slice() : ['서고은'],
      date: s.date || fmtDate(todayISO()), stamp: !!s.stamp
    };
  }
  function downloadName(s, cfg) {
    var parts = ['참고자료', s.client, s.caseLine, ymd(s.date)].filter(Boolean);
    return parts.join('_').replace(/[\/\\:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim() + '.hwpx';
  }

  /* ══════════ CSS ══════════ */
  var STYLE_ID = 'chamgo-style';
  var CG_CSS =
    '#chamgoForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#chamgoForm.active{display:flex;}' +
    '#chamgoForm .cg-pick{display:flex;align-items:center;gap:10px;margin:0 0 9px;}' +
    '#chamgoForm .cg-pick-l{flex:none;min-width:52px;font-size:13px;color:var(--gray-700,#555);}' +
    '#chamgoForm .cg-pick .fs-chips{flex:1;gap:6px;}' +
    '#chamgoForm .fs-chips .fs-chip{padding:6px 13px;font-size:13px;}' +
    '#chamgoForm .cg-row2{display:flex;gap:10px;}' +
    '#chamgoForm .cg-row2>.fs-field{flex:1;min-width:0;}' +
    '#chamgoForm textarea.fs-input{min-height:80px;resize:vertical;line-height:1.5;}' +
    '#chamgoForm textarea.cg-body{min-height:120px;}' +
    '#chamgoForm .cg-ai{display:flex;gap:8px;align-items:center;margin-top:6px;}' +
    '#chamgoForm .cg-ai-btn{white-space:nowrap;padding:9px 14px;border:1px solid #6a3df0;background:#f3efff;color:#5a2fd6;border-radius:9px;font:inherit;font-weight:600;cursor:pointer;}' +
    '#chamgoForm .cg-ai-btn:disabled{opacity:.6;cursor:default;}' +
    '#chamgoForm .cg-ai-hint{font-size:12px;color:#8a8f98;}';
  function injectStyle() { FSDoc.injectOnce(STYLE_ID, CG_CSS); }

  /* ══════════ 화면 껍데기 ══════════ */
  var SHELL_ID = 'chamgo-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="chamgoForm">' +
        '<div class="fs-card">' +
          '<div class="fs-head">' +
            '<button class="fs-close" onclick="closeChamgoForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '<div class="fs-title">참고자료</div>' +
          '</div>' +
          '<div class="fs-body">' +
            '<div class="cg-pick"><span class="cg-pick-l">지위</span><div class="fs-chips" id="cg-jiwi">' +
              '<span class="fs-chip on" data-v="피고인" onclick="cgJiwi(\'피고인\')">피고인</span>' +
              '<span class="fs-chip" data-v="피의자" onclick="cgJiwi(\'피의자\')">피의자</span></div></div>' +

            '<div class="fs-section">사건 정보</div>' +
            '<div class="cg-row2">' +
              '<div class="fs-field"><label class="fs-label" id="cg-client-label">피고인</label><input type="text" class="fs-input" id="cg-client" placeholder="홍길동"></div>' +
              '<div class="fs-field"><label class="fs-label">사건명</label><input type="text" class="fs-input" id="cg-caseline" placeholder="2026고단100539 도로교통법위반"></div>' +
            '</div>' +
            '<div class="fs-field"><label class="fs-label">제출기관 <span class="fs-hint">(법원 재판부 자동, 검찰 검사실은 수기)</span></label><input type="text" class="fs-input" id="cg-court" placeholder="인천지방법원 형사16단독"></div>' +
            '<div class="fs-field"><label class="fs-label"><input type="checkbox" id="cg-gukseon"> 국선사건 <span class="fs-hint">((국선)변호인 + 법무법인 정서 줄 생략)</span></label></div>' +

            '<div class="fs-section">참고자료</div>' +
            '<div class="fs-field"><label class="fs-label">제출서류 <span class="fs-hint">(줄바꿈 또는 쉼표로 구분 · 번호와 서류명만 적으면 자동 정리)</span></label>' +
              '<textarea class="fs-input" id="cg-docs" placeholder="1. 탄원서, 2 반성문, 2-1합의서  → 1. 탄원서 / 2. 반성문 / 2-1. 합의서"></textarea></div>' +
            '<div class="fs-field"><label class="fs-label">사정 메모 <span class="fs-hint">(선택 — 피고인 사정·갱생 등, 길게 본문에 반영)</span></label>' +
              '<textarea class="fs-input" id="cg-memo" placeholder="예: 초범 / 부모 부양 / 마약예방교육 이수 / 피해자와 합의"></textarea></div>' +
            '<div class="cg-pick"><span class="cg-pick-l">본문 길이</span><div class="fs-chips" id="cg-length">' +
              '<span class="fs-chip on" data-v="간단" onclick="cgLength(\'간단\')">간단</span>' +
              '<span class="fs-chip" data-v="길게" onclick="cgLength(\'길게\')">길게</span></div></div>' +
            '<div class="fs-field"><label class="fs-label">본문 <span class="fs-hint">(AI작성 후 검토·수정)</span></label>' +
              '<div class="cg-ai"><button type="button" class="cg-ai-btn" id="cg-ai-btn" onclick="cgDraft()">AI작성</button><span class="cg-ai-hint" id="cg-ai-hint"></span></div>' +
              '<textarea class="fs-input cg-body" id="cg-reason" placeholder="여기에 참고자료 본문이 들어갑니다"></textarea></div>' +

            '<div class="fs-section">서명 · 날인</div>' +
            '<div class="fs-field"><label class="fs-label">담당변호사 <span class="fs-hint">(여러 명 선택 시 순서대로 나열)</span></label>' +
              '<div class="fs-chips att-chips" id="cg-att" onclick="attChipClick(event,\'cg\')"></div>' +
              '<div class="att-add-row"><input type="text" class="att-add-input" id="cg-att-new" placeholder="추가할 변호사 이름"><button type="button" class="att-add-btn" onclick="addAttorney(\'cg\')">＋ 추가</button></div></div>' +
            '<div class="fs-field"><label class="fs-label">작성일</label><input type="text" class="fs-input" id="cg-date" placeholder="2026. 7. 11."></div>' +
            '<div class="fs-field"><label class="fs-label"><input type="checkbox" id="cg-stamp"> 서고은 도장 날인 <span class="fs-hint">(담당변호사 첫 번째가 서고은일 때)</span></label></div>' +
          '</div>' +
          '<div class="fs-foot">' +
            '<button class="fs-btn ghost" onclick="closeChamgoForm()">취소</button>' +
            '<button class="fs-btn primary" onclick="cgDownload()">한글 다운로드</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  /* ══════════ DOM 유틸 ══════════ */
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function getRaw(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function segSet(groupId, v) {
    var g = document.getElementById(groupId); if (!g) return;
    g.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
  }
  function segOn(groupId) {
    var g = document.getElementById(groupId); if (!g) return '';
    var b = g.querySelector('[data-v].on'); return b ? b.getAttribute('data-v') : '';
  }

  window.cgJiwi = function (v) {
    state.jiwi = v; segSet('cg-jiwi', v);
    var cl = document.getElementById('cg-client-label'); if (cl) cl.textContent = v;
  };
  window.cgLength = function (v) { state.length = v; segSet('cg-length', v); };

  function fillFormFromState() {
    segSet('cg-jiwi', state.jiwi);
    var cl = document.getElementById('cg-client-label'); if (cl) cl.textContent = state.jiwi;
    setVal('cg-client', state.client); setVal('cg-caseline', state.caseLine);
    setVal('cg-court', state.court);
    setVal('cg-docs', state.docs); setVal('cg-memo', state.memo);
    segSet('cg-length', state.length);
    setVal('cg-reason', state.reason);
    setVal('cg-date', state.date || fmtDate(todayISO()));
    setVal('cg-att-new', '');
    var gk = document.getElementById('cg-gukseon'); if (gk) gk.checked = !!state.gukseon;
    var st = document.getElementById('cg-stamp'); if (st) st.checked = !!state.stamp;
    if (typeof renderAttChips === 'function') renderAttChips('cg', (state.attorneys && state.attorneys.length) ? state.attorneys : ['서고은']);
  }
  function collect() {
    state.jiwi = segOn('cg-jiwi') || state.jiwi;
    state.client = getVal('cg-client'); state.caseLine = getVal('cg-caseline');
    state.court = getVal('cg-court');
    state.docs = getRaw('cg-docs'); state.memo = getVal('cg-memo');
    state.length = segOn('cg-length') || '간단';
    state.reason = getVal('cg-reason');
    state.date = getVal('cg-date') || fmtDate(todayISO());
    var atts = [];
    document.querySelectorAll('#cg-att .fs-chip.on').forEach(function (c) { atts.push(c.dataset.att); });
    state.attorneys = atts.length ? atts : ['서고은'];
    var gk = document.getElementById('cg-gukseon'); state.gukseon = !!(gk && gk.checked);
    var st = document.getElementById('cg-stamp'); state.stamp = !!(st && st.checked);
  }

  /* ── 검색 자동연동 ── */
  function fetchDept(code, num, cb) {
    fetch(fnUrl('court-lookup'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'apikey': (typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : '') },
      body: JSON.stringify({ schKey: String(code), schVal: String(num) })
    }).then(function (r) { return r.json(); }).then(function (d) { cb((d && d.court_dept) || ''); }).catch(function () { cb(''); });
  }
  function cgOnFill(row) {
    if (!state) return;
    var pos = String(row.client_position || '');
    var jiwi = pos.indexOf('피의자') >= 0 ? '피의자' : '피고인';
    window.cgJiwi(jiwi);
    setVal('cg-client', row.l_client || '');
    setVal('cg-caseline', [row.l_code, cleanCaseName(row.l_name)].filter(Boolean).join(' '));
    var baseCourt = row.court || '';
    setVal('cg-court', baseCourt);
    if (row.l_code && row.l_num) {
      fetchDept(row.l_code, row.l_num, function (dept) { if (dept) setVal('cg-court', (baseCourt ? baseCourt + ' ' : '') + dept); });
    }
  }

  function ensureUI() { injectStyle(); injectShell(); }
  function openForm() {
    ensureUI();
    fillFormFromState();
    document.getElementById('chamgoForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('cg-client', { onFill: cgOnFill });
  }
  window.goChamgo = function () { ensureUI(); state = defaultState(); openForm(); };
  window.closeChamgoForm = function () { var f = document.getElementById('chamgoForm'); if (f) f.classList.remove('active'); };

  // AI 본문 작성
  window.cgDraft = function () {
    var btn = document.getElementById('cg-ai-btn'), hint = document.getElementById('cg-ai-hint');
    var docs = parseDocs(getRaw('cg-docs'));
    if (!docs.length && !getVal('cg-memo')) { if (hint) hint.textContent = '제출서류나 사정 메모를 먼저 적어주세요.'; return; }
    btn.disabled = true; if (hint) hint.textContent = 'AI가 작성 중…';
    var payload = {
      caseType: '참고자료', jiwi: segOn('cg-jiwi') || state.jiwi, name: getVal('cg-client'),
      length: segOn('cg-length') || '간단', docs: docs, memo: getVal('cg-memo'),
      caseName: getVal('cg-caseline')
    };
    fetch(fnUrl('draft-chamgo'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'apikey': (typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : '') },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (d) {
      btn.disabled = false;
      if (d && d.ok && d.reason) { setVal('cg-reason', d.reason); if (hint) hint.textContent = '작성 완료 — 검토·수정 후 다운로드하세요.'; }
      else { if (hint) hint.textContent = '작성 실패: ' + ((d && d.reason) || 'unknown') + ' (직접 입력 가능)'; }
    }).catch(function (e) { btn.disabled = false; if (hint) hint.textContent = '오류: ' + e.message; });
  };

  // 한글 다운로드
  window.cgDownload = function () {
    if (!state) state = defaultState();
    collect();
    var cfg = toCfg(state);
    if (!cfg.docsList.length && !cfg.reason) { alert('제출서류 또는 본문을 먼저 입력해주세요.'); return; }
    buildHwpx(cfg).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = downloadName(state, cfg);
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }).catch(function (e) { alert('HWPX 생성 실패: ' + e.message); });
  };

  /* node 검증용 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fillChamgo: fillChamgo, toCfg: toCfg, downloadName: downloadName, buildPic: buildPic, injectSealPic: injectSealPic, injectBinData: injectBinData, injectHpfManifest: injectHpfManifest, pngSize: pngSize };
  }
})();
