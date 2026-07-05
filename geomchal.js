/* 법무법인 정서 PWA - 검찰 열람·등사 신청서 (geomchal.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. yeollam.js(법원)의 짝. 검찰사건사무규칙 별지 제170호의2서식.
   yeollam.js 의 법원/검찰 갈림길에서 검찰 선택 시 openGeomchalForm() 호출.
   화면(입력폼·서면)·전용 CSS 는 이 파일이 <body>에 1회 주입한다.

   진입점: openGeomchalForm()  ← yeollam.js 갈림길에서 호출
   흐름: openGeomchalForm() → 입력폼 → 완료 → 서면 → window.print()

   양식은 6페이지(신청서·별지표목·수수료납부서·서약서2·위임장).
   ※ 현재 1페이지(신청서)만 구현. 2~6페이지는 아래 [P2~P6 자리]에 이어붙인다.

   의존:
     · showScreen(id)      : index.html 공용 화면 전환
     · SEAL_SEOGOEUN       : 전역 도장 base64 (index.html) — 서고은 선택 시 날인
     · initAutofillFor()   : autofill.js 범용 자동완성 (data-af 표준)
     · JU                  : util.js 공용 유틸(esc, todayISO)

   자리표시자 매핑:
     [a] 담당변호사   [a-1] 변호사 생년월일   [a-2] 등록번호(법인 공통)
     [b] 형제번호(=l_code)   [c] 지위(client_position)   [d] 의뢰인(l_client)
     [e] 죄명(l_name)   [f] 작성일(오늘)
     [g] 검사장 앞 → 검찰청명(기본 인천지방검찰청)  /  수임인 성명 → 담당사무원
     [g-1] 사무원 생년월일
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── 상수 ─────────────────────────────────────────── */
  // 변호사: 생년월일은 개인별(미입력분은 빈칸). 등록번호는 법인 공통.
  var ATTORNEYS = [
    { name: '서고은', birth: '840219' },
    { name: '정필성', birth: '' },
    { name: '김홍일', birth: '' },
    { name: '양선화', birth: '' },
    { name: '우숭민', birth: '' },
    { name: '이예나', birth: '' },
    { name: '손영우', birth: '' }
  ];
  var FIRM_REGNO = '395-86-03063';   // 등록번호[a-2] — 전 변호사 공통

  // 사무원(수임인): 생년월일 저장. 추가분은 localStorage.
  var CLERKS = [
    { name: '원가을', birth: '941103' },
    { name: '신주연', birth: '980828' },
    { name: '강민지', birth: '950109' },
    { name: '최인혜', birth: '820410' }
  ];
  var CLERKS_KEY = 'jeongseo_geomchal_clerks';  // 추가 사무원 기억

  // 법인 고정정보
  var FIRM_ADDR = '인천 미추홀구 한나루로436, 501호(두원빌딩)';
  var FIRM_TEL = '032) 868-7171';
  var FIRM_FAX = '032) 868-7676';
  var FIRM_CONTACT = '032) 868-7676';       // 위임장 수임인 연락처
  var PROS_OFFICE_DEFAULT = '인천지방검찰청';  // [g] 검사장 앞 기본값

  /* ── 작은 도우미 (공용 util.js 위임) ──────────────── */
  function esc(v) { return JU.esc(v); }
  function todayISO() { return JU.todayISO(); }
  // 'YYYY-MM-DD' → 'YYYY년 M월 D일'
  function fmtKDate(iso) {
    var m = ('' + (iso || '')).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return '';
    return m[1] + '년 ' + parseInt(m[2], 10) + '월 ' + parseInt(m[3], 10) + '일';
  }
  // 생년월일 문자열 정규화: '94.11.03' / '941103' → '941103'
  function normBirth(s) {
    var d = ('' + (s || '')).replace(/[^0-9]/g, '');
    return d.slice(0, 6);
  }
  // 사무원 목록(저장분 포함)
  function loadClerks() {
    var list = CLERKS.slice();
    try {
      var raw = localStorage.getItem(CLERKS_KEY);
      var arr = raw ? JSON.parse(raw) : null;
      if (arr && arr.length) {
        arr.forEach(function (c) {
          if (c && c.name && !list.some(function (x) { return x.name === c.name; })) list.push(c);
        });
      }
    } catch (e) {}
    return list;
  }
  function saveClerk(name, birth) {
    name = (name || '').trim();
    if (!name) return;
    var extra = [];
    try { extra = JSON.parse(localStorage.getItem(CLERKS_KEY) || '[]') || []; } catch (e) {}
    // 기본 명단에 있으면 저장 안 함
    if (CLERKS.some(function (x) { return x.name === name; })) return;
    var found = extra.find(function (x) { return x.name === name; });
    if (found) { if (birth) found.birth = normBirth(birth); }
    else extra.push({ name: name, birth: normBirth(birth) });
    try { localStorage.setItem(CLERKS_KEY, JSON.stringify(extra)); } catch (e) {}
  }
  function clerkBirth(name) {
    var c = loadClerks().find(function (x) { return x.name === name; });
    return c ? c.birth : '';
  }
  function attorneyBirth(name) {
    var a = ATTORNEYS.find(function (x) { return x.name === name; });
    return a ? a.birth : '';
  }

  /* ══════════════════════════════════════════════════════════════
     서면 렌더 — 값 객체 v 를 받아 인쇄용 HTML 을 돌려준다.
     v: { attorney, birth, regno, client, position, casenum, charge,
          prosOffice, clerk, clerkBirth, writeDate }
     ══════════════════════════════════════════════════════════════ */
  function renderGeomchal(v) {
    v = v || {};
    var seal = (typeof SEAL_SEOGOEUN !== 'undefined') ? SEAL_SEOGOEUN : '';
    var stampHTML = (v.attorney === '서고은' && seal)
      ? '<img class="gm-seal" src="' + seal + '" alt="">'
      : '<span class="gm-stamp-blank"></span>';
    var office = v.prosOffice || PROS_OFFICE_DEFAULT;

    return '<div class="gm-page">' + renderPage1(v, stampHTML, office) + '</div>';
  }

  /* ── 1페이지: 열람·등사 신청서 ── */
  function renderPage1(v, stampHTML, office) {
    return '' +
    '<div class="gm-doc-head">■ 검찰사건사무규칙 [별지 제170호의2서식] <span class="rev">&lt;개정 2014.6.26&gt;</span></div>' +
    '<div class="gm-title">열람ㆍ등사 신청서</div>' +
    '<div class="gm-subtitle">(「형사소송법」 제266조의3제1항제1호 및 제2호)</div>' +
    '<div class="gm-note-row"><span class="l">※ [&nbsp;&nbsp;]에는 해당되는 곳에 √표를 합니다.</span><span class="r">(앞쪽)</span></div>' +

    '<table class="gm-form">' +
      '<colgroup>' +
        '<col style="width:var(--gc0)"><col style="width:var(--gc1)">' +
        '<col style="width:var(--gc2)"><col style="width:var(--gc3)">' +
      '</colgroup>' +

      /* 접수 (검찰 작성란) */
      '<tr class="gm-gray">' +
        '<td colspan="2" class="lbl">접수번호</td>' +
        '<td class="lbl">접수일자</td>' +
        '<td class="lbl">처리기간&nbsp;&nbsp;&nbsp;48시간</td>' +
      '</tr>' +

      /* 신청인 — 성명/생년월일·등록번호 */
      '<tr>' +
        '<td rowspan="8" class="lbl vlbl">신청인</td>' +
        '<td rowspan="2" class="lbl">성 명</td>' +
        '<td rowspan="2" class="al">법무법인 정서<br>담당 변호사 ' + esc(v.attorney || '서고은') + '</td>' +
        '<td class="al">생년월일&nbsp; ' + esc(v.birth || '') + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="al">등록번호&nbsp; ' + esc(v.regno || FIRM_REGNO) + '</td>' +
      '</tr>' +

      /* 주소 / 전화·팩스 */
      '<tr>' +
        '<td rowspan="2" class="lbl">주 소</td>' +
        '<td rowspan="2" class="al fs9">' + esc(FIRM_ADDR) + '</td>' +
        '<td class="al">전화번호&nbsp; ' + esc(FIRM_TEL) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="al">팩스번호&nbsp; ' + esc(FIRM_FAX) + '</td>' +
      '</tr>' +

      /* 피고인과의 관계 */
      '<tr>' +
        '<td rowspan="4" class="lbl">피고인<br>과의<br>관계</td>' +
        '<td colspan="2" class="al">[ &nbsp;] 피고인 본인&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[●] 변 호 인</td>' +
      '</tr>' +
      '<tr><td colspan="2" class="al">[ &nbsp;] 피고인의 (&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</td></tr>' +
      '<tr><td colspan="2" class="al fs8">※ 피고인의 법정대리인, 특별대리인, 배우자, 직계친족, 형제자매인 경우에는 위임장 첨부</td></tr>' +
      '<tr><td colspan="2" class="al fs8">※ 변호인이 있는 피고인은 열람만 신청 가능</td></tr>' +

      /* 사건 — 사건번호(형제번호) / 지위·이름 / 죄명 */
      '<tr>' +
        '<td rowspan="2" class="lbl vlbl">사 건</td>' +
        '<td class="lbl">사건번호</td>' +
        '<td class="al">' + esc(v.casenum || '') + '</td>' +
        '<td class="al">' + esc(v.position || '') + '&nbsp;&nbsp; ' + esc(v.client || '') + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="lbl">죄 &nbsp;명</td>' +
        '<td colspan="2" class="al">' + esc(v.charge || '') + '</td>' +
      '</tr>' +

      /* 신청사유 */
      '<tr>' +
        '<td class="lbl">신청사유</td>' +
        '<td colspan="3" class="al">[●] 당해 사건 소송 준비</td>' +
      '</tr>' +

      /* 신청내용 */
      '<tr>' +
        '<td class="lbl">신청내용</td>' +
        '<td colspan="3" class="al gm-content">' +
          '<div>[●] 위 사건에 관한 서류 등의 목록의 열람ㆍ등사</div>' +
          '<div>[●] 검사가 증거로 신청할 서류 등의 열람ㆍ등사(제1호)</div>' +
          '<div>[ &nbsp;] 검사가 증인으로 신청할 사람의 성명ㆍ사건과의 관계 등을 기재한 서면의 교부 또는 그 사람이 공판기일 전에 행한 진술을 기재한 서류 등의 열람ㆍ등사(제2호)</div>' +
        '</td>' +
      '</tr>' +
    '</table>' +

    /* 표 아래 신청 문구 + 신청인 + 검사장 귀하 */
    '<div class="gm-statement">「형사소송법」 제266조의3제1항에 따라 위와 같이 열람ㆍ등사, 서면의 교부를 신청합니다.</div>' +
    '<div class="gm-date">' + esc(v.writeDate || '') + '</div>' +
    '<div class="gm-sign">신청인&nbsp;&nbsp;&nbsp; 변호사&nbsp;&nbsp;&nbsp; ' + esc(v.attorney || '서고은') + stampHTML + '&nbsp;(서명 또는 인)</div>' +
    '<div class="gm-toproc"><b>' + esc(office) + ' 검사장</b>&nbsp;&nbsp;<span class="small">귀하</span></div>' +

    /* 검사 결정란 (검찰이 작성) */
    '<table class="gm-decide">' +
      '<colgroup>' +
        '<col style="width:20mm"><col style="width:26mm">' +
        '<col style="width:22mm"><col style="width:22mm"><col style="width:22mm">' +
        '<col style="width:23mm"><col style="width:23mm">' +
      '</colgroup>' +
      '<tr class="gm-gray">' +
        '<td rowspan="3" class="lbl">검 사<br>결 정</td>' +
        '<td class="lbl">서류 등 목록</td>' +
        '<td colspan="3" class="lbl">제1호 서류 등</td>' +
        '<td colspan="2" class="lbl">제2호 서면 및 서류 등</td>' +
      '</tr>' +
      '<tr class="gm-gray">' +
        '<td class="lbl">허 가</td>' +
        '<td class="lbl">허 가</td><td class="lbl">거 부</td><td class="lbl">범위제한</td>' +
        '<td class="lbl">교부<br>(허가)</td><td class="lbl">불교부<br>(거부)</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="gm-stampcell"></td><td class="gm-stampcell"></td><td class="gm-stampcell"></td>' +
        '<td class="gm-stampcell"></td><td class="gm-stampcell"></td><td class="gm-stampcell"></td>' +
      '</tr>' +
    '</table>' +

    '<div class="gm-foot">' +
      '<span class="c">※ 210㎜×297㎜</span>' +
      '<span class="r">210㎜ × 297㎜(백상지 80g/㎡)<br>(신문용지 54g/㎡)</span>' +
    '</div>';
  }

  /* ══════════════════════════════════════════════════════════════
     전용 CSS 주입 (1회)
     ══════════════════════════════════════════════════════════════ */
  var STYLE_ID = 'geomchal-style';
  var GM_CSS =
      /* 열너비(mm) — 4열 표 */
      '#screen-geomchal{--gc0:16mm;--gc1:20mm;--gc2:69mm;--gc3:53.7mm;}' +
      '.gm-wrap{overflow:auto;padding:16px;background:#e9e9ec;min-height:100%;}' +
      '.gm-page{width:210mm;min-height:297mm;background:#fff;margin:0 auto 16px;' +
        'padding:15mm 25mm 12mm 25mm;box-shadow:0 2px 14px rgba(0,0,0,.18);' +
        "font-family:'함초롬바탕','HCR Batang','바탕',Batang,serif;color:#000;box-sizing:border-box;}" +
      /* 상단 서식 표기 / 제목 */
      '.gm-doc-head{font-size:9pt;margin-bottom:6mm;}' +
      '.gm-doc-head .rev{color:#1a4ea2;}' +
      '.gm-title{text-align:center;font-size:19pt;font-weight:700;letter-spacing:.15em;' +
        "font-family:'맑은 고딕','Malgun Gothic',sans-serif;}" +
      '.gm-subtitle{text-align:center;font-size:11pt;margin-top:1.5mm;}' +
      '.gm-note-row{display:flex;justify-content:space-between;align-items:flex-end;' +
        'font-size:9pt;margin:5mm 0 1mm;}' +
      /* 본표 */
      '.gm-form{width:158.7mm;border-collapse:collapse;table-layout:fixed;border:0.4mm solid #000;}' +
      '.gm-form td{border:0.12mm solid #000;padding:1mm 1.5mm;vertical-align:middle;' +
        'font-size:10pt;line-height:1.3;word-break:keep-all;}' +
      '.gm-form .fs9{font-size:9pt;}' +
      '.gm-form .fs8{font-size:8.5pt;color:#222;}' +
      '.gm-form .lbl{text-align:center;letter-spacing:.04em;}' +
      '.gm-form .al{text-align:left;}' +
      '.gm-form .vlbl{font-weight:600;letter-spacing:.2em;}' +
      '.gm-form .gm-gray td,.gm-form tr.gm-gray>td{background:#d9d9d9;}' +
      '.gm-gray td{background:#d9d9d9;text-align:center;font-size:9.5pt;height:7mm;}' +
      '.gm-content div{margin:.4mm 0;}' +
      /* 신청 문구·서명·검사장 */
      '.gm-statement{margin-top:5mm;font-size:11pt;}' +
      '.gm-date{text-align:right;font-size:11pt;margin-top:6mm;padding-right:6mm;}' +
      '.gm-sign{text-align:right;font-size:11pt;margin-top:2mm;padding-right:6mm;}' +
      '.gm-toproc{font-size:15pt;margin-top:3mm;letter-spacing:.05em;}' +
      '.gm-toproc .small{font-size:10pt;}' +
      '.gm-seal{width:12mm;height:12mm;vertical-align:middle;margin-left:2mm;}' +
      '.gm-stamp-blank{display:inline-block;width:12mm;height:12mm;vertical-align:middle;margin-left:2mm;}' +
      /* 검사 결정표 */
      '.gm-decide{width:158.7mm;border-collapse:collapse;table-layout:fixed;border:0.4mm solid #000;margin-top:5mm;}' +
      '.gm-decide td{border:0.12mm solid #000;text-align:center;font-size:9.5pt;padding:1mm;line-height:1.25;}' +
      '.gm-decide .gm-stampcell{height:11mm;}' +
      /* 하단 규격 */
      '.gm-foot{display:flex;justify-content:space-between;align-items:flex-end;' +
        'font-size:8.5pt;margin-top:3mm;}' +
      '.gm-foot .c{padding-left:30mm;}' +
      '.gm-foot .r{text-align:right;}' +
      /* 입력폼 (오버레이) */
      '#geomchalForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
      '#geomchalForm.active{display:flex;}' +
      /* 인쇄 */
      '@media print{' +
        '.gm-wrap{overflow:visible;padding:0;background:#fff;}' +
        '.gm-page{margin:0;box-shadow:none;page-break-after:always;}' +
        '.gm-page:last-child{page-break-after:auto;}' +
        '@page{size:A4;margin:0;}' +
      '}';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = GM_CSS;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════
     화면 껍데기 주입 (1회) — 입력폼 + 서면
     ══════════════════════════════════════════════════════════════ */
  var SHELL_ID = 'geomchal-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;

    var attOpts = ATTORNEYS.map(function (a) {
      return '<option value="' + esc(a.name) + '"' + (a.name === '서고은' ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    }).join('');

    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      /* ── 입력폼 ── */
      '<div id="geomchalForm">' +
        '<div class="fs-head">' +
          '<button class="fs-close" onclick="closeGeomchalForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
          '<div class="fs-title">열람·등사 신청서 (검찰)</div>' +
        '</div>' +
        '<div class="fs-body">' +
          '<div class="fs-section">사건 정보</div>' +
          '<div class="fs-field"><label class="fs-label">의뢰인</label><input type="text" class="fs-input" id="gm-client" data-af="l_client" placeholder="홍길동"></div>' +
          '<div class="fs-field"><label class="fs-label">지위</label><input type="text" class="fs-input" id="gm-position" data-af="client_position" placeholder="피의자"></div>' +
          '<div class="fs-field"><label class="fs-label">사건번호 (형제번호)</label><input type="text" class="fs-input" id="gm-casenum" data-af="l_code" placeholder="2026형제11173"></div>' +
          '<div class="fs-field"><label class="fs-label">죄명</label><input type="text" class="fs-input" id="gm-charge" data-af="l_name" placeholder="횡령"></div>' +
          '<div class="fs-field"><label class="fs-label">검찰청</label><input type="text" class="fs-input" id="gm-prosoffice" value="' + esc(PROS_OFFICE_DEFAULT) + '"></div>' +
          '<div class="fs-field"><label class="fs-label">작성일 (오늘 자동)</label><input type="date" class="fs-input" id="gm-writedate"></div>' +

          '<div class="fs-section">신청인</div>' +
          '<div class="fs-field"><label class="fs-label">담당변호사</label><select class="fs-input" id="gm-attorney">' + attOpts + '</select></div>' +
        '</div>' +
        '<div class="fs-foot">' +
          '<button class="fs-btn ghost" onclick="closeGeomchalForm()">취소</button>' +
          '<button class="fs-btn primary" onclick="applyGeomchalForm()">완료</button>' +
        '</div>' +
      '</div>' +

      /* ── 서면(출력) 화면 ── */
      '<div id="screen-geomchal" class="screen">' +
        '<div class="sj-appbar no-print">' +
          '<button class="sj-back" onclick="showScreen(\'screen-home\')">‹ 처음으로</button>' +
          '<div class="sj-title">열람·등사 신청서 (검찰)</div>' +
          '<button class="sj-edit-btn" onclick="editGeomchal()">수정</button>' +
          '<button class="sj-print-btn" onclick="window.print()">출력</button>' +
        '</div>' +
        '<div class="gm-wrap"><div id="gm-host"></div></div>' +
      '</div>';

    document.body.appendChild(wrap);
  }

  /* ══════════════════════════════════════════════════════════════
     상태 & 진입점
     ══════════════════════════════════════════════════════════════ */
  var state = null;

  function ensureUI() { injectStyle(); injectShell(); }

  // yeollam.js 갈림길 → 검찰 선택 시 호출
  window.openGeomchalForm = function () {
    ensureUI();
    document.getElementById('gm-client').value = '';
    document.getElementById('gm-position').value = '';
    document.getElementById('gm-casenum').value = '';
    document.getElementById('gm-charge').value = '';
    document.getElementById('gm-prosoffice').value = PROS_OFFICE_DEFAULT;
    document.getElementById('gm-writedate').value = todayISO();
    document.getElementById('gm-attorney').value = '서고은';

    document.getElementById('geomchalForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('gm-casenum');
  };

  window.closeGeomchalForm = function () {
    var f = document.getElementById('geomchalForm');
    if (f) f.classList.remove('active');
  };

  /* ── 완료 → 서면 렌더 → 출력 화면 ── */
  window.applyGeomchalForm = function () {
    var attorney = (document.getElementById('gm-attorney') || {}).value || '서고은';
    state = {
      attorney: attorney,
      birth: attorneyBirth(attorney),
      regno: FIRM_REGNO,
      client: (document.getElementById('gm-client') || {}).value || '',
      position: (document.getElementById('gm-position') || {}).value || '',
      casenum: (document.getElementById('gm-casenum') || {}).value || '',
      charge: (document.getElementById('gm-charge') || {}).value || '',
      prosOffice: (document.getElementById('gm-prosoffice') || {}).value || PROS_OFFICE_DEFAULT,
      writeDate: fmtKDate((document.getElementById('gm-writedate') || {}).value || todayISO())
    };
    document.getElementById('gm-host').innerHTML = renderGeomchal(state);
    closeGeomchalForm();
    if (typeof showScreen === 'function') showScreen('screen-geomchal');
  };

  /* ── 수정: 현재 값으로 폼 다시 열기 ── */
  window.editGeomchal = function () {
    ensureUI();
    if (!state) { window.openGeomchalForm(); return; }
    document.getElementById('gm-client').value = state.client || '';
    document.getElementById('gm-position').value = state.position || '';
    document.getElementById('gm-casenum').value = state.casenum || '';
    document.getElementById('gm-charge').value = state.charge || '';
    document.getElementById('gm-prosoffice').value = state.prosOffice || PROS_OFFICE_DEFAULT;
    document.getElementById('gm-attorney').value = state.attorney || '서고은';
    var m = ('' + (state.writeDate || '')).match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    document.getElementById('gm-writedate').value = m
      ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : todayISO();
    document.getElementById('geomchalForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('gm-casenum');
  };

  /* node 검증용(브라우저에서는 무시됨) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderGeomchal: renderGeomchal, GM_CSS: GM_CSS, fmtKDate: fmtKDate, normBirth: normBirth };
  }

})();
