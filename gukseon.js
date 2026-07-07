/* 법무법인 정서 PWA - 국선변호보수증액등신청서 (gukseon.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. index.html 에는 진입점 버튼 + <script src="gukseon.js"> 만 둔다.
   화면(입력폼·서면)·전용 CSS 는 이 파일이 <body>에 1회 주입한다.
   원본 서식: Public-Defender/gukseon-case-manager.jsx 의 FeeForm 재현.

   입력폼: 사건정보(피고인·사건번호·사건명·법원·재판부) + 신청인(국선변호인·주민번호·작성일).
   증액 사유·실비·기타 는 입력폼이 아니라 "서면 위에서" 직접 체크·수량 기입한다(WYSIWYG).

   진입점(홈 버튼): onclick="goGukseon()"
   흐름: goGukseon() → 입력폼 → 완료 → 서면(직접 체크·인쇄)

   의존:
     · showScreen(id)      : index.html 공용 화면 전환
     · SEAL_SEOGOEUN       : 전역 도장 base64 (index.html) — 서고은 (인) 클릭 시 날인
     · initAutofillFor()   : autofill.js 범용 자동완성 (data-af 표준)
     · JU (util.js)        : esc / todayISO
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── 상수 ─────────────────────────────────────────── */
  var ATTORNEYS_SEED = ['서고은', '양선화', '이예나'];
  var ATTORNEYS_KEY = 'jeongseo_attorneys';   // 추가 변호사 기억(localStorage) — 서면 공통
  var RRN_MAP = { '서고은': '840219-2079920' };        // 아는 주민번호만
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
  function rrnFor(name) { return RRN_MAP[name] || ''; }
  function sealFor(name) {
    return (name === '서고은' && typeof SEAL_SEOGOEUN !== 'undefined') ? SEAL_SEOGOEUN : '';
  }
  function loadAttorneys() {
    try {
      var raw = localStorage.getItem(ATTORNEYS_KEY);
      var arr = raw ? JSON.parse(raw) : null;
      if (arr && arr.length) return arr;
    } catch (e) {}
    return ATTORNEYS_SEED.slice();
  }
  function saveAttorney(name) {
    name = (name || '').trim();
    if (!name) return;
    var list = loadAttorneys();
    if (list.indexOf(name) < 0) {
      list.push(name);
      try { localStorage.setItem(ATTORNEYS_KEY, JSON.stringify(list)); } catch (e) {}
    }
  }

  /* ══════════════════════════════════════════════════════════════
     상태 — 서면의 체크·수량·도장까지 모두 담는다(수정/재렌더 시 유지).
     ══════════════════════════════════════════════════════════════ */
  var state = null;
  function defaultState() {
    var s = {
      attorney: '서고은', rrn: rrnFor('서고은'),
      defendant: '', casenum: '', casename: '',
      court: COURT_DEFAULT, courtDiv: COURTDIV_DEFAULT,
      writeDate: todayISO(),
      copy: '', exp_visit: '',
      interp_chk: false, interp_amt: '',
      travel_chk: false, travel_amt: '',
      etc: '', stamped: false
    };
    ESCALATE.forEach(function (it) {
      if (it.type === 'check') s[it.key] = false;
      else if (it.type === 'num1') s[it.a] = '';
      else { s[it.a] = ''; s[it.b] = ''; }
    });
    return s;
  }

  /* ══════════════════════════════════════════════════════════════
     서면 렌더 — 값 객체 v 로 인쇄용 서면 HTML(직접 체크 가능) 반환.
     체크·괄호수량·복사범위·기타·도장은 서면 위에서 직접 조작 → state 갱신.
     ══════════════════════════════════════════════════════════════ */
  function docChk(on, key) {
    return '<button type="button" class="gk-docchk' + (on ? ' on' : '') +
      '" data-k="' + esc(key) + '" onclick="gkDocChk(this)">' + (on ? '√' : '') + '</button>';
  }
  function paren(key, v, wide) {
    return '<input class="gk-paren' + (wide ? ' gk-paren-w' : '') + '" data-k="' + esc(key) +
      '" value="' + esc(v || '') + '" inputmode="numeric" oninput="gkParen(this)">';
  }
  function renderEscRows(v) {
    return ESCALATE.map(function (it) {
      var val;
      if (it.type === 'check') {
        val = docChk(v[it.key], it.key);
      } else if (it.type === 'num1') {
        val = '<span class="gk-pw">( ' + paren(it.a, v[it.a]) + ' )' + esc(it.ua) + '</span>';
      } else {
        val = '<span class="gk-pw">총 ( ' + paren(it.a, v[it.a]) + ' )' + esc(it.ua) +
          ', 초과 ( ' + paren(it.b, v[it.b]) + ' )' + esc(it.ub) + '</span>';
      }
      return '<div class="gk-doc-rrow">' +
        '<div class="gk-doc-desc gk-flex">' + esc(it.text) + '</div>' +
        '<div class="gk-doc-val">' + val + '</div></div>';
    }).join('');
  }
  function renderCopyOpts(sel) {
    return COPY_RANGES.map(function (r) {
      var on = (sel === r);
      return '<button type="button" class="gk-copy-opt' + (on ? ' on' : '') +
        '" data-copy="' + esc(r) + '" onclick="gkDocCopy(this)">' +
        '<span class="gk-copy-box">' + (on ? '√' : '') + '</span>' + esc(r) + '</button>';
    }).join('');
  }
  function sealMarkup(v) {
    var seal = sealFor(v.attorney);
    return '(인)' + (v.stamped && seal ? '<img class="gk-seal" src="' + seal + '" alt="">' : '');
  }

  function renderGukseon(v) {
    v = v || {};
    var dp = ('' + (v.writeDate || todayISO())).split('-');
    var y = dp[0] || '', m = parseInt(dp[1], 10) || '', d = parseInt(dp[2], 10) || '';
    var caseLine = [v.casenum, v.casename].filter(Boolean).join('  ');

    var silbi = '' +
      '<div class="gk-doc-rrow"><div class="gk-doc-desc gk-flex">피의자(피고인) 접견횟수 (실비)</div>' +
        '<div class="gk-doc-val"><span class="gk-pw">총 ( ' + paren('exp_visit', v.exp_visit) + ' )회</span></div></div>' +
      '<div class="gk-doc-rrow"><div class="gk-doc-desc-narrow">기록 복사 (실비)</div>' +
        '<div class="gk-doc-copy gk-flex">' + renderCopyOpts(v.copy) + '</div></div>' +
      '<div class="gk-doc-rrow"><div class="gk-doc-desc gk-flex">통역, 번역 시행 (실비)</div>' +
        '<div class="gk-doc-val">' + docChk(v.interp_chk, 'interp_chk') +
        '<span class="gk-pw">, ( ' + paren('interp_amt', v.interp_amt, true) + ' )원</span></div></div>' +
      '<div class="gk-doc-rrow"><div class="gk-doc-desc gk-flex">변론활동 위한 여비, 숙박비, 식비 기타 비용 지출 (실비)</div>' +
        '<div class="gk-doc-val">' + docChk(v.travel_chk, 'travel_chk') +
        '<span class="gk-pw">, ( ' + paren('travel_amt', v.travel_amt, true) + ' )원</span></div></div>';

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
        '<input class="gk-doc-input gk-flex" data-k="etc" value="' + esc(v.etc || '') + '" oninput="gkDocText(this)"></div></div>' +
    '</div>' +

    '<p class="gk-doc-statement">위 사건에 관하여 국선변호 보수의 증액 또는 실비의 변상을 신청합니다.</p>' +

    '<div class="gk-doc-sign">' +
      '<p class="gk-doc-date">' + esc(y) + '. ' + esc(m) + '. ' + esc(d) + '.</p>' +
      '<p class="gk-doc-attorney">국선변호인 변호사 ' + esc(v.attorney || '서고은') +
        ' <span class="gk-seal-wrap" id="gk-seal-wrap" onclick="gkToggleSeal()" title="클릭하면 도장 날인/제거">' + sealMarkup(v) + '</span></p>' +
      '<p class="gk-doc-rrn">( 주민등록번호 : ' + esc(v.rrn || '') + ' )</p>' +
    '</div>' +

    '<p class="gk-doc-court">' + esc(v.court || '') + ' ' + esc(v.courtDiv || '') + ' 귀중</p>';
  }

  /* ══════════════════════════════════════════════════════════════
     전용 CSS 주입 (1회) — 원본 gk-doc-* 스타일 이식 + A4 인쇄.
     ══════════════════════════════════════════════════════════════ */
  var STYLE_ID = 'gukseon-style';
  var GK_CSS =
    /* 서면 페이지 — 하단 여백 최소화(min-height 미고정, 내용만큼) */
    '.gk-wrap{overflow:auto;padding:16px;background:#e9e9ec;min-height:100%;}' +
    ".gk-page{width:210mm;background:#fff;margin:0 auto;padding:16mm 20mm 14mm;" +
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
    /* 직접 체크 (버튼) */
    '#screen-gukseon .gk-docchk{width:18px;height:18px;border:1px solid #000;background:#fff;padding:0;' +
      'display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#000;line-height:1;border-radius:2px;cursor:pointer;font-family:inherit;}' +
    '#screen-gukseon .gk-copy-opt{width:50%;display:flex;align-items:center;gap:5px;border:none;background:transparent;cursor:pointer;' +
      'font:inherit;font-size:11px;color:#000;text-align:left;padding:3px 2px;}' +
    '#screen-gukseon .gk-copy-box{width:15px;height:15px;flex-shrink:0;border:1px solid #000;border-radius:2px;' +
      'display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#000;line-height:1;}' +
    /* 괄호 안 수량 입력 */
    '#screen-gukseon .gk-paren{width:30px;border:none;border-bottom:1px solid #999;background:transparent;outline:none;' +
      'text-align:center;font:inherit;font-size:12px;color:#000;margin:0 2px;padding:0 1px;}' +
    '#screen-gukseon .gk-paren-w{width:62px;}' +
    '#screen-gukseon .gk-paren:focus{border-bottom-color:#000;}' +
    '#screen-gukseon .gk-doc-input{width:100%;border:none;background:transparent;outline:none;font:inherit;font-size:13.5px;color:#000;padding:2px 0;}' +
    /* 서명부 */
    '#screen-gukseon .gk-doc-statement{text-align:center;font-size:14px;margin:22px 0 18px;color:#000;}' +
    '#screen-gukseon .gk-doc-sign{text-align:center;margin-bottom:14px;}' +
    '#screen-gukseon .gk-doc-date{font-size:15px;margin:0 0 12px;color:#000;letter-spacing:1px;}' +
    '#screen-gukseon .gk-doc-attorney{font-size:15px;margin:0 0 6px;color:#000;}' +
    '#screen-gukseon .gk-doc-rrn{font-size:12.5px;color:#000;margin:0;}' +
    '#screen-gukseon .gk-doc-court{text-align:center;font-size:20px;font-weight:700;letter-spacing:6px;margin:16px 0 0;color:#000;}' +
    /* 직인 — (인) 클릭 토글 */
    '#screen-gukseon .gk-seal-wrap{position:relative;display:inline-block;cursor:pointer;}' +
    '#screen-gukseon .gk-seal{position:absolute;left:50%;top:50%;width:1.8cm;height:1.8cm;transform:translate(-50%,-62%);' +
      'z-index:50;pointer-events:none;user-select:none;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    /* 입력폼: 화면 전체를 덮는 팝업 (열람·복사 폼과 동일) */
    '#gukseonForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#gukseonForm.active{display:flex;}' +
    /* 인쇄: 서면만 */
    '@media print{' +
      '.gk-wrap{overflow:visible;padding:0;background:#fff;}' +
      '.gk-page{margin:0;box-shadow:none;width:auto;padding:13mm;}' +
      '#screen-gukseon .gk-paren{border-bottom:1px solid #000 !important;}' +
      '#screen-gukseon .gk-doc-input{border-bottom:none !important;}' +
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
     화면 껍데기 주입 (1회) — 입력폼(사건정보+신청인) / 서면.
     ══════════════════════════════════════════════════════════════ */
  var SHELL_ID = 'gukseon-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;

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

          '<div class="fs-section">신청인</div>' +
          '<div class="fs-field"><label class="fs-label">국선변호인</label>' +
            '<select class="fs-input" id="gk-attorney" onchange="gkAttorneyChanged()"></select>' +
            '<div class="att-add-row"><input type="text" class="att-add-input" id="gk-attorney-new" placeholder="추가할 변호사 이름"><button type="button" class="att-add-btn" onclick="gkAddAttorney()">＋ 추가</button></div></div>' +
          '<div class="fs-field"><label class="fs-label">주민등록번호</label><input type="text" class="fs-input" id="gk-rrn" placeholder="000000-0000000"></div>' +
          '<div class="fs-field"><label class="fs-label">작성일 (오늘 자동)</label><input type="date" class="fs-input" id="gk-writedate"></div>' +
          '<div class="fs-field"><div class="fs-hint">증액 사유·실비·기타는 다음 화면(서면)에서 직접 체크·기재합니다.</div></div>' +
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

  /* 변호사 select 채우기 */
  function fillAttorneySelect(selected) {
    var sel = document.getElementById('gk-attorney');
    if (!sel) return;
    var list = loadAttorneys();
    if (selected && list.indexOf(selected) < 0) list = list.concat(selected);
    sel.innerHTML = list.map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }

  /* ══════════════════════════════════════════════════════════════
     진입점 & 핸들러
     ══════════════════════════════════════════════════════════════ */
  function ensureUI() { injectStyle(); injectShell(); }
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  // 입력폼을 state(사건정보·신청인)로 채운다
  function fillFormFromState() {
    fillAttorneySelect(state.attorney || '서고은');
    setVal('gk-defendant', state.defendant);
    setVal('gk-casenum', state.casenum);
    setVal('gk-casename', state.casename);
    setVal('gk-court', state.court || COURT_DEFAULT);
    setVal('gk-courtdiv', state.courtDiv || COURTDIV_DEFAULT);
    setVal('gk-rrn', state.rrn);
    setVal('gk-writedate', state.writeDate || todayISO());
    setVal('gk-attorney-new', '');
  }

  function openForm() {
    ensureUI();
    fillFormFromState();
    document.getElementById('gukseonForm').classList.add('active');
    if (typeof initAutofillFor === 'function') {
      initAutofillFor('gk-casenum', { courtDept: 'gk-courtdiv' });
    }
  }

  // 홈 버튼 → 새 신청서
  window.goGukseon = function () {
    ensureUI();
    state = defaultState();
    openForm();
  };
  window.closeGukseonForm = function () {
    var f = document.getElementById('gukseonForm');
    if (f) f.classList.remove('active');
  };

  /* ── 신청인: 변호사 선택/추가 ── */
  window.gkAttorneyChanged = function () {
    var name = getVal('gk-attorney');
    setVal('gk-rrn', rrnFor(name));   // 아는 변호사면 주민번호 자동, 아니면 비움
  };
  window.gkAddAttorney = function () {
    var inp = document.getElementById('gk-attorney-new');
    var name = inp ? inp.value.trim() : '';
    if (!name) return;
    saveAttorney(name);
    fillAttorneySelect(name);
    setVal('gk-rrn', rrnFor(name));
    if (inp) inp.value = '';
  };

  /* ── 서면 위 직접 조작 (체크·수량·복사·기타·도장) → state 갱신 ── */
  window.gkDocChk = function (btn) {
    var k = btn.getAttribute('data-k');
    var on = !btn.classList.contains('on');
    btn.classList.toggle('on', on);
    btn.textContent = on ? '√' : '';
    if (state) state[k] = on;
  };
  window.gkParen = function (el) {
    el.value = el.value.replace(/[^0-9]/g, '');
    if (state) state[el.getAttribute('data-k')] = el.value;
  };
  window.gkDocCopy = function (btn) {
    var val = btn.getAttribute('data-copy');
    var already = btn.classList.contains('on');
    var opts = btn.parentNode.querySelectorAll('.gk-copy-opt');
    for (var i = 0; i < opts.length; i++) {
      opts[i].classList.remove('on');
      var box = opts[i].querySelector('.gk-copy-box'); if (box) box.textContent = '';
    }
    if (!already) {
      btn.classList.add('on');
      var b = btn.querySelector('.gk-copy-box'); if (b) b.textContent = '√';
    }
    if (state) state.copy = already ? '' : val;
  };
  window.gkDocText = function (el) {
    if (state) state[el.getAttribute('data-k')] = el.value;
  };
  window.gkToggleSeal = function () {
    if (!state) return;
    state.stamped = !state.stamped;
    var wrap = document.getElementById('gk-seal-wrap');
    if (wrap) wrap.innerHTML = sealMarkup(state);
  };

  /* ── 완료 → 서면 렌더 → 출력 화면 (사건정보·신청인만 갱신, 서면 체크는 유지) ── */
  window.applyGukseonForm = function () {
    if (!state) state = defaultState();
    var name = getVal('gk-attorney') || '서고은';
    state.attorney = name;
    state.rrn = getVal('gk-rrn');
    state.defendant = getVal('gk-defendant');
    state.casenum = getVal('gk-casenum');
    state.casename = getVal('gk-casename');
    state.court = getVal('gk-court');
    state.courtDiv = getVal('gk-courtdiv');
    state.writeDate = getVal('gk-writedate') || todayISO();
    if (!sealFor(state.attorney)) state.stamped = false;  // 직인 없는 변호사는 실물 날인
    document.getElementById('gk-host').innerHTML = renderGukseon(state);
    closeGukseonForm();
    if (typeof showScreen === 'function') showScreen('screen-gukseon');
  };

  /* ── 수정: 사건정보·신청인 폼 다시 열기 (서면 체크는 state에 보존) ── */
  window.editGukseon = function () {
    ensureUI();
    if (!state) { window.goGukseon(); return; }
    openForm();
  };

  /* node 검증용(브라우저에서는 무시됨) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderGukseon: renderGukseon, ESCALATE: ESCALATE, COPY_RANGES: COPY_RANGES, GK_CSS: GK_CSS };
  }

})();
