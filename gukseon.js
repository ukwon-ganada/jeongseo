/* 법무법인 정서 PWA - 국선변호보수증액등신청서 (gukseon.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. index.html 에는 진입점 버튼 + <script src="gukseon.js"> 만 둔다.
   화면(입력폼·서면)·전용 CSS 는 이 파일이 <body>에 1회 주입한다.
   원본 서식: Public-Defender/gukseon-case-manager.jsx 의 FeeForm 을 재현.

   진입점(홈 버튼): onclick="goGukseon()"
   흐름: goGukseon() → 입력폼 → 완료 → 서면 → window.print()

   의존:
     · showScreen(id)      : index.html 공용 화면 전환 (열람·복사·항소장과 동일)
     · SEAL_SEOGOEUN       : 전역 도장 base64 (index.html) — 서고은 선택 시 날인
     · initAutofillFor()   : autofill.js 범용 자동완성 (data-af 표준)
       재판부는 표준 밖 → initAutofillFor(anchor, {courtDept:'칸id'}) 확장 인자로 위임
     · JU (util.js)        : esc / todayISO
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── 상수 ─────────────────────────────────────────── */
  // 국선변호인(서명자) — 서고은 변호사만 주민번호·직인 보유, 그 외는 실물 기재/날인
  var ATTORNEYS = [
    { name: '서고은', rrn: '840219-2079920' },
    { name: '정필성', rrn: '' },
    { name: '김홍일', rrn: '' },
    { name: '양선화', rrn: '' },
    { name: '우숭민', rrn: '' },
    { name: '이예나', rrn: '' },
    { name: '손영우', rrn: '' }
  ];
  var COURT_DEFAULT = '인천지방법원';
  var COURTDIV_DEFAULT = '형사7단독';

  // 증액 사유 항목 (원본 ESCALATE 그대로)
  var ESCALATE = [
    { type: 'check', key: 'r1', text: '심문기일이 휴일 (50% 이내)' },
    { type: 'check', key: 'r2', text: '구속적부심 심문기일에서 변론 (50% 이내)' },
    { type: 'check', key: 'r3', text: '구속영장 발부사건 불기소 또는 약식명령 종결 (100% 이내)' },
    { type: 'check', key: 'r4', text: '수사단계에서 의견서, 증거 제출' },
    { type: 'check', key: 'r5', text: '수사단계에서 피의자신문과정 참여' },
    { type: 'check', key: 'r6', text: '피의자(피고인) 가족과의 접견' },
    { type: 'num2', text: '피의자(피고인) 접견횟수 1회 초과 (30% 이내)', a: 'visit_t', b: 'visit_o', ua: '회', ub: '회' },
    { type: 'num2', text: '피의자(피고인)의 수 1인 초과 (50% 이내)', a: 'person_t', b: 'person_o', ua: '인', ub: '인' },
    { type: 'num2', text: '공판기일(심문기일) 법정출석횟수 2회 초과 (30% 이내)', a: 'attend_t', b: 'attend_o', ua: '회', ub: '회' },
    { type: 'num2', text: '주신문 또는 반대신문을 한 증인의 수 1인 초과 (50% 이내)', a: 'witness_t', b: 'witness_o', ua: '인', ub: '인' },
    { type: 'num1', text: '법정 외 기일 출석 (50% 이내)', a: 'outcourt', ua: '회' },
    { type: 'check', key: 'r12', text: '공판단계에서 증거 제출' },
    { type: 'check', key: 'r13', text: '공판단계에서 변론요지서(의견서 등) 제출' }
  ];

  var COPY_RANGES = [
    '100장 이하',
    '101장 이상 ~ 200장 이하',
    '201장 이상 ~ 300장 이하',
    '301장 이상 ~ 400장 이하',
    '401장 이상 ~ 500장 이하',
    '500장 초과'
  ];

  /* ── 도우미 (공용 util.js 위임) ── */
  function esc(v) { return JU.esc(v); }
  function todayISO() { return JU.todayISO(); }

  function rrnFor(name) {
    for (var i = 0; i < ATTORNEYS.length; i++) {
      if (ATTORNEYS[i].name === name) return ATTORNEYS[i].rrn;
    }
    return '';
  }

  /* ══════════════════════════════════════════════════════════════
     서면 렌더 (순수 함수) — 값 객체 v 를 받아 인쇄용 서면 HTML 을 돌려준다.
     도장: attorney === '서고은' 이고 전역 SEAL_SEOGOEUN 있으면 직인 이미지.
     ══════════════════════════════════════════════════════════════ */
  function docChk(on) {
    return '<span class="gk-docchk' + (on ? ' on' : '') + '">' + (on ? '√' : '') + '</span>';
  }
  function rrow(desc, val) {
    return '<div class="gk-doc-rrow">' +
      '<div class="gk-doc-desc gk-flex">' + esc(desc) + '</div>' +
      '<div class="gk-doc-val">' + val + '</div></div>';
  }
  function renderEscRows(v) {
    return ESCALATE.map(function (it) {
      var val;
      if (it.type === 'check') {
        val = docChk(v[it.key]);
      } else if (it.type === 'num1') {
        val = '<span class="gk-pw">( ' + esc(v[it.a] || '') + ' )' + esc(it.ua) + '</span>';
      } else {
        val = '<span class="gk-pw">총 ( ' + esc(v[it.a] || '') + ' )' + esc(it.ua) +
          ', 초과 ( ' + esc(v[it.b] || '') + ' )' + esc(it.ub) + '</span>';
      }
      return '<div class="gk-doc-rrow">' +
        '<div class="gk-doc-desc gk-flex">' + esc(it.text) + '</div>' +
        '<div class="gk-doc-val">' + val + '</div></div>';
    }).join('');
  }
  function renderCopyOpts(sel) {
    return COPY_RANGES.map(function (r) {
      return '<span class="gk-copy-opt' + (sel === r ? ' on' : '') + '">' +
        '<span class="gk-copy-box">' + (sel === r ? '√' : '') + '</span>' + esc(r) + '</span>';
    }).join('');
  }

  function renderGukseon(v) {
    v = v || {};
    var seal = (typeof SEAL_SEOGOEUN !== 'undefined') ? SEAL_SEOGOEUN : '';
    var sealHTML = (v.attorney === '서고은' && seal)
      ? '<img class="gk-seal" src="' + seal + '" alt="">' : '';

    var dp = ('' + (v.writeDate || todayISO())).split('-');
    var y = dp[0] || '', m = parseInt(dp[1], 10) || '', d = parseInt(dp[2], 10) || '';
    var caseLine = [v.casenum, v.casename].filter(Boolean).join('  ');

    var silbi = '' +
      rrow('피의자(피고인) 접견횟수 (실비)', '<span class="gk-pw">총 ( ' + esc(v.exp_visit || '') + ' )회</span>') +
      '<div class="gk-doc-rrow">' +
        '<div class="gk-doc-desc-narrow">기록 복사 (실비)</div>' +
        '<div class="gk-doc-copy gk-flex">' + renderCopyOpts(v.copy) + '</div></div>' +
      rrow('통역, 번역 시행 (실비)', docChk(v.interp_chk) + '<span class="gk-pw">, ( ' + esc(v.interp_amt || '') + ' )원</span>') +
      rrow('변론활동 위한 여비, 숙박비, 식비 기타 비용 지출 (실비)', docChk(v.travel_chk) + '<span class="gk-pw">, ( ' + esc(v.travel_amt || '') + ' )원</span>');

    return '' +
    '<h2 class="gk-doc-title">국선변호보수증액등신청서</h2>' +
    '<div class="gk-doc-box">' +
      '<div class="gk-doc-row"><div class="gk-doc-th">사건번호</div>' +
        '<div class="gk-doc-td gk-flex">' + esc(caseLine) + '</div></div>' +
      '<div class="gk-doc-row"><div class="gk-doc-th">피고인</div>' +
        '<div class="gk-doc-td gk-flex">' + esc(v.defendant || '') + '</div></div>' +
      '<div class="gk-doc-row"><div class="gk-doc-sayu gk-flex">사 유</div>' +
        '<div class="gk-doc-instr">(해당란 □에 √ 표시 또는 기재)</div></div>' +
      '<div class="gk-doc-band"><div class="gk-doc-vlabel">증액</div>' +
        '<div class="gk-doc-rows gk-flex">' + renderEscRows(v) + '</div></div>' +
      '<div class="gk-doc-band"><div class="gk-doc-vlabel">실비</div>' +
        '<div class="gk-doc-rows gk-flex">' + silbi + '</div></div>' +
      '<div class="gk-doc-row"><div class="gk-doc-td gk-flex gk-doc-etc">' +
        '<span class="gk-doc-etc-label">기타 :</span>' +
        '<span class="gk-flex">' + esc(v.etc || '') + '</span></div></div>' +
    '</div>' +

    '<p class="gk-doc-statement">위 사건에 관하여 국선변호 보수의 증액 또는 실비의 변상을 신청합니다.</p>' +

    '<div class="gk-doc-sign">' +
      '<p class="gk-doc-date">' + esc(y) + '. ' + esc(m) + '. ' + esc(d) + '.</p>' +
      '<p class="gk-doc-attorney">국선변호인 변호사 ' + esc(v.attorney || '서고은') +
        ' <span class="gk-seal-wrap">(인)' + sealHTML + '</span></p>' +
      '<p class="gk-doc-rrn">( 주민등록번호 : ' + esc(v.rrn || '') + ' )</p>' +
    '</div>' +

    '<p class="gk-doc-court">' + esc(v.court || '') + ' ' + esc(v.courtDiv || '') + ' 귀중</p>';
  }

  /* ══════════════════════════════════════════════════════════════
     전용 CSS 주입 (1회) — 원본 gk-doc-* 스타일 이식 + A4 인쇄.
     문서는 흑백이므로 체크마크·괄호선은 검정으로 고정.
     ══════════════════════════════════════════════════════════════ */
  var STYLE_ID = 'gukseon-style';
  var GK_CSS =
    /* 서면 페이지 (열람·복사 .yl-page 방식) */
    '.gk-wrap{overflow:auto;padding:16px;background:#e9e9ec;min-height:100%;}' +
    ".gk-page{width:210mm;min-height:297mm;background:#fff;margin:0 auto;padding:18mm 20mm;" +
      "box-shadow:0 2px 14px rgba(0,0,0,.18);color:#000;" +
      "font-family:'맑은 고딕','Malgun Gothic',sans-serif;box-sizing:border-box;}" +
    '.gk-page .gk-flex{flex:1 1 auto;min-width:0;}' +
    '.gk-page .gk-pw{display:inline-flex;align-items:center;white-space:nowrap;}' +
    /* 원본 gk-doc-* (Public-Defender 이식) */
    '#screen-gukseon .gk-doc-title{text-align:center;font-size:22px;font-weight:800;letter-spacing:-0.5px;margin:0 0 22px;}' +
    '#screen-gukseon .gk-doc-box{border-top:1px solid #000;border-left:1px solid #000;}' +
    '#screen-gukseon .gk-doc-row{display:flex;}' +
    '#screen-gukseon .gk-doc-th{width:120px;flex-shrink:0;padding:9px 6px;text-align:center;font-size:13.5px;font-weight:600;' +
      'border-right:1px solid #000;border-bottom:1px solid #000;display:flex;align-items:center;justify-content:center;}' +
    '#screen-gukseon .gk-doc-td{padding:6px 10px;border-right:1px solid #000;border-bottom:1px solid #000;display:flex;align-items:center;}' +
    '#screen-gukseon .gk-doc-sayu{padding:7px;text-align:center;font-size:14px;font-weight:600;letter-spacing:4px;' +
      'border-right:1px solid #000;border-bottom:1px solid #000;display:flex;align-items:center;justify-content:center;}' +
    '#screen-gukseon .gk-doc-instr{width:220px;flex-shrink:0;padding:6px 4px;text-align:center;font-size:10.5px;line-height:1.3;' +
      'border-right:1px solid #000;border-bottom:1px solid #000;display:flex;align-items:center;justify-content:center;}' +
    '#screen-gukseon .gk-doc-band{display:flex;}' +
    '#screen-gukseon .gk-doc-vlabel{width:30px;flex-shrink:0;font-size:13.5px;font-weight:600;' +
      'border-right:1px solid #000;border-bottom:1px solid #000;display:flex;align-items:center;justify-content:center;' +
      'writing-mode:vertical-rl;text-orientation:upright;letter-spacing:2px;}' +
    '#screen-gukseon .gk-doc-rows{display:flex;flex-direction:column;}' +
    '#screen-gukseon .gk-doc-rrow{display:flex;min-height:30px;}' +
    '#screen-gukseon .gk-doc-desc{padding:5px 9px;font-size:12.5px;line-height:1.35;' +
      'border-right:1px solid #000;border-bottom:1px solid #000;display:flex;align-items:center;}' +
    '#screen-gukseon .gk-doc-desc-narrow{width:118px;flex-shrink:0;padding:5px 9px;font-size:12.5px;' +
      'border-right:1px solid #000;border-bottom:1px solid #000;display:flex;align-items:center;}' +
    '#screen-gukseon .gk-doc-val{width:220px;flex-shrink:0;padding:4px 6px;font-size:12px;' +
      'border-right:1px solid #000;border-bottom:1px solid #000;display:flex;align-items:center;justify-content:center;gap:2px;white-space:nowrap;}' +
    '#screen-gukseon .gk-doc-copy{padding:5px 6px;border-right:1px solid #000;border-bottom:1px solid #000;display:flex;flex-wrap:wrap;}' +
    '#screen-gukseon .gk-doc-etc{border-right:1px solid #000;border-bottom:1px solid #000;}' +
    '#screen-gukseon .gk-doc-etc-label{font-size:13px;font-weight:600;flex-shrink:0;margin-right:4px;}' +
    '#screen-gukseon .gk-docchk{width:18px;height:18px;border:1px solid #000;background:#fff;' +
      'display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#000;line-height:1;border-radius:2px;}' +
    '#screen-gukseon .gk-copy-opt{width:50%;display:flex;align-items:center;gap:5px;font-size:11px;color:#000;padding:3px 2px;}' +
    '#screen-gukseon .gk-copy-box{width:15px;height:15px;flex-shrink:0;border:1px solid #000;border-radius:2px;' +
      'display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#000;line-height:1;}' +
    '#screen-gukseon .gk-doc-statement{text-align:center;font-size:14px;margin:30px 0 26px;color:#000;}' +
    '#screen-gukseon .gk-doc-sign{text-align:center;margin-bottom:24px;}' +
    '#screen-gukseon .gk-doc-date{font-size:15px;margin:0 0 14px;color:#000;letter-spacing:1px;}' +
    '#screen-gukseon .gk-doc-attorney{font-size:15px;margin:0 0 6px;color:#000;}' +
    '#screen-gukseon .gk-doc-rrn{font-size:12.5px;color:#000;margin:0;}' +
    '#screen-gukseon .gk-doc-court{text-align:center;font-size:20px;font-weight:700;letter-spacing:6px;margin:26px 0 0;color:#000;}' +
    /* 직인 */
    '#screen-gukseon .gk-seal-wrap{position:relative;display:inline-block;}' +
    '#screen-gukseon .gk-seal{position:absolute;left:50%;top:50%;width:2cm;height:2cm;transform:translate(-50%,-62%);' +
      'z-index:50;pointer-events:none;user-select:none;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    /* ── 입력폼 전용 (사유/실비) ── */
    '.gk-chk{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid var(--border,#e8e8e8);' +
      'background:#fff;border-radius:10px;padding:11px 13px;font:inherit;font-size:13.5px;color:#444;cursor:pointer;-webkit-appearance:none;}' +
    '.gk-chk:active{transform:scale(.995);}' +
    '.gk-chk .gk-chk-box{width:19px;height:19px;flex-shrink:0;border:1.5px solid #ccc;border-radius:5px;' +
      'display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;line-height:1;}' +
    '.gk-chk .gk-chk-txt{flex:1;line-height:1.35;}' +
    '.gk-chk.on{border-color:var(--black,#1a1a1a);color:#1a1a1a;}' +
    '.gk-chk.on .gk-chk-box{background:var(--black,#1a1a1a);border-color:var(--black,#1a1a1a);}' +
    ".gk-chk.on .gk-chk-box:after{content:'✓';}" +
    '.gk-numfield{display:flex;flex-direction:column;gap:6px;}' +
    '.gk-numlabel{font-size:13px;color:#555;line-height:1.35;}' +
    '.gk-numrow{display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:14px;color:#333;}' +
    '.gk-numin{width:54px;border:none;border-bottom:1.5px solid #ccc;background:transparent;outline:none;' +
      'text-align:center;font:inherit;font-size:14px;padding:3px 2px;}' +
    '.gk-numin:focus{border-bottom-color:var(--black,#1a1a1a);}' +
    '.gk-copychips{display:flex;flex-wrap:wrap;gap:6px;}' +
    '.gk-copychip{padding:7px 12px;border:1px solid var(--border,#e8e8e8);border-radius:16px;background:#fff;' +
      'color:#555;font-size:12.5px;cursor:pointer;-webkit-appearance:none;line-height:1.2;}' +
    '.gk-copychip:active{transform:scale(.96);}' +
    '.gk-copychip.on{background:var(--black,#1a1a1a);color:#fff;border-color:var(--black,#1a1a1a);}' +
    '.gk-amtrow{display:flex;align-items:center;gap:8px;margin-top:8px;}' +
    '.gk-amtrow .fs-input{flex:1;}' +
    '.gk-amtrow .gk-won{font-size:13px;color:#555;flex-shrink:0;}' +
    /* 입력폼: 화면 전체를 덮는 팝업 (열람·복사 폼과 동일) */
    '#gukseonForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#gukseonForm.active{display:flex;}' +
    /* 인쇄: 서면만 */
    '@media print{' +
      '.gk-wrap{overflow:visible;padding:0;background:#fff;}' +
      '.gk-page{margin:0;box-shadow:none;width:auto;min-height:auto;padding:13mm;}' +
      '@page{size:A4;margin:0;}' +
    '}';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = GK_CSS;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════
     화면 껍데기 주입 (1회) — 입력폼 / 서면.
     공용 클래스(.screen, .sj-appbar, .fs-*) 재사용.
     ══════════════════════════════════════════════════════════════ */
  var SHELL_ID = 'gukseon-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;

    var attOpts = ATTORNEYS.map(function (a) {
      return '<option value="' + esc(a.name) + '"' + (a.name === '서고은' ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    }).join('');

    // 증액 사유 입력칸들
    var escFields = ESCALATE.map(function (it) {
      if (it.type === 'check') {
        return '<div class="fs-field"><button type="button" class="gk-chk" data-k="' + esc(it.key) +
          '" onclick="gkToggleChk(this)"><span class="gk-chk-box"></span><span class="gk-chk-txt">' + esc(it.text) + '</span></button></div>';
      }
      if (it.type === 'num1') {
        return '<div class="fs-field gk-numfield"><div class="gk-numlabel">' + esc(it.text) + '</div>' +
          '<div class="gk-numrow">( <input class="gk-numin" id="gk-' + it.a + '" inputmode="numeric" oninput="gkNum(this)"> ) ' + esc(it.ua) + '</div></div>';
      }
      return '<div class="fs-field gk-numfield"><div class="gk-numlabel">' + esc(it.text) + '</div>' +
        '<div class="gk-numrow">총 ( <input class="gk-numin" id="gk-' + it.a + '" inputmode="numeric" oninput="gkNum(this)"> ) ' + esc(it.ua) +
        ', 초과 ( <input class="gk-numin" id="gk-' + it.b + '" inputmode="numeric" oninput="gkNum(this)"> ) ' + esc(it.ub) + '</div></div>';
    }).join('');

    var copyChips = COPY_RANGES.map(function (r) {
      return '<button type="button" class="gk-copychip" data-copy="' + esc(r) + '" onclick="gkPickCopy(this)">' + esc(r) + '</button>';
    }).join('');

    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      /* ── 입력폼 (오버레이) ── */
      '<div id="gukseonForm">' +
        '<div class="fs-head">' +
          '<button class="fs-close" onclick="closeGukseonForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
          '<div class="fs-title">국선보수증액 신청서</div>' +
        '</div>' +
        '<div class="fs-body">' +
          '<div class="fs-section">사건 정보</div>' +
          '<div class="fs-field"><label class="fs-label">피고인</label><input type="text" class="fs-input" id="gk-defendant" data-af="l_client" placeholder="홍길동"></div>' +
          '<div class="fs-field"><label class="fs-label">사건번호</label><input type="text" class="fs-input" id="gk-casenum" data-af="l_code" placeholder="2024고단1234"></div>' +
          '<div class="fs-field"><label class="fs-label">사건명</label><input type="text" class="fs-input" id="gk-casename" data-af="l_name" placeholder="사기"></div>' +
          '<div class="fs-field"><label class="fs-label">법원</label><input type="text" class="fs-input" id="gk-court" data-af="court" placeholder="인천지방법원"></div>' +
          '<div class="fs-field"><label class="fs-label">재판부 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="text" class="fs-input" id="gk-courtdiv" placeholder="형사7단독"></div>' +

          '<div class="fs-section">증액 사유 <span class="fs-hint">(해당 항목만 선택·기재)</span></div>' +
          escFields +

          '<div class="fs-section">실비</div>' +
          '<div class="fs-field gk-numfield"><div class="gk-numlabel">피의자(피고인) 접견횟수 (실비)</div>' +
            '<div class="gk-numrow">총 ( <input class="gk-numin" id="gk-exp_visit" inputmode="numeric" oninput="gkNum(this)"> ) 회</div></div>' +
          '<div class="fs-field"><label class="fs-label">기록 복사 (실비)</label><div class="gk-copychips">' + copyChips + '</div></div>' +
          '<div class="fs-field"><button type="button" class="gk-chk" data-k="interp_chk" onclick="gkToggleChk(this)"><span class="gk-chk-box"></span><span class="gk-chk-txt">통역·번역 시행 (실비)</span></button>' +
            '<div class="gk-amtrow"><input type="text" class="fs-input" id="gk-interp_amt" inputmode="numeric" oninput="gkNum(this)" placeholder="금액"><span class="gk-won">원</span></div></div>' +
          '<div class="fs-field"><button type="button" class="gk-chk" data-k="travel_chk" onclick="gkToggleChk(this)"><span class="gk-chk-box"></span><span class="gk-chk-txt">변론활동 위한 여비·숙박비·식비 등 지출 (실비)</span></button>' +
            '<div class="gk-amtrow"><input type="text" class="fs-input" id="gk-travel_amt" inputmode="numeric" oninput="gkNum(this)" placeholder="금액"><span class="gk-won">원</span></div></div>' +
          '<div class="fs-field"><label class="fs-label">기타</label><input type="text" class="fs-input" id="gk-etc" placeholder="직접 입력"></div>' +

          '<div class="fs-section">신청인</div>' +
          '<div class="fs-field"><label class="fs-label">국선변호인</label><select class="fs-input" id="gk-attorney" onchange="gkAttorneyChanged()">' + attOpts + '</select></div>' +
          '<div class="fs-field"><label class="fs-label">주민등록번호</label><input type="text" class="fs-input" id="gk-rrn" placeholder="000000-0000000"></div>' +
          '<div class="fs-field"><label class="fs-label">작성일 (오늘 자동)</label><input type="date" class="fs-input" id="gk-writedate"></div>' +
        '</div>' +
        '<div class="fs-foot">' +
          '<button class="fs-btn ghost" onclick="closeGukseonForm()">취소</button>' +
          '<button class="fs-btn primary" onclick="applyGukseonForm()">완료</button>' +
        '</div>' +
      '</div>' +

      /* ── 서면(출력) 화면 ── */
      '<div id="screen-gukseon" class="screen">' +
        '<div class="sj-appbar no-print">' +
          '<button class="sj-back" onclick="showScreen(\'screen-home\')">‹ 처음으로</button>' +
          '<div class="sj-title">국선보수증액 신청서</div>' +
          '<button class="sj-edit-btn" onclick="editGukseon()">수정</button>' +
          '<button class="sj-print-btn" onclick="window.print()">출력</button>' +
        '</div>' +
        '<div class="gk-wrap"><div class="gk-page"><div id="gk-host"></div></div></div>' +
      '</div>';

    document.body.appendChild(wrap);
  }

  /* ══════════════════════════════════════════════════════════════
     상태 & 진입점
     ══════════════════════════════════════════════════════════════ */
  var state = null;  // 마지막 완료 값 (수정 시 재사용)

  function ensureUI() { injectStyle(); injectShell(); }

  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function getChk(key) {
    var el = document.querySelector('#gukseonForm .gk-chk[data-k="' + key + '"]');
    return !!(el && el.classList.contains('on'));
  }
  function setChk(key, on) {
    var el = document.querySelector('#gukseonForm .gk-chk[data-k="' + key + '"]');
    if (el) el.classList.toggle('on', !!on);
  }
  function getCopy() {
    var el = document.querySelector('#gukseonForm .gk-copychip.on');
    return el ? el.getAttribute('data-copy') : '';
  }
  function setCopy(val) {
    var chips = document.querySelectorAll('#gukseonForm .gk-copychip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('on', chips[i].getAttribute('data-copy') === val);
    }
  }

  // 폼 초기화 (모든 칸 비우고 기본값)
  function resetForm() {
    ['gk-defendant', 'gk-casenum', 'gk-casename', 'gk-courtdiv', 'gk-etc',
     'gk-visit_t', 'gk-visit_o', 'gk-person_t', 'gk-person_o', 'gk-attend_t', 'gk-attend_o',
     'gk-witness_t', 'gk-witness_o', 'gk-outcourt', 'gk-exp_visit', 'gk-interp_amt', 'gk-travel_amt'
    ].forEach(function (id) { setVal(id, ''); });
    setVal('gk-court', COURT_DEFAULT);
    setVal('gk-courtdiv', COURTDIV_DEFAULT);
    setVal('gk-attorney', '서고은');
    setVal('gk-rrn', rrnFor('서고은'));
    setVal('gk-writedate', todayISO());
    // 체크·칩 해제
    var chks = document.querySelectorAll('#gukseonForm .gk-chk');
    for (var i = 0; i < chks.length; i++) chks[i].classList.remove('on');
    setCopy('');
  }

  // 홈 버튼 → 폼 열기
  window.goGukseon = function () {
    ensureUI();
    resetForm();
    document.getElementById('gukseonForm').classList.add('active');
    if (typeof initAutofillFor === 'function') {
      initAutofillFor('gk-casenum', { courtDept: 'gk-courtdiv' });
    }
  };

  window.closeGukseonForm = function () {
    var f = document.getElementById('gukseonForm');
    if (f) f.classList.remove('active');
  };

  /* ── 입력 도우미 (전역 onclick/oninput) ── */
  window.gkToggleChk = function (btn) { if (btn) btn.classList.toggle('on'); };
  window.gkPickCopy = function (btn) {
    var on = btn.classList.contains('on');
    setCopy('');                       // 단일 선택
    if (!on) btn.classList.add('on');  // 다시 누르면 해제
  };
  window.gkNum = function (el) { if (el) el.value = el.value.replace(/[^0-9]/g, ''); };
  window.gkAttorneyChanged = function () {
    var name = getVal('gk-attorney');
    setVal('gk-rrn', rrnFor(name));
  };

  /* ── 완료 → 서면 렌더 → 출력 화면 ── */
  function collect() {
    var v = {
      attorney: getVal('gk-attorney') || '서고은',
      rrn: getVal('gk-rrn'),
      defendant: getVal('gk-defendant'),
      casenum: getVal('gk-casenum'),
      casename: getVal('gk-casename'),
      court: getVal('gk-court'),
      courtDiv: getVal('gk-courtdiv'),
      writeDate: getVal('gk-writedate') || todayISO(),
      copy: getCopy(),
      exp_visit: getVal('gk-exp_visit'),
      interp_chk: getChk('interp_chk'),
      interp_amt: getVal('gk-interp_amt'),
      travel_chk: getChk('travel_chk'),
      travel_amt: getVal('gk-travel_amt'),
      etc: getVal('gk-etc')
    };
    // 증액 사유 (체크 + 숫자)
    ESCALATE.forEach(function (it) {
      if (it.type === 'check') { v[it.key] = getChk(it.key); }
      else if (it.type === 'num1') { v[it.a] = getVal('gk-' + it.a); }
      else { v[it.a] = getVal('gk-' + it.a); v[it.b] = getVal('gk-' + it.b); }
    });
    return v;
  }

  window.applyGukseonForm = function () {
    state = collect();
    document.getElementById('gk-host').innerHTML = renderGukseon(state);
    closeGukseonForm();
    if (typeof showScreen === 'function') showScreen('screen-gukseon');
  };

  /* ── 수정: 현재 값으로 폼 다시 열기 ── */
  window.editGukseon = function () {
    ensureUI();
    if (!state) { window.goGukseon(); return; }
    resetForm();
    setVal('gk-defendant', state.defendant);
    setVal('gk-casenum', state.casenum);
    setVal('gk-casename', state.casename);
    setVal('gk-court', state.court);
    setVal('gk-courtdiv', state.courtDiv);
    setVal('gk-attorney', state.attorney || '서고은');
    setVal('gk-rrn', state.rrn);
    setVal('gk-writedate', state.writeDate || todayISO());
    setVal('gk-etc', state.etc);
    setVal('gk-exp_visit', state.exp_visit);
    setVal('gk-interp_amt', state.interp_amt);
    setVal('gk-travel_amt', state.travel_amt);
    setChk('interp_chk', state.interp_chk);
    setChk('travel_chk', state.travel_chk);
    setCopy(state.copy || '');
    ESCALATE.forEach(function (it) {
      if (it.type === 'check') { setChk(it.key, state[it.key]); }
      else if (it.type === 'num1') { setVal('gk-' + it.a, state[it.a]); }
      else { setVal('gk-' + it.a, state[it.a]); setVal('gk-' + it.b, state[it.b]); }
    });
    document.getElementById('gukseonForm').classList.add('active');
    if (typeof initAutofillFor === 'function') {
      initAutofillFor('gk-casenum', { courtDept: 'gk-courtdiv' });
    }
  };

  /* node 검증용(브라우저에서는 무시됨) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderGukseon: renderGukseon, ESCALATE: ESCALATE, COPY_RANGES: COPY_RANGES, GK_CSS: GK_CSS };
  }

})();
