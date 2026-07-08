/* 법무법인 정서 PWA - 판결등본교부청구 (pankyul.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. HWPX 원본(판결등본교부청구-양식.hwpx)을 표 좌표까지 정밀 재현.
   표: 5열(각 33.4mm) × 11행, 전체 167.0 × 240.3mm, 셀 테두리 SOLID 0.15mm 균일.
   행높이(mm): 제목25.5 / 재판부·사건번호·사건명·피고인 각10.5 / 본문105.1 /
               청구인(2행) 각10.5 / 청구사유소명16.2 / 귀중15.5 / 영수13.5
   글자: 제목20pt bold, 본문 12pt, 청구사유 주석 9pt, 귀중 15pt.

   진입점(홈 버튼): onclick="goPankyul()"
   흐름: goPankyul() → 입력폼 → 완료 → 서면 → window.print()

   자동채우기(data-af + court-lookup):
     피고인 l_client · 사건번호 l_code · 사건명 l_name · 법원 court
     재판부 courtDept(조회) · 선고일 judgment_date(조회)

   의존: showScreen(id), SEAL_SEOGOEUN(전역 도장), initAutofillFor(), JU(util.js)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── 상수 ─────────────────────────────────────────── */
  var ATTORNEYS_SEED = ['서고은', '양선화', '이예나'];
  var ATTORNEYS_KEY = 'jeongseo_attorneys';   // 서면 공통 변호사 명단(localStorage)
  var COURT_DEFAULT = '인천지방법원';
  var COURTDIV_DEFAULT = '형사7단독';
  var LAWYERTYPE_DEFAULT = '사선';   // 기본 사선 — '국선' 선택 시에만 "국선변호인" 문구 삽입

  /* ── 도우미 (공용 util.js 위임) ── */
  function esc(v) { return JU.esc(v); }
  function todayISO() { return JU.todayISO(); }
  // 'YYYY-MM-DD' → 'YYYY. M. D.'
  function fmtDot(iso) {
    var m = ('' + (iso || '')).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return '';
    return m[1] + '. ' + parseInt(m[2], 10) + '. ' + parseInt(m[3], 10) + '.';
  }
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
     서면 렌더 (순수 함수) — HWPX 원본 표를 그대로 재현.
     선고일 없으면 밑줄 공란, 도장은 (인) 클릭 토글(state.stamped).
     ══════════════════════════════════════════════════════════════ */
  function ul(val) {
    // 밑줄(점선) 자리 — 값 있으면 값, 없으면 공백 폭 확보
    return '<span class="pk-ul">' + (val ? esc(val) : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;') + '</span>';
  }
  function sealMarkup(v) {
    var seal = sealFor(v.attorney);
    return '(인)' + (v.stamped && seal ? '<img class="pk-seal" src="' + seal + '" alt="">' : '');
  }

  function renderPankyul(v) {
    v = v || {};
    var sent = fmtDot(v.sentDate);
    var wdate = fmtDot(v.writeDate || todayISO());
    var attorney = v.attorney || '서고은';

    return '' +
    '<table class="pk-tbl"><colgroup>' +
      '<col style="width:33.4mm"><col style="width:33.4mm"><col style="width:33.4mm">' +
      '<col style="width:33.4mm"><col style="width:33.4mm">' +
    '</colgroup>' +

      /* r0 제목 */
      '<tr><td colspan="5" class="pk-title" style="height:25.5mm">판결등본교부청구</td></tr>' +

      /* r1 재판부 + 인지첩부(rowspan4) */
      '<tr>' +
        '<td class="pk-lbl" style="height:10.5mm">재 판 부</td>' +
        '<td colspan="3" class="pk-val">' + esc(v.courtDiv || '') + '</td>' +
        '<td rowspan="4" class="pk-inji">인지 1,000원<div class="pk-inji-b">첨 부</div></td>' +
      '</tr>' +
      /* r2 사건번호 */
      '<tr>' +
        '<td class="pk-lbl" style="height:10.5mm">사건번호</td>' +
        '<td colspan="3" class="pk-val">' + esc(v.casenum || '') + '</td>' +
      '</tr>' +
      /* r3 사건명 */
      '<tr>' +
        '<td class="pk-lbl" style="height:10.5mm">사 건 명</td>' +
        '<td colspan="3" class="pk-val">' + esc(v.casename || '') + '</td>' +
      '</tr>' +
      /* r4 피고인 */
      '<tr>' +
        '<td class="pk-lbl" style="height:10.5mm">피 고 인</td>' +
        '<td colspan="3" class="pk-val">' + esc(v.defendant || '') + '</td>' +
      '</tr>' +

      /* r5 본문 (선고일·작성일 밑줄) */
      '<tr><td colspan="5" class="pk-body" style="height:105.1mm">' +
        '<div class="pk-body-p">위 사람에 대한 ' + esc(v.casename || '') + ' 사건에 관하여 귀원이 ' + ul(sent) +
          ' 선고한 판결문등본 1통을 교부하여 주시기 바랍니다.</div>' +
        '<div class="pk-body-date">' + ul(wdate) + '</div>' +
      '</td></tr>' +

      /* r6 청구인 / 위 피고인 / 이름 */
      '<tr>' +
        '<td rowspan="2" class="pk-lbl" style="height:10.5mm">청 구 인</td>' +
        '<td colspan="2" class="pk-val">위 피고인</td>' +
        '<td colspan="2" class="pk-val">' + esc(v.defendant || '') + '</td>' +
      '</tr>' +
      /* r7 위 피고인의 변호인 / 국선변호인 변호사 */
      '<tr>' +
        '<td colspan="2" class="pk-val" style="height:10.5mm">위 피고인의 변호인</td>' +
        '<td colspan="2" class="pk-val">' + (v.lawyerType === '국선' ? '국선변호인<br>' : '') +
          '변호사 ' + esc(attorney) + '</td>' +
      '</tr>' +

      /* r8 청구 사유소명 / 사유 */
      '<tr>' +
        '<td colspan="2" class="pk-sayu" style="height:16.2mm">청구 사유소명' +
          '<div class="pk-note">※고소인 등인 경우에는 청구하는 사유를 소명하시기 바랍니다.</div></td>' +
        '<td colspan="3" class="pk-val">선고결과를 확인하기 위하여</td>' +
      '</tr>' +

      /* r9 법원 귀중 */
      '<tr><td colspan="5" class="pk-gui" style="height:15.5mm">' + esc(v.court || '') + ' 귀중</td></tr>' +

      /* r10 영수함 + 도장 */
      '<tr><td colspan="5" class="pk-yeongsu" style="height:13.5mm">' +
        '위 서류 1 통을 영수함 &nbsp;&nbsp;&nbsp; 변호사 &nbsp; ' + esc(attorney) +
        ' &nbsp; <span class="pk-seal-wrap" id="pk-seal-wrap" onclick="pkToggleSeal()" title="클릭하면 도장 날인/제거">' + sealMarkup(v) + '</span>' +
      '</td></tr>' +
    '</table>';
  }

  /* ══════════════════════════════════════════════════════════════
     전용 CSS 주입 (1회)
     ══════════════════════════════════════════════════════════════ */
  var STYLE_ID = 'pankyul-style';
  var PK_CSS =
    '.pk-wrap{overflow:auto;padding:16px;background:#e9e9ec;min-height:100%;}' +
    ".pk-page{width:210mm;min-height:297mm;background:#fff;margin:0 auto;padding:20mm 21.5mm;" +
      "box-shadow:0 2px 14px rgba(0,0,0,.18);color:#000;box-sizing:border-box;" +
      "font-family:'함초롬바탕','HCR Batang','바탕',Batang,serif;}" +
    '.pk-tbl{width:167mm;border-collapse:collapse;table-layout:fixed;margin:0 auto;}' +
    '.pk-tbl td{border:0.15mm solid #000;padding:0 2mm;vertical-align:middle;' +
      'font-size:12pt;line-height:1.3;word-break:keep-all;text-align:center;}' +
    /* 제목: 원본처럼 셀 너비를 넓게 채우도록 자간 확대(폰트 무관), 가운데 정렬 유지
       (text-indent 로 끝 자간분 보정해 좌우 대칭) */
    ".pk-title{font-size:20pt;font-weight:700;letter-spacing:1.1em;text-indent:1.1em;" +
      "font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;}" +
    /* 라벨/값 */
    '.pk-lbl{letter-spacing:0.05em;}' +
    '.pk-val{text-align:left;}' +
    /* 인지 첩부 (오른쪽 세로 셀) */
    '.pk-inji{font-size:12pt;line-height:1.5;}' +
    '.pk-inji-b{margin-top:2mm;letter-spacing:0.3em;}' +
    /* 본문 */
    '.pk-body{text-align:left;vertical-align:top;padding:6mm 4mm !important;}' +
    '.pk-body-p{font-size:12pt;line-height:2.1;text-indent:0.5em;}' +
    '.pk-body-date{text-align:center;margin-top:12mm;font-size:12pt;}' +
    /* 밑줄(점선) 자리 */
    '.pk-ul{border-bottom:1px dashed #555;padding:0 4px;white-space:nowrap;}' +
    /* 청구 사유소명 */
    '.pk-sayu{text-align:left;line-height:1.4;}' +
    '.pk-note{font-size:9pt;line-height:1.3;margin-top:1mm;}' +
    /* 귀중 */
    '.pk-gui{font-size:15pt;font-weight:700;letter-spacing:0.4em;text-indent:0.4em;}' +
    /* 영수 */
    '.pk-yeongsu{font-size:12pt;}' +
    /* 도장 */
    '.pk-seal-wrap{position:relative;display:inline-block;cursor:pointer;}' +
    '.pk-seal{position:absolute;left:50%;top:50%;width:1.8cm;height:1.8cm;transform:translate(-50%,-58%);' +
      'z-index:50;pointer-events:none;user-select:none;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    /* 입력폼 오버레이 */
    '#pankyulForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#pankyulForm.active{display:flex;}' +
    /* 인쇄 */
    '@media print{' +
      '.pk-wrap{overflow:visible;padding:0;background:#fff;}' +
      '.pk-page{margin:0;box-shadow:none;}' +
      '@page{size:A4;margin:0;}' +
    '}';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = PK_CSS;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════
     화면 껍데기 주입 (1회) — 입력폼 / 서면
     ══════════════════════════════════════════════════════════════ */
  var SHELL_ID = 'pankyul-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;

    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="pankyulForm">' +
        '<div class="fs-card">' +
        '<div class="fs-head">' +
          '<button class="fs-close" onclick="closePankyulForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
          '<div class="fs-title">판결등본교부청구</div>' +
        '</div>' +
        '<div class="fs-body">' +
          '<div class="fs-section">사건 정보</div>' +
          '<div class="fs-field"><label class="fs-label">피고인</label><input type="text" class="fs-input" id="pk-defendant" data-af="l_client" placeholder="홍길동"></div>' +
          '<div class="fs-field"><label class="fs-label">사건번호</label><input type="text" class="fs-input" id="pk-casenum" data-af="l_code" placeholder="2026고단1234"></div>' +
          '<div class="fs-field"><label class="fs-label">사건명</label><input type="text" class="fs-input" id="pk-casename" data-af="l_name" placeholder="사기"></div>' +
          '<div class="fs-field"><label class="fs-label">법원</label><input type="text" class="fs-input" id="pk-court" data-af="court" placeholder="인천지방법원"></div>' +
          '<div class="fs-field"><label class="fs-label">재판부 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="text" class="fs-input" id="pk-courtdiv" placeholder="형사7단독"></div>' +
          '<div class="fs-field"><label class="fs-label">선고일 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="date" class="fs-input" id="pk-sentdate"></div>' +

          '<div class="fs-section">청구인</div>' +
          '<div class="fs-field"><label class="fs-label">변호인 구분 <span class="fs-hint">(국선 선택 시에만 "국선변호인" 표기)</span></label>' +
            '<select class="fs-input" id="pk-lawyertype"><option value="사선" selected>사선</option><option value="국선">국선</option></select></div>' +
          '<div class="fs-field"><label class="fs-label">변호사</label>' +
            '<select class="fs-input" id="pk-attorney"></select>' +
            '<div class="att-add-row"><input type="text" class="att-add-input" id="pk-attorney-new" placeholder="추가할 변호사 이름"><button type="button" class="att-add-btn" onclick="pkAddAttorney()">＋ 추가</button></div></div>' +
          '<div class="fs-field"><label class="fs-label">작성일 (오늘 자동)</label><input type="date" class="fs-input" id="pk-writedate"></div>' +
        '</div>' +
        '<div class="fs-foot">' +
          '<button class="fs-btn ghost" onclick="closePankyulForm()">취소</button>' +
          '<button class="fs-btn primary" onclick="applyPankyulForm()">완료</button>' +
        '</div>' +
        '</div>' +
      '</div>' +

      '<div id="screen-pankyul" class="screen">' +
        '<div class="sj-appbar no-print">' +
          '<button class="sj-back" onclick="showScreen(\'screen-home\')">‹ 처음으로</button>' +
          '<div class="sj-title">판결등본교부청구</div>' +
          '<button class="sj-edit-btn" onclick="editPankyul()">수정</button>' +
          '<button class="sj-print-btn" onclick="window.print()">출력</button>' +
        '</div>' +
        '<div class="pk-wrap"><div class="pk-page"><div id="pk-host"></div></div></div>' +
      '</div>';

    document.body.appendChild(wrap);
  }

  /* 변호사 select 채우기 */
  function fillAttorneySelect(selected) {
    var sel = document.getElementById('pk-attorney');
    if (!sel) return;
    var list = loadAttorneys();
    if (selected && list.indexOf(selected) < 0) list = list.concat(selected);
    sel.innerHTML = list.map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }

  /* ══════════════════════════════════════════════════════════════
     상태 & 진입점
     ══════════════════════════════════════════════════════════════ */
  var state = null;
  function ensureUI() { injectStyle(); injectShell(); }
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function defaultState() {
    return {
      defendant: '', casenum: '', casename: '',
      court: COURT_DEFAULT, courtDiv: COURTDIV_DEFAULT, sentDate: '',
      lawyerType: LAWYERTYPE_DEFAULT, attorney: '서고은',
      writeDate: todayISO(), stamped: false
    };
  }

  function fillFormFromState() {
    fillAttorneySelect(state.attorney || '서고은');
    setVal('pk-defendant', state.defendant);
    setVal('pk-casenum', state.casenum);
    setVal('pk-casename', state.casename);
    setVal('pk-court', state.court || COURT_DEFAULT);
    setVal('pk-courtdiv', state.courtDiv || COURTDIV_DEFAULT);
    setVal('pk-sentdate', state.sentDate);
    setVal('pk-lawyertype', state.lawyerType || LAWYERTYPE_DEFAULT);
    setVal('pk-writedate', state.writeDate || todayISO());
    setVal('pk-attorney-new', '');
  }

  function openForm() {
    ensureUI();
    fillFormFromState();
    document.getElementById('pankyulForm').classList.add('active');
    if (typeof initAutofillFor === 'function') {
      initAutofillFor('pk-casenum', { courtDept: 'pk-courtdiv', sentDate: 'pk-sentdate' });
    }
  }

  window.goPankyul = function () {
    ensureUI();
    state = defaultState();
    openForm();
  };
  window.closePankyulForm = function () {
    var f = document.getElementById('pankyulForm');
    if (f) f.classList.remove('active');
  };

  window.pkAddAttorney = function () {
    var inp = document.getElementById('pk-attorney-new');
    var name = inp ? inp.value.trim() : '';
    if (!name) return;
    saveAttorney(name);
    fillAttorneySelect(name);
    if (inp) inp.value = '';
  };

  window.pkToggleSeal = function () {
    if (!state) return;
    state.stamped = !state.stamped;
    var w = document.getElementById('pk-seal-wrap');
    if (w) w.innerHTML = sealMarkup(state);
  };

  window.applyPankyulForm = function () {
    if (!state) state = defaultState();
    state.attorney = getVal('pk-attorney') || '서고은';
    state.defendant = getVal('pk-defendant');
    state.casenum = getVal('pk-casenum');
    state.casename = getVal('pk-casename');
    state.court = getVal('pk-court');
    state.courtDiv = getVal('pk-courtdiv');
    state.sentDate = getVal('pk-sentdate');
    state.lawyerType = getVal('pk-lawyertype') || LAWYERTYPE_DEFAULT;
    state.writeDate = getVal('pk-writedate') || todayISO();
    if (!sealFor(state.attorney)) state.stamped = false;  // 직인 없는 변호사는 실물 날인
    document.getElementById('pk-host').innerHTML = renderPankyul(state);
    closePankyulForm();
    if (typeof showScreen === 'function') showScreen('screen-pankyul');
  };

  window.editPankyul = function () {
    ensureUI();
    if (!state) { window.goPankyul(); return; }
    openForm();
  };

  /* node 검증용 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderPankyul: renderPankyul, PK_CSS: PK_CSS };
  }

})();
