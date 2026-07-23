/* 법무법인 정서 PWA - 합의서 및 처벌불원서 (agreement.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. index.html 에는 <script src="agreement.js"> 만 둔다.
   화면(입력폼)·전용 CSS 는 이 파일이 <body>에 1회 주입한다.

   흐름(참고자료·기일연기와 동일한 단일 단계):
     goAgreement() → [데이터 입력 폼(자동입력)] → [한글 다운로드] (확인창 없음)
     · 한글 다운로드 = templates/agreement.hwpx 를 JSZip 으로 채워 다운로드

   표준양식(피해자가 자필 서명·날인) → 담당변호사·법무법인·도장·귀중 블록 없음.

   폼: 지위(피고인/피의자) · [의뢰인명][사건명] · 피해자 성명·연락처 ·
       합의금액(표준문구/금액입력) · 작성일

   주의(요구사항):
     · 피해자 이름 끝글자 받침에 따라 (은/는) 자동 선택
     · 지위(피의자/피고인)에 따라 본문 지위어 자동 치환(조사 과/와 포함)

   의존: initAutofillFor(autofill.js) · JU(util.js) · FSDoc(fsdoc.js) · JSZip(CDN)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TPL = './templates/agreement.hwpx';
  var JIWI_LABEL = { '피고인': '피 고 인', '피의자': '피 의 자' };

  /* ══════════ 순수 유틸 ══════════ */
  function todayISO() { return JU.todayISO(); }
  function xmlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function cleanCaseName(name) { return String(name || '').replace(/\[전자\]\s*/g, '').trim(); }
  function spaced(name) { return String(name || '').trim().split('').filter(Boolean).join(' '); }
  function fmtDate(iso) {
    var p = ('' + iso).split('-'); if (p.length !== 3) return iso;
    return p[0] + '. ' + parseInt(p[1], 10) + '. ' + parseInt(p[2], 10) + '.';
  }
  function ymd(dateStr) {
    var m = String(dateStr || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : '';
  }

  /* ── 받침 판별(은/는 · 과/와) ── */
  function lastHangul(str) {
    str = String(str || '');
    for (var i = str.length - 1; i >= 0; i--) {
      var c = str.charCodeAt(i);
      if (c >= 0xAC00 && c <= 0xD7A3) return c;
    }
    return 0;
  }
  function hasBatchim(str) { var c = lastHangul(str); return c ? ((c - 0xAC00) % 28) !== 0 : false; }
  function eunNeun(str) { return hasBatchim(str) ? '은' : '는'; }   // 피해자 이름 뒤 조사
  function gwaWa(str) { return hasBatchim(str) ? '과' : '와'; }     // 지위어 뒤 조사(피고인과/피의자와)

  /* ── 합의금액 표기: 숫자면 천단위 콤마+원, 그 외(한글금액 등)는 그대로 ── */
  function fmtAmount(raw) {
    raw = String(raw || '').trim();
    if (!raw) return '';
    if (/^[0-9,\s]*원?$/.test(raw)) {
      var digits = raw.replace(/[^0-9]/g, '');
      if (digits) return Number(digits).toLocaleString('en-US') + '원';
    }
    return raw;
  }

  /* ══════════ HWPX 문단 헬퍼 ══════════ */
  var PARA_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;
  function splitParas(sec) { return sec.match(PARA_RE) || []; }
  function headOf(sec, paras) { return paras.length ? sec.slice(0, sec.indexOf(paras[0])) : sec; }
  function tailOf(sec) { var i = sec.lastIndexOf('</hp:p>'); return i < 0 ? '' : sec.slice(i + 7); }
  function plainText(p) {
    var t = '', re = /<hp:t>([\s\S]*?)<\/hp:t>/g, m;
    while ((m = re.exec(p))) t += m[1].replace(/<[^>]+>/g, '');
    return t;
  }
  function flat(p) { return plainText(p).replace(/\s+/g, ''); }
  // 첫 <hp:t> 의 텍스트만 교체
  function setFirstT(p, txt) { return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/, '<hp:t>' + xmlEsc(txt) + '</hp:t>'); }
  // n번째 <hp:t> 의 텍스트만 교체(0-base)
  function setNthT(p, n, txt) {
    var i = -1;
    return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/g, function (m) { i++; return i === n ? '<hp:t>' + xmlEsc(txt) + '</hp:t>' : m; });
  }
  // 기존 run 껍데기(charPr·서식 보존)의 텍스트만 교체 — 선행 <hp:tab> 은 제거(들여쓰기는 문단 속성으로)
  function runWithText(runXml, text) {
    var r = String(runXml)
      .replace(/<hp:tab\b[^>]*\/>/g, '')
      .replace(/<hp:tab\b[\s\S]*?<\/hp:tab>/g, '');
    if (/<hp:t>[\s\S]*?<\/hp:t>/.test(r)) {
      return r.replace(/<hp:t>[\s\S]*?<\/hp:t>/, '<hp:t>' + xmlEsc(text) + '</hp:t>');
    }
    return r.replace(/(<hp:run\b[^>]*>)/, '$1<hp:t>' + xmlEsc(text) + '</hp:t>');
  }
  // 본문 문단의 paraPrIDRef (헤더 들여쓰기 보정 대상)
  function bodyParaPrId(sec) {
    var P = splitParas(sec);
    for (var i = 0; i < P.length; i++) {
      if (flat(P[i]).indexOf('위사건과관련하여') === 0) {
        var m = P[i].match(/paraPrIDRef="(\d+)"/); return m ? m[1] : null;
      }
    }
    return null;
  }
  // 본문 문단 첫 줄 들여쓰기 보정: 음수(내어쓰기) intent → 양수(들여쓰기, 한 글자=1200)
  var FIRST_LINE_INDENT = 1200;
  function fixHeader(hdr, pid) {
    if (!pid) return hdr;
    var re = new RegExp('(<hh:paraPr id="' + pid + '"[\\s\\S]*?<hc:intent value=")[-\\d]+(")');
    return hdr.replace(re, '$1' + FIRST_LINE_INDENT + '$2');
  }

  /* ══════════ 본문 문안 생성 ══════════ */
  // 지위어(피고인/피의자) + 조사(과/와) + 합의금액 반영
  function bodyMain(c) {
    var s = c.jiwi;                                     // '피고인' | '피의자'
    var amt = c.amount ? ('합의금 ' + c.amount + '을 변제 받아') : '합당한 합의 금액을 변제 받아';
    return ' ' + s + gwaWa(s) + ' 원만한 합의를 하였으며, ' + amt +
      ' 피해 회복이 되었으므로 더 이상 ' + s + '의 처벌을 원치 않으며, 추후 ' + s +
      '에 대하여 민·형사상의 어떠한 책임도 묻지 않겠습니다.';
  }

  /* ══════════ 문단별 채우기 ══════════
     양식 문단(텍스트로 식별 → 인덱스 어긋남에 강건):
       · 제목            '합의서 및 처벌불원서'   (고정)
       · 사건            '사  건  …'
       · 지위+이름       '피 고 인  …' / '피 의 자  …'
       · 피해자 성명     '피 해 자  성 명  …'  → 성명 뒤 이름
       · 연락처          '연 락 처  …'         → 뒤 연락처
       · 본문            ' 위 사건과 관련하여 피해자 ' + '(은)는' + ' 피고인과 …'  (3 run)
       · 작성일          'YYYY. M. D.'
       · 서명란          '… 피해자    (인)'    → 이름 삽입
     ─────────────────────────────────────────── */
  function fillDoc(sec, c) {
    var P = splitParas(sec), head = headOf(sec, P), tail = tailOf(sec);
    var victimSp = spaced(c.victim);
    var out = [];
    for (var i = 0; i < P.length; i++) {
      var p = P[i], f = flat(p), raw = plainText(p);
      if (!raw.trim()) { out.push(p); continue; }                          // 빈 문단 보존

      if (f.indexOf('합의서및처벌불원서') === 0) {                          // 제목: 고정
        out.push(p);
      } else if (f.indexOf('사건') === 0) {                                // 사건
        out.push(setFirstT(p, raw.replace(/(건\s+)[\s\S]*/, '$1' + c.caseLine)));
      } else if (f.indexOf('피고인') === 0 || f.indexOf('피의자') === 0) { // 지위 라벨 + 이름
        out.push(setFirstT(p, (JIWI_LABEL[c.jiwi] || '피 고 인') + '   ' + spaced(c.defendant)));
      } else if (f.indexOf('피해자성명') === 0) {                          // 피해자 성명
        out.push(setFirstT(p, raw.replace(/\s*$/, '') + '   ' + victimSp));
      } else if (f.indexOf('연락처') === 0) {                              // 연락처
        out.push(setFirstT(p, raw.replace(/\s*$/, '') + '   ' + c.contact));
      } else if (f.indexOf('위사건과관련하여') === 0) {                    // 본문
        // run 재구성: [일반]"위 사건과 관련하여 피해자 " + [밑줄]이름 + [일반]"은/는 …본문"
        //  · 이름은 밑줄 run(원본 run1, charPr 18)으로 강조, 조사·본문은 일반 run(charPr 17)
        //  · 선행 <hp:tab> 제거 → 첫 줄 들여쓰기는 문단 속성(fixHeader)으로 통일
        var runs = p.match(/<hp:run\b[\s\S]*?<\/hp:run>/g) || [];
        var normalRun = runs[2] || runs[0];      // 밑줄 없음(charPr 17)
        var underlineRun = runs[1] || runs[0];   // 밑줄(charPr 18) — 피해자 이름 강조
        var newRuns =
          runWithText(normalRun, '위 사건과 관련하여 피해자 ') +
          runWithText(underlineRun, c.victim) +
          runWithText(normalRun, eunNeun(c.victim) + bodyMain(c));
        out.push(p.replace(/<hp:run\b[\s\S]*<\/hp:run>/, newRuns));
      } else if (f.indexOf('(인)') >= 0 && f.indexOf('피해자') >= 0) {      // 서명란
        // "피해자 홍길동 (인)" 은 반드시 한 줄 — 좌측 정렬 위치(선행 공백)는 유지, 이름은 원문 그대로
        var lead = (raw.match(/^\s*/) || [''])[0];
        out.push(setFirstT(p, lead + '피해자 ' + c.victim + ' (인)'));
      } else if (/^\s*\d{4}\s*\./.test(raw)) {                             // 작성일
        var lead = (raw.match(/^\s*/) || [''])[0];
        out.push(setFirstT(p, lead + fmtDate(c.dateISO)));
      } else {
        out.push(p);
      }
    }
    return head + out.join('') + tail;
  }

  /* ══════════ JSZip 로드 + hwpx 빌드 ══════════ */
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
    var Zip;
    return loadJSZip()
      .then(function (JSZip) { Zip = JSZip; return fetch(TPL); })
      .then(function (r) { if (!r.ok) throw new Error('템플릿 로드 실패: ' + TPL); return r.arrayBuffer(); })
      .then(function (buf) { return Zip.loadAsync(buf); })
      .then(function (zip) {
        return Promise.all([
          zip.file('Contents/section0.xml').async('string'),
          zip.file('Contents/header.xml').async('string'),
          zip
        ]).then(function (arr) {
          var origSec = arr[0], hdr = arr[1], zip2 = arr[2];
          var pid = bodyParaPrId(origSec);
          var sec = fillDoc(origSec, cfg);
          // 줄 레이아웃 캐시 제거 — 원문 좌표가 남으면 한글이 '손상/변조'로 차단. 열 때 재계산.
          sec = sec.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '').replace(/<hp:linesegarray\s*\/>/g, '');
          hdr = fixHeader(hdr, pid);   // 본문 첫 줄 들여쓰기 보정
          var zo = new Zip();
          return zip2.file('mimetype').async('uint8array').then(function (mime) {
            zo.file('mimetype', mime, { compression: 'STORE' });
            var names = Object.keys(zip2.files).filter(function (n) { return n !== 'mimetype' && !zip2.files[n].dir; });
            return Promise.all(names.map(function (n) {
              if (n === 'Contents/section0.xml') return Promise.resolve([n, sec]);
              if (n === 'Contents/header.xml') return Promise.resolve([n, hdr]);
              return zip2.file(n).async('uint8array').then(function (d) { return [n, d]; });
            })).then(function (entries) {
              entries.forEach(function (e) { zo.file(e[0], e[1]); });
              return zo.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip' });
            });
          });
        });
      });
  }

  /* ══════════ 상태 + cfg ══════════ */
  var state = null;
  function defaultState() {
    return {
      jiwi: '피고인', defendant: '', caseLine: '',
      victim: '', contact: '',
      amtMode: '표준', amount: '',
      dateISO: todayISO()
    };
  }
  function toCfg(s) {
    return {
      jiwi: s.jiwi, defendant: s.defendant, caseLine: s.caseLine,
      victim: s.victim, contact: s.contact,
      amount: s.amtMode === '금액' ? fmtAmount(s.amount) : '',
      dateISO: s.dateISO || todayISO()
    };
  }
  function baseName(s) {
    var parts = ['합의서및처벌불원서', s.victim, s.caseLine, ymd(s.dateISO)].filter(Boolean);
    return parts.join('_').replace(/[\/\\:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function downloadName(s) { return baseName(s) + '.hwpx'; }

  /* ══════════ CSS ══════════ */
  var STYLE_ID = 'agreement-style';
  var AG_CSS =
    '#agreementForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#agreementForm.active{display:flex;}' +
    '#agreementForm .ag-pick{display:flex;align-items:center;gap:10px;margin:0 0 9px;}' +
    '#agreementForm .ag-pick-l{flex:none;min-width:66px;font-size:13px;color:var(--gray-700,#555);}' +
    '#agreementForm .ag-pick .fs-chips{flex:1;gap:6px;}' +
    '#agreementForm .fs-chips .fs-chip{padding:6px 13px;font-size:13px;}' +
    '#agreementForm .ag-row2{display:flex;gap:10px;}' +
    '#agreementForm .ag-row2>.fs-field{flex:1;min-width:0;}' +
    '#agreementForm .ag-amt{display:none;}' +
    '#agreementForm.amt-on .ag-amt{display:block;}' +
    // ── 미리보기(오버레이) + A4 문서 렌더 ──
    '#agreementPreview{display:none;position:fixed;inset:0;z-index:1200;background:#525659;flex-direction:column;}' +
    '#agreementPreview.active{display:flex;}' +
    '#agreementPreview .agp-head,#agreementPreview .agp-foot{flex:none;display:flex;align-items:center;gap:8px;background:#2b2d30;color:#fff;padding:10px 14px;}' +
    '#agreementPreview .agp-head{justify-content:flex-start;}' +
    '#agreementPreview .agp-head .fs-title{color:#fff;font-size:15px;font-weight:700;}' +
    '#agreementPreview .agp-head .fs-close{color:#fff;}' +
    '#agreementPreview .agp-foot{justify-content:flex-end;flex-wrap:wrap;}' +
    '#agreementPreview .agp-scroll{flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:16px;}' +
    '#agreementPreview .agp-stage{flex:none;}' +
    '.agp-page{width:210mm;min-height:297mm;box-sizing:border-box;padding:22mm 26mm;background:#fff;color:#000;' +
      "font-family:'바탕',Batang,'Noto Serif KR','AppleMyungjo',serif;font-size:12pt;line-height:2.0;box-shadow:0 4px 24px rgba(0,0,0,.4);}" +
    '.agp-page .agp-title{text-align:center;font-size:19pt;font-weight:700;letter-spacing:.35em;margin:2mm 0 12mm;}' +
    '.agp-page .agp-line{display:flex;gap:.4em;margin:1.2mm 0;}' +
    '.agp-page .agp-lbl{flex:0 0 6.2em;white-space:nowrap;}' +
    '.agp-page .agp-val{flex:1;min-width:0;}' +
    '.agp-page .agp-sub{margin-right:.6em;}' +
    '.agp-page .agp-body{text-align:justify;text-indent:1em;margin:8mm 0;line-height:2.1;}' +
    '.agp-page .agp-body u{text-underline-offset:2px;}' +
    '.agp-page .agp-gap{height:5mm;}' +
    '.agp-page .agp-gaplg{height:16mm;}' +
    '.agp-page .agp-date{text-align:center;letter-spacing:.08em;margin:2mm 0;}' +
    '.agp-page .agp-sign{text-align:right;padding-right:6mm;margin-top:6mm;letter-spacing:.04em;}';
  function injectStyle() { FSDoc.injectOnce(STYLE_ID, AG_CSS); }

  /* ══════════ 화면 껍데기 ══════════ */
  var SHELL_ID = 'agreement-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="agreementForm">' +
        '<div class="fs-card">' +
          '<div class="fs-head">' +
            '<button class="fs-close" onclick="closeAgreementForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '<div class="fs-title">합의서 및 처벌불원서</div>' +
          '</div>' +
          '<div class="fs-body">' +
            '<div class="ag-pick"><span class="ag-pick-l">지위</span><div class="fs-chips" id="ag-jiwi">' +
              '<span class="fs-chip on" data-v="피고인" onclick="agJiwi(\'피고인\')">피고인</span>' +
              '<span class="fs-chip" data-v="피의자" onclick="agJiwi(\'피의자\')">피의자</span></div></div>' +

            '<div class="fs-section">사건 정보</div>' +
            '<div class="ag-row2">' +
              '<div class="fs-field"><label class="fs-label" id="ag-defendant-label">피고인</label><input type="text" class="fs-input" id="ag-defendant" placeholder="윤한덕"></div>' +
              '<div class="fs-field"><label class="fs-label">사건</label><input type="text" class="fs-input" id="ag-caseline" placeholder="2026고합69 사기 등"></div>' +
            '</div>' +

            '<div class="fs-section">피해자</div>' +
            '<div class="ag-row2">' +
              '<div class="fs-field"><label class="fs-label">성명</label><input type="text" class="fs-input" id="ag-victim" placeholder="홍길동"></div>' +
              '<div class="fs-field"><label class="fs-label">연락처</label><input type="text" class="fs-input" id="ag-contact" placeholder="010-0000-0000"></div>' +
            '</div>' +

            '<div class="fs-section">합의금액</div>' +
            '<div class="ag-pick"><span class="ag-pick-l">표기 방식</span><div class="fs-chips" id="ag-amtmode">' +
              '<span class="fs-chip on" data-v="표준" onclick="agAmtMode(\'표준\')">표준문구</span>' +
              '<span class="fs-chip" data-v="금액" onclick="agAmtMode(\'금액\')">금액 입력</span></div></div>' +
            '<div class="fs-field ag-amt"><label class="fs-label">합의금액 <span class="fs-hint">(숫자 입력 시 "합의금 30,000,000원…"으로 삽입 · 비우면 표준문구)</span></label>' +
              '<input type="text" class="fs-input" id="ag-amount" placeholder="30,000,000"></div>' +

            '<div class="fs-section">작성일</div>' +
            '<div class="fs-field"><label class="fs-label">작성일</label><input type="date" class="fs-input" id="ag-date"></div>' +
          '</div>' +
          '<div class="fs-foot">' +
            '<button class="fs-btn ghost" onclick="closeAgreementForm()">취소</button>' +
            '<button class="fs-btn" onclick="agPreview()">미리보기</button>' +
            '<button class="fs-btn primary" onclick="agDownload()">한글 다운로드</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="agreementPreview">' +
        '<div class="agp-head">' +
          '<button class="fs-close" onclick="closeAgPreview()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
          '<div class="fs-title">미리보기</div>' +
        '</div>' +
        '<div class="agp-scroll"><div class="agp-stage" id="agp-stage"><div class="agp-page" id="agp-page"></div></div></div>' +
        '<div class="agp-foot">' +
          '<button class="fs-btn ghost" onclick="closeAgPreview()">닫기</button>' +
          '<button class="fs-btn" id="ag-btn-img" onclick="agSaveImage()">사진 다운로드</button>' +
          '<button class="fs-btn" id="ag-btn-pdf" onclick="agSavePdf()">PDF 다운로드</button>' +
          '<button class="fs-btn primary" onclick="agDownload()">한글 다운로드</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  /* ══════════ 미리보기 렌더(표준양식과 동일 레이아웃) ══════════ */
  function htmlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function previewHtml(c) {
    var jiwiLabel = (JIWI_LABEL[c.jiwi] || '피 고 인');
    var particle = eunNeun(c.victim);
    var rest = bodyMain(c).replace(/^\s+/, '');   // '피고인과 원만한 …'
    return '' +
      '<div class="agp-title">합의서 및 처벌불원서</div>' +
      '<div class="agp-line"><span class="agp-lbl">사&nbsp;&nbsp;&nbsp;&nbsp;건</span><span class="agp-val">' + htmlEsc(c.caseLine) + '</span></div>' +
      '<div class="agp-line"><span class="agp-lbl">' + htmlEsc(jiwiLabel) + '</span><span class="agp-val">' + htmlEsc(spaced(c.defendant)) + '</span></div>' +
      '<div class="agp-line"><span class="agp-lbl">피&nbsp;해&nbsp;자</span><span class="agp-val"><span class="agp-sub">성&nbsp;&nbsp;명</span>' + htmlEsc(spaced(c.victim)) + '</span></div>' +
      '<div class="agp-line"><span class="agp-lbl"></span><span class="agp-val"><span class="agp-sub">연&nbsp;락&nbsp;처</span>' + htmlEsc(c.contact) + '</span></div>' +
      '<div class="agp-gap"></div>' +
      '<div class="agp-body">위 사건과 관련하여 피해자 <u>' + htmlEsc(c.victim) + '</u>' + particle + ' ' + htmlEsc(rest) + '</div>' +
      '<div class="agp-gaplg"></div>' +
      '<div class="agp-date">' + htmlEsc(fmtDate(c.dateISO)) + '</div>' +
      '<div class="agp-gap"></div>' +
      '<div class="agp-sign">피해자&nbsp;&nbsp;&nbsp;' + htmlEsc(c.victim) + '&nbsp;&nbsp;&nbsp;(인)</div>';
  }
  function fitPreview() {
    var page = document.getElementById('agp-page'), stage = document.getElementById('agp-stage');
    if (!page || !stage) return;
    page.style.transform = 'none';
    var w = page.offsetWidth, h = page.offsetHeight;
    var avail = (window.innerWidth || 800) - 32;
    var s = Math.min(1, avail / w);
    page.style.transformOrigin = 'top left';
    page.style.transform = s < 1 ? ('scale(' + s + ')') : 'none';
    stage.style.width = (w * s) + 'px';
    stage.style.height = (h * s) + 'px';
  }
  var _pv = null;
  window.agPreview = function () {
    collect();
    if (!state.victim) { alert('피해자 성명을 입력해 주세요.'); return; }
    _pv = state;
    var page = document.getElementById('agp-page');
    if (page) page.innerHTML = previewHtml(toCfg(state));
    document.getElementById('agreementPreview').classList.add('active');
    fitPreview();
  };
  window.closeAgPreview = function () { var p = document.getElementById('agreementPreview'); if (p) p.classList.remove('active'); };
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', function () {
    var p = document.getElementById('agreementPreview');
    if (p && p.classList.contains('active')) fitPreview();
  });

  /* ── PDF/PNG 저장: A4 렌더를 html2canvas 로 캡처 → 앱 공용 유틸 재사용 ── */
  function captureCanvas() {
    var page = document.getElementById('agp-page');
    var pt = page.style.transform, po = page.style.transformOrigin;
    page.style.transform = 'none';
    return html2canvas(page, {
      scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff',
      logging: false, windowWidth: page.offsetWidth, windowHeight: page.offsetHeight
    }).then(function (cv) { page.style.transform = pt; page.style.transformOrigin = po; return cv; })
      .catch(function (e) { page.style.transform = pt; page.style.transformOrigin = po; throw e; });
  }
  function dl(blob, fname) {
    if (typeof window.directDownload === 'function') return window.directDownload(blob, fname);
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function cvToBlob(cv) {
    return new Promise(function (res) {
      if (cv.toBlob) cv.toBlob(function (b) { res(b); }, 'image/png');
      else { var bin = atob(cv.toDataURL('image/png').split(',')[1]), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); res(new Blob([arr], { type: 'image/png' })); }
    });
  }
  function busy(id, on, txt) { var b = document.getElementById(id); if (b) { b.disabled = on; if (txt != null) b.textContent = txt; } }
  window.agSaveImage = function () {
    if (typeof html2canvas !== 'function') { alert('이미지 모듈을 불러오지 못했습니다.'); return; }
    busy('ag-btn-img', true, '만드는 중…');
    captureCanvas().then(cvToBlob).then(function (blob) {
      dl(blob, baseName(_pv || state) + '.png');
    }).catch(function (e) { alert('사진 저장 실패: ' + (e && e.message ? e.message : e)); })
      .then(function () { busy('ag-btn-img', false, '사진 다운로드'); });
  };
  window.agSavePdf = function () {
    if (typeof html2canvas !== 'function') { alert('이미지 모듈을 불러오지 못했습니다.'); return; }
    var jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);
    if (!jsPDFCtor) { alert('PDF 모듈을 불러오지 못했습니다.'); return; }
    busy('ag-btn-pdf', true, '만드는 중…');
    captureCanvas().then(function (cv) {
      var pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      if (typeof window.addCanvasesToPdf === 'function') {
        window.addCanvasesToPdf(pdf, [cv], 210, 297);
      } else {
        var k = 210 / cv.width, fullH = cv.height * k;
        pdf.addImage(cv.toDataURL('image/png'), 'PNG', 0, Math.max(0, (297 - fullH) / 2), 210, fullH, undefined, 'FAST');
      }
      dl(pdf.output('blob'), baseName(_pv || state) + '.pdf');
    }).catch(function (e) { alert('PDF 저장 실패: ' + (e && e.message ? e.message : e)); })
      .then(function () { busy('ag-btn-pdf', false, 'PDF 다운로드'); });
  };

  /* ══════════ DOM 유틸 ══════════ */
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function segSet(groupId, v) {
    var g = document.getElementById(groupId); if (!g) return;
    g.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
  }
  function segOn(groupId) {
    var g = document.getElementById(groupId); if (!g) return '';
    var b = g.querySelector('[data-v].on'); return b ? b.getAttribute('data-v') : '';
  }

  window.agJiwi = function (v) {
    if (state) state.jiwi = v;
    segSet('ag-jiwi', v);
    var cl = document.getElementById('ag-defendant-label'); if (cl) cl.textContent = v;
  };
  window.agAmtMode = function (v) {
    if (state) state.amtMode = v;
    segSet('ag-amtmode', v);
    var f = document.getElementById('agreementForm'); if (f) f.classList.toggle('amt-on', v === '금액');
  };

  function fillFormFromState() {
    window.agJiwi(state.jiwi);
    setVal('ag-defendant', state.defendant); setVal('ag-caseline', state.caseLine);
    setVal('ag-victim', state.victim); setVal('ag-contact', state.contact);
    window.agAmtMode(state.amtMode); setVal('ag-amount', state.amount);
    setVal('ag-date', state.dateISO || todayISO());
  }
  function collect() {
    state.jiwi = segOn('ag-jiwi') || state.jiwi;
    state.defendant = getVal('ag-defendant'); state.caseLine = getVal('ag-caseline');
    state.victim = getVal('ag-victim'); state.contact = getVal('ag-contact');
    state.amtMode = segOn('ag-amtmode') || '표준';
    state.amount = getVal('ag-amount');
    state.dateISO = getVal('ag-date') || todayISO();
  }

  /* ── 자동입력 연동(사건DB): 지위·의뢰인명·사건 자동 채움. 피해자는 수기. ── */
  function agOnFill(row) {
    if (!state) return;
    var pos = String(row.client_position || '');
    var jiwi = pos.indexOf('피의자') >= 0 ? '피의자' : '피고인';
    window.agJiwi(jiwi);
    setVal('ag-defendant', row.l_client || '');
    setVal('ag-caseline', [row.l_code, cleanCaseName(row.l_name)].filter(Boolean).join(' '));
  }

  function ensureUI() { injectStyle(); injectShell(); }
  function openForm() {
    ensureUI();
    fillFormFromState();
    document.getElementById('agreementForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('ag-defendant', { onFill: agOnFill });
  }
  window.goAgreement = function () { ensureUI(); state = defaultState(); openForm(); };
  window.closeAgreementForm = function () { var f = document.getElementById('agreementForm'); if (f) f.classList.remove('active'); };

  window.agDownload = function () {
    collect();
    if (!state.victim) { alert('피해자 성명을 입력해 주세요.'); return; }
    var s = state, cfg = toCfg(s);
    buildHwpx(cfg).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = downloadName(s);
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    }).catch(function (e) {
      console.error('[agreement] 다운로드 실패:', e);
      alert('한글 파일 생성에 실패했습니다: ' + (e && e.message ? e.message : e));
    });
  };

  /* node 검증용(브라우저에선 무시됨) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fillDoc: fillDoc, bodyMain: bodyMain, eunNeun: eunNeun, gwaWa: gwaWa,
      hasBatchim: hasBatchim, fmtAmount: fmtAmount, spaced: spaced,
      toCfg: toCfg, downloadName: downloadName, baseName: baseName,
      bodyParaPrId: bodyParaPrId, fixHeader: fixHeader, previewHtml: previewHtml
    };
  }
})();
