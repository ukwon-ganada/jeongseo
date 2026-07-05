/* 법무법인 정서 PWA - 재판기록 열람·복사/출력·복제 신청서 (yeollam.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. index.html 에는 진입점 버튼 + <script src="yeollam.js"> 만 둔다.
   화면(갈림길·입력폼·서면)·전용 CSS 는 이 파일이 <body>에 1회 주입한다.

   진입점(홈 버튼): onclick="goYeollam()"
   흐름: goYeollam() → [법원/검찰 갈림길] → 법원 → 입력폼 → 완료 → 서면 → window.print()

   의존:
     · showScreen(id)      : index.html 공용 화면 전환 (항소장·계약서와 동일)
     · SEAL_SEOGOEUN       : 전역 도장 base64 (index.html) — 서고은 선택 시 날인
     · initAutofillFor()   : autofill.js 범용 자동완성 진입점 (data-af 표준)
       재판부는 표준 밖 → initAutofillFor(anchor, {courtDept:'칸id'}) 확장 인자로 위임
       (그 확장 처리는 autofill.js 에 진입점으로 추가 — 통합 단계에서)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── 상수 ─────────────────────────────────────────── */
  var ATTORNEYS = ['서고은', '정필성', '김홍일', '양선화', '우숭민', '이예나', '손영우'];
  var CLERKS_SEED = ['원가을', '신주연', '최인혜', '강민지'];
  var CLERKS_KEY = 'jeongseo_yeollam_clerks';   // 사무원 목록 기억(localStorage)
  var FIRM_TEL = '032-868-7171';

  var USE_PRESETS = [
    { key: '재판', text: '재판준비를 위하여' },
    { key: '합의', text: '합의를 위하여' },
    { key: '공탁', text: '공탁을 위하여' }
  ];
  var TARGET_DEFAULT = '증거기록, 소송기록 일체, 미디어파일 일체(CD 등)';

  /* ── 작은 도우미 (공용 util.js 위임) ──────────────── */
  function esc(v) { return JU.esc(v); }
  function todayISO() { return JU.todayISO(); }
  // 'YYYY-MM-DD' → 'YYYY년 M월 D일'
  function fmtKDate(iso) {
    var m = ('' + (iso || '')).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return '';
    return m[1] + '년 ' + parseInt(m[2], 10) + '월 ' + parseInt(m[3], 10) + '일';
  }
  function loadClerks() {
    try {
      var raw = localStorage.getItem(CLERKS_KEY);
      var arr = raw ? JSON.parse(raw) : null;
      if (arr && arr.length) return arr;
    } catch (e) {}
    return CLERKS_SEED.slice();
  }
  function saveClerk(name) {
    name = (name || '').trim();
    if (!name) return;
    var list = loadClerks();
    if (list.indexOf(name) < 0) {
      list.push(name);
      try { localStorage.setItem(CLERKS_KEY, JSON.stringify(list)); } catch (e) {}
    }
  }

  /* ══════════════════════════════════════════════════════════════
     서면 렌더 (순수 함수) — 값 객체 v 를 받아 인쇄용 표 HTML 을 돌려준다.
     v: { attorney, clerk, position, client, use, casenum, casename,
          courtDept, target, writeDate }
     도장: attorney === '서고은' 이고 전역 SEAL_SEOGOEUN 있으면 직인 이미지,
           그 외 변호사는 날인칸을 비워 실물 날인.
     ══════════════════════════════════════════════════════════════ */
  function renderYeollam(v) {
    v = v || {};
    var seal = (typeof SEAL_SEOGOEUN !== 'undefined') ? SEAL_SEOGOEUN : '';
    var stampHTML = (v.attorney === '서고은' && seal)
      ? '<img class="yl-seal" src="' + seal + '" alt="">'
      : '<span class="yl-stamp-blank"></span>';

    return '' +
    '<table class="yl-form">' +
      '<colgroup>' +
        '<col style="width:var(--yc0)"><col style="width:var(--yc1)"><col style="width:var(--yc2)">' +
        '<col style="width:var(--yc3)"><col style="width:var(--yc4)"><col style="width:var(--yc5)"><col style="width:var(--yc6)">' +
      '</colgroup>' +

      /* r0~r1 : 제목 + 결재란(허/부) */
      '<tr>' +
        '<td colspan="5" rowspan="2" class="yl-title"><span class="t">재판기록 열람·복사/출력·복제 신청서</span></td>' +
        '<td class="yl-appr-h">허</td><td class="yl-appr-h">부</td>' +
      '</tr>' +
      '<tr><td class="yl-appr-box"></td><td class="yl-appr-box"></td></tr>' +

      /* r2~r4 : 신청인 블록 */
      '<tr>' +
        '<td rowspan="3" class="lbl">신 청 인</td>' +
        '<td rowspan="2" class="lbl">성 명</td>' +
        '<td rowspan="2" class="ctr">법무법인 정서<br>담당변호사 ' + esc(v.attorney || '서고은') + '</td>' +
        '<td colspan="2" class="lbl">전화 번호</td>' +
        '<td colspan="2" class="ctr">' + esc(FIRM_TEL) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td colspan="2" class="lbl">담당사무원</td>' +
        '<td colspan="2" class="ctr">' + esc(v.clerk || '') + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="lbl">자 격</td>' +
        '<td class="ctr" style="white-space:nowrap">' + esc(v.position || '') + ' ' + esc(v.client || '') + '의<br>변호인</td>' +
        '<td colspan="2" class="lbl">소명자료</td>' +
        '<td colspan="2" class="ctr">사무원증</td>' +
      '</tr>' +

      /* r5 : 신청 구분 (열람·복사 기본) */
      '<tr>' +
        '<td class="lbl">신 청 구 분</td>' +
        '<td colspan="6" class="check">' +
          '<span class="on">☑ 열람</span>&nbsp;&nbsp;&nbsp;' +
          '<span class="on">☑ 복사</span>&nbsp;&nbsp;&nbsp;□ 출력&nbsp;&nbsp;&nbsp;□ 복제' +
        '</td>' +
      '</tr>' +

      /* r6 : 사용 용도 */
      '<tr>' +
        '<td class="lbl">사 용 용 도</td>' +
        '<td colspan="6"><span class="vb">' + esc(v.use || '') + '</span></td>' +
      '</tr>' +

      /* r7~r8 : 대상 기록 */
      '<tr>' +
        '<td rowspan="2" class="lbl">대 상 기 록</td>' +
        '<td class="lbl">사건번호</td>' +
        '<td colspan="3" class="lbl">사 건 명</td>' +
        '<td colspan="2" class="lbl">재 판 부</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="ctr fs9">' + esc(v.casenum || '') + '</td>' +
        '<td colspan="3" class="ctr fs9">' + esc(v.casename || '') + '</td>' +
        '<td colspan="2" class="ctr">' + esc(v.courtDept || '') + '</td>' +
      '</tr>' +

      /* r9 : 복사/출력·복제할 부분 */
      '<tr>' +
        '<td class="lbl">복사/출력·<br>복제할 부분</td>' +
        '<td colspan="6">' + esc(v.target || '') + '</td>' +
      '</tr>' +

      /* r10 : 복사/출력 방법 */
      '<tr>' +
        '<td class="lbl">복사/출력<br>방법</td>' +
        '<td colspan="6" class="check">□ 법원 복사기&nbsp;&nbsp;&nbsp;□ 변호사단체 복사기&nbsp;&nbsp;&nbsp;' +
          '<span class="on">☑ 신청인 복사설비</span>&nbsp;&nbsp;&nbsp;□ 필사</td>' +
      '</tr>' +

      /* r11 : 서약문 (3줄, 원본 재현) */
      '<tr>' +
        '<td colspan="7" class="oath">' +
          '<div class="body">이와 같이 신청하고, 신청인은 열람·복사/출력·복제에 관련된 준수사항을 엄수하며, 열람·복사/출력·복제의 결과물을 통하여 알게 된 개인정보, 영업비밀 등을 개인정보 보호법 등 관계법령 상 정당한 용도 이외로 사용하는 경우 민사상, 형사상 모든 책임을 지겠습니다.</div>' +
          '<div class="date">' + esc(v.writeDate || '') + '</div>' +
          '<div class="sign">신청인&nbsp;&nbsp;&nbsp; ' + esc(v.attorney || '서고은') + stampHTML + '&nbsp;(서명 또는 날인)</div>' +
        '</td>' +
      '</tr>' +

      /* r12 : 비고 */
      '<tr>' +
        '<td class="lbl">비 고<br>(재판장<br>지정사항 등)</td>' +
        '<td colspan="6" style="height:12mm"></td>' +
      '</tr>' +

      /* r13 : 영수 일시 / 영수인 */
      '<tr>' +
        '<td class="lbl" style="height:8.2mm">영 수 일 시</td>' +
        '<td colspan="2">' + (new Date().getFullYear()) + '.&nbsp;&nbsp;&nbsp;.&nbsp;&nbsp;&nbsp;&nbsp;.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</td>' +
        '<td class="lbl">영 수 인</td>' +
        '<td colspan="3" class="ctr">변호사&nbsp; ' + esc(v.attorney || '서고은') + '</td>' +
      '</tr>' +

      /* r14~r15 : 신청수수료 / 비용 + 수입인지 첩부란 */
      '<tr>' +
        '<td class="lbl">신청 수수료</td>' +
        '<td colspan="2" class="ctr">□ 500 원&nbsp;&nbsp; <span class="on">√ 면 제</span></td>' +
        '<td colspan="4" rowspan="2" class="ctr">(수 입 인 지&nbsp; 첩 부 란)</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="lbl">복사/출력·<br>복제 비용</td>' +
        '<td colspan="2" class="ctr">원</td>' +
      '</tr>' +
    '</table>' +

    /* 표 아래 준수사항 (고정) */
    '<div class="yl-rules">' +
      '<div class="head">※ 준수사항 및 작성요령</div>' +
      '<ol>' +
        '<li><b>[개인정보 보호법 제19조]</b> 개인정보처리자로부터 개인정보를 제공받은 자는 다음 각 호의 어느 하나에 해당하는 경우를 제외하고는 개인정보를 제공받은 목적 외의 용도로 이용하거나 이를 제3자에게 제공하여서는 아니 된다. 1. 정보주체로부터 별도의 동의를 받은 경우 2. 다른 법률에 특별한 규정이 있는 경우</li>' +
        '<li><b>[민사소송법 제162조 ④항]</b> 소송기록을 열람·복사한 사람은 열람·복사에 의하여 알게 된 사항을 이용하여 공공의 질서 또는 선량한 풍속을 해하거나 관계인의 명예 또는 생활의 평온을 해하는 행위를 하여서는 아니 된다.</li>' +
        '<li>신청인·영수인란은 서명 또는 날인하고, 소송대리인·변호인의 사무원이 열람·복사하는 경우에는 담당사무원란에 그 사무원의 성명을 기재</li>' +
        '<li>신청수수료는 1건당 500원(수입인지로 납부). 다만, 사건의 당사자 및 그 법정대리인·소송대리인·변호인(사무원 포함)·보조인 등이 그 사건의 계속 중에 열람하는 때에는 신청수수료 면제</li>' +
        '<li>법원복사기/프린터로 복사/출력하는 경우에는 1장당 50원의 비용을 수입인지로 납부 (다만, 100원 단위 미만 금액은 이를 계산하지 아니함)</li>' +
        '<li>매체를 지참하여 복제하는 경우에는 700메가바이트 기준 1건마다 500원, 700메가바이트 초과 시 350메가바이트마다 300원의 비용을 수입인지로 납부(매체를 지참하지 아니한 경우 매체 비용은 별도)</li>' +
        '<li>복사/출력·복제할 부분 란에 복사대상(기록의 일부를 복사/출력·복제하는 경우에는 대상을 열거하여 특정하여야 함) 및 복사/출력을 정확하게 기재하여야 함</li>' +
        '<li>열람·복사 담당 법원공무원의 처분에 대하여 불복하는 경우에는 이의신청을 할 수 있음</li>' +
      '</ol>' +
      '<div class="a2200">A2200</div>' +
    '</div>';
  }

  /* ══════════════════════════════════════════════════════════════
     전용 CSS 주입 (1회) — 목업 실측값 그대로. 서면 표 + 인쇄.
     ══════════════════════════════════════════════════════════════ */
  var STYLE_ID = 'yeollam-style';
  var YL_CSS =
      /* 원본 실측 열너비(mm) */
      '#screen-yeollam{--yc0:25.4mm;--yc1:29.8mm;--yc2:35.6mm;--yc3:24.7mm;--yc4:12.7mm;--yc5:14.9mm;--yc6:15.6mm;}' +
      '.yl-wrap{overflow:auto;padding:16px;background:#e9e9ec;min-height:100%;}' +
      '.yl-page{width:210mm;min-height:297mm;background:#fff;margin:0 auto;' +
        'padding:16mm 25mm 16mm 25mm;box-shadow:0 2px 14px rgba(0,0,0,.18);' +
        "font-family:'함초롬바탕','HCR Batang','바탕',Batang,serif;color:#000;}" +
      '.yl-form{width:158.7mm;border-collapse:collapse;table-layout:fixed;border:0.4mm solid #000;}' +
      '.yl-form td{border:0.12mm solid #000;padding:0.8mm 1.2mm;vertical-align:middle;' +
        'font-size:10pt;line-height:1.28;word-break:keep-all;}' +
      '.yl-form .fs9{font-size:9pt;}' +
      '.yl-form .lbl{text-align:center;letter-spacing:.06em;}' +
      '.yl-form .ctr{text-align:center;}' +
      '.yl-title{text-align:center;overflow:hidden;}' +
      ".yl-title .t{display:inline-block;white-space:nowrap;font-size:16pt;font-weight:700;" +
        "font-family:'맑은 고딕','Malgun Gothic',sans-serif;letter-spacing:0;}" +
      '.yl-appr-h{text-align:center;font-size:9.5pt;height:5mm;}' +
      '.yl-appr-box{height:12mm;}' +
      '.yl-form .vb{font-weight:700;}' +
      '.yl-form .check .on{font-weight:700;}' +
      '.yl-form .oath{text-align:center;padding:1.8mm 0.5mm 2mm;}' +
      ".yl-form .oath .body{font-size:12pt;font-weight:700;line-height:1.5;" +
        "font-family:'맑은 고딕','Malgun Gothic',sans-serif;letter-spacing:-0.062em;}" +
      '.yl-form .oath .date{font-size:12pt;margin-top:3mm;}' +
      '.yl-form .oath .sign{font-size:12pt;margin-top:2mm;}' +
      '.yl-seal{width:13mm;height:13mm;vertical-align:middle;margin-left:3mm;}' +
      '.yl-stamp-blank{display:inline-block;width:13mm;height:13mm;vertical-align:middle;margin-left:3mm;}' +
      '.yl-rules{width:158.7mm;margin-top:2mm;font-size:9pt;line-height:1.34;text-align:justify;' +
        "font-family:'함초롬바탕','HCR Batang','바탕',Batang,serif;}" +
      '.yl-rules .head{font-weight:700;margin-bottom:1mm;}' +
      '.yl-rules ol{margin:0;padding-left:5.2mm;}' +
      '.yl-rules li{margin-bottom:.6mm;}' +
      '.yl-rules .a2200{text-align:right;font-size:8.5pt;margin-top:4mm;letter-spacing:.1em;}' +
      /* 사용용도 프리셋 칩 (앱 fs-chip 과 어울리는 작은 버튼) */
      '.yl-use-presets{display:flex;gap:6px;margin-bottom:8px;}' +
      '.yl-use-chip{padding:4px 12px;border:1px solid var(--border,#e8e8e8);border-radius:16px;' +
        'background:#fff;color:#555;font-size:12px;cursor:pointer;-webkit-appearance:none;' +
        'transition:.12s;line-height:1.2;}' +
      '.yl-use-chip:active{transform:scale(.96);}' +
      '.yl-use-chip.on{background:var(--black,#1a1a1a);color:#fff;border-color:var(--black,#1a1a1a);}' +
      /* 입력폼: 화면 전체를 덮는 팝업 (항소장·선임계 폼과 동일) */
      '#yeollamForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
      '#yeollamForm.active{display:flex;}' +
      /* 법원/검찰 팝업 아이콘 박스 (흑백 미니멀) */
      '.yl-type-ico{width:40px;height:40px;flex-shrink:0;display:flex;align-items:center;justify-content:center;' +
        'border:1px solid var(--border,#e8e8e8);border-radius:11px;background:#fff;}' +
      '.yl-type-ico svg{width:23px;height:23px;stroke:var(--black,#1a1a1a);}' +
      /* 인쇄: 서면만, 앱 UI 숨김 */
      '@media print{' +
        '.yl-wrap{overflow:visible;padding:0;background:#fff;}' +
        '.yl-page{margin:0;box-shadow:none;}' +
        '@page{size:A4;margin:0;}' +
      '}';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = YL_CSS;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════
     화면 껍데기 주입 (1회) — 갈림길 / 입력폼 / 서면.
     항소장·계약서와 동일한 공용 클래스(.screen, .sj-appbar, .fs-*) 재사용.
     ══════════════════════════════════════════════════════════════ */
  var SHELL_ID = 'yeollam-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;

    var attOpts = ATTORNEYS.map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === '서고은' ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');

    var useChips = USE_PRESETS.map(function (p, i) {
      return '<button type="button" class="yl-use-chip' + (i === 0 ? ' on' : '') +
        '" data-use="' + esc(p.text) + '" onclick="ylUsePreset(this)">' + esc(p.key) + '</button>';
    }).join('');

    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      /* ── 법원/검찰 선택 팝업 (다른 서면과 동일한 .overlay.centered) ── */
      '<div class="overlay centered" id="yeollamTypeSheet" onclick="if(event.target===this)closeYeollamType()">' +
        '<div class="sheet">' +
          '<div class="sh-handle"></div>' +
          '<div class="sh-head"><div class="sh-title">열람·복사 신청서</div><div class="sh-desc">어디에 신청하나요?</div></div>' +
          '<div class="sh-div"></div>' +
          '<div class="type-item" onclick="openYeollamForm(\'법원\')">' +
            '<div class="yl-type-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M4 10h16"/><path d="M12 3 3.5 8.2h17z"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/></svg></div>' +
            '<div class="type-body"><div class="type-name">법원</div><div class="type-desc">재판기록 열람·복사/출력·복제 신청서</div></div>' +
            '<div class="type-arrow">›</div>' +
          '</div>' +
          '<div class="type-item" onclick="openYeollamForm(\'검찰\')">' +
            '<div class="yl-type-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 2.5v5.4c0 4.2-3 7.4-7 8.6-4-1.2-7-4.4-7-8.6V5.5z"/></svg></div>' +
            '<div class="type-body"><div class="type-name">검찰</div><div class="type-desc">열람·등사 신청서</div></div>' +
            '<div class="type-arrow">›</div>' +
          '</div>' +
          '<button class="sh-cancel" onclick="closeYeollamType()">취소</button>' +
        '</div>' +
      '</div>' +

      /* ── 입력폼 (오버레이) ── */
      '<div id="yeollamForm">' +
        '<div class="fs-head">' +
          '<button class="fs-close" onclick="closeYeollamForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
          '<div class="fs-title">열람·복사 신청서 (법원)</div>' +
        '</div>' +
        '<div class="fs-body">' +
          '<div class="fs-section">사건 정보</div>' +
          '<div class="fs-field"><label class="fs-label">의뢰인</label><input type="text" class="fs-input" id="yl-client" data-af="l_client" placeholder="홍길동"></div>' +
          '<div class="fs-field"><label class="fs-label">지위</label><input type="text" class="fs-input" id="yl-position" data-af="client_position" placeholder="피고인"></div>' +
          '<div class="fs-field"><label class="fs-label">사건번호</label><input type="text" class="fs-input" id="yl-casenum" data-af="l_code" placeholder="2024노1234"></div>' +
          '<div class="fs-field"><label class="fs-label">사건명</label><input type="text" class="fs-input" id="yl-casename" data-af="l_name" placeholder="사기"></div>' +
          '<div class="fs-field"><label class="fs-label">재판부 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="text" class="fs-input" id="yl-courtdept" placeholder="제1형사부"></div>' +

          '<div class="fs-section">신청 내용</div>' +
          '<div class="fs-field"><label class="fs-label">사용 용도</label>' +
            '<div class="yl-use-presets">' + useChips + '</div>' +
            '<input type="text" class="fs-input" id="yl-use" value="' + esc(USE_PRESETS[0].text) + '" oninput="ylUseEdited()"></div>' +
          '<div class="fs-field"><label class="fs-label">복사/출력·복제할 부분</label><input type="text" class="fs-input" id="yl-target" value="' + esc(TARGET_DEFAULT) + '"></div>' +
          '<div class="fs-field"><label class="fs-label">작성일 (오늘 자동)</label><input type="date" class="fs-input" id="yl-writedate"></div>' +

          '<div class="fs-section">신청인</div>' +
          '<div class="fs-field"><label class="fs-label">담당변호사</label><select class="fs-input" id="yl-attorney">' + attOpts + '</select></div>' +
          '<div class="fs-field"><label class="fs-label">담당사무원</label>' +
            '<select class="fs-input" id="yl-clerk"></select>' +
            '<div class="att-add-row"><input type="text" class="att-add-input" id="yl-clerk-new" placeholder="추가할 사무원 이름"><button type="button" class="att-add-btn" onclick="ylAddClerk()">＋ 추가</button></div></div>' +
        '</div>' +
        '<div class="fs-foot">' +
          '<button class="fs-btn ghost" onclick="closeYeollamForm()">취소</button>' +
          '<button class="fs-btn primary" onclick="applyYeollamForm()">완료</button>' +
        '</div>' +
      '</div>' +

      /* ── 서면(출력) 화면 ── */
      '<div id="screen-yeollam" class="screen">' +
        '<div class="sj-appbar no-print">' +
          '<button class="sj-back" onclick="showScreen(\'screen-home\')">‹ 처음으로</button>' +
          '<div class="sj-title">열람·복사 신청서</div>' +
          '<button class="sj-edit-btn" onclick="editYeollam()">수정</button>' +
          '<button class="sj-print-btn" onclick="window.print()">출력</button>' +
        '</div>' +
        '<div class="yl-wrap"><div class="yl-page"><div id="yl-host"></div></div></div>' +
      '</div>';

    document.body.appendChild(wrap);
  }

  /* 사무원 select 채우기 */
  function fillClerkSelect(selected) {
    var sel = document.getElementById('yl-clerk');
    if (!sel) return;
    var list = loadClerks();
    sel.innerHTML = list.map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }

  /* ══════════════════════════════════════════════════════════════
     상태 & 진입점
     ══════════════════════════════════════════════════════════════ */
  var state = null;  // 마지막 완료 값 (수정 시 재사용)

  function ensureUI() { injectStyle(); injectShell(); }

  // 홈 버튼 → 법원/검찰 선택 팝업
  window.goYeollam = function () {
    ensureUI();
    document.getElementById('yeollamTypeSheet').classList.add('active');
  };
  // 팝업 닫기
  window.closeYeollamType = function () {
    var el = document.getElementById('yeollamTypeSheet');
    if (el) el.classList.remove('active');
  };

  // 갈림길 → 법원(폼) / 검찰(준비 중)
  window.openYeollamForm = function (kind) {
    ensureUI();
    if (kind === '검찰') {
      // 검찰 갈림길 → 별도 모듈(geomchal.js)로 위임
      var _ts2 = document.getElementById('yeollamTypeSheet');
      if (_ts2) _ts2.classList.remove('active');
      if (typeof window.openGeomchalForm === 'function') { window.openGeomchalForm(); }
      else if (typeof showToast === 'function') { showToast('검찰 서면 모듈을 불러오지 못했습니다'); }
      else { alert('검찰 서면 모듈을 불러오지 못했습니다.'); }
      return;
    }
    // 법원: 선택 팝업 닫고 폼 열기
    var _ts = document.getElementById('yeollamTypeSheet');
    if (_ts) _ts.classList.remove('active');
    // 법원 폼 초기화
    document.getElementById('yl-client').value = '';
    document.getElementById('yl-position').value = '';
    document.getElementById('yl-casenum').value = '';
    document.getElementById('yl-casename').value = '';
    document.getElementById('yl-courtdept').value = '';
    document.getElementById('yl-use').value = USE_PRESETS[0].text;
    document.getElementById('yl-target').value = TARGET_DEFAULT;
    document.getElementById('yl-writedate').value = todayISO();
    document.getElementById('yl-attorney').value = '서고은';
    fillClerkSelect(CLERKS_SEED[0]);
    setUseChip(USE_PRESETS[0].text);

    document.getElementById('yeollamForm').classList.add('active');
    // 자동완성 + 재판부 실시간 조회(재판부는 표준 밖 → 확장 인자로 위임)
    if (typeof initAutofillFor === 'function') {
      initAutofillFor('yl-casenum', { courtDept: 'yl-courtdept' });
    }
  };

  window.closeYeollamForm = function () {
    var f = document.getElementById('yeollamForm');
    if (f) f.classList.remove('active');
  };

  /* ── 사용용도 프리셋 ── */
  window.ylUsePreset = function (btn) {
    var text = btn.getAttribute('data-use') || '';
    var inp = document.getElementById('yl-use');
    if (inp) inp.value = text;
    setUseChip(text);
  };
  // 직접 편집하면 칩 선택 해제
  window.ylUseEdited = function () {
    var inp = document.getElementById('yl-use');
    setUseChip(inp ? inp.value : '');
  };
  function setUseChip(text) {
    var chips = document.querySelectorAll('#yeollamForm .yl-use-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('on', chips[i].getAttribute('data-use') === text);
    }
  }

  /* ── 사무원 추가 ── */
  window.ylAddClerk = function () {
    var inp = document.getElementById('yl-clerk-new');
    var name = inp ? inp.value.trim() : '';
    if (!name) return;
    saveClerk(name);
    fillClerkSelect(name);
    if (inp) inp.value = '';
  };

  /* ── 완료 → 서면 렌더 → 출력 화면 ── */
  window.applyYeollamForm = function () {
    var clerk = (document.getElementById('yl-clerk') || {}).value || '';
    saveClerk(clerk);
    state = {
      attorney: (document.getElementById('yl-attorney') || {}).value || '서고은',
      clerk: clerk,
      position: (document.getElementById('yl-position') || {}).value || '',
      client: (document.getElementById('yl-client') || {}).value || '',
      use: (document.getElementById('yl-use') || {}).value || '',
      casenum: (document.getElementById('yl-casenum') || {}).value || '',
      casename: (document.getElementById('yl-casename') || {}).value || '',
      courtDept: (document.getElementById('yl-courtdept') || {}).value || '',
      target: (document.getElementById('yl-target') || {}).value || '',
      writeDate: fmtKDate((document.getElementById('yl-writedate') || {}).value || todayISO())
    };
    document.getElementById('yl-host').innerHTML = renderYeollam(state);
    closeYeollamForm();
    if (typeof showScreen === 'function') showScreen('screen-yeollam');
  };

  /* ── 수정: 현재 값으로 폼 다시 열기 ── */
  window.editYeollam = function () {
    ensureUI();
    if (!state) { window.openYeollamForm('법원'); return; }
    document.getElementById('yl-client').value = state.client || '';
    document.getElementById('yl-position').value = state.position || '';
    document.getElementById('yl-casenum').value = state.casenum || '';
    document.getElementById('yl-casename').value = state.casename || '';
    document.getElementById('yl-courtdept').value = state.courtDept || '';
    document.getElementById('yl-use').value = state.use || '';
    document.getElementById('yl-target').value = state.target || '';
    document.getElementById('yl-attorney').value = state.attorney || '서고은';
    fillClerkSelect(state.clerk || CLERKS_SEED[0]);
    setUseChip(state.use || '');
    // 작성일(한글) → ISO 되돌리기
    var m = ('' + (state.writeDate || '')).match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    document.getElementById('yl-writedate').value = m
      ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : todayISO();
    document.getElementById('yeollamForm').classList.add('active');
    if (typeof initAutofillFor === 'function') {
      initAutofillFor('yl-casenum', { courtDept: 'yl-courtdept' });
    }
  };

  /* node 검증용(브라우저에서는 무시됨) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderYeollam: renderYeollam, USE_PRESETS: USE_PRESETS, fmtKDate: fmtKDate, YL_CSS: YL_CSS };
  }

})();
