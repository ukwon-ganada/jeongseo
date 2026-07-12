/* 법무법인 정서 PWA - 재판기록 열람·복사 신청서 (yeollam.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. 표준 HWPX 두 종을 채워 한글파일로 다운로드.
     · 법원: templates/yeollam_court.hwpx  (재판기록 열람·복사/출력·복제 신청서)
     · 검찰: templates/yeollam_prosecution.hwpx (열람·등사 신청서 + 서약서·위임장·수수료납부서)
   흐름(참고자료·기일연기와 동일): goYeollam() → [입력폼] → [한글 다운로드] (확인창 없음)

   상단 칩으로 '법원 / 검찰' 전환.
   법원: 신청구분(열람·복사 기본)·복사방법(신청인 복사설비 기본)·사용용도·대상기록·담당사무원·국선
   검찰: 생년월일·검찰청·검사실·서류목록 + 위임장/서약서(담당사무원 이름·생년월일·날짜 연동)
   담당사무원 명단은 이름+생년월일을 기억(법원·검찰 공용).
   도장: 템플릿에 정위치로 박혀 있음 → 서고은+날인이면 유지(검찰은 1페이지 신청인에도 추가),
         아니면(끄기/다른 변호사) 제거.
   의뢰인 이름의 '(국선 …)' 주석은 서면에서 제거하고 이름만.

   의존: HWPXFill(hwpxfill.js) · JU(util.js) · FSDoc(fsdoc.js)
        · renderAttChips/addAttorney/attChipClick(index.html) · initAutofillFor(autofill.js)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TPL = { 법원: './templates/yeollam_court.hwpx', 검찰: './templates/yeollam_prosecution.hwpx' };
  var CLERKS_KEY = 'jeongseo_yeollam_clerks2';   // [{name,birth}]
  var CLERKS_SEED = [{ name: '원가을', birth: '94.11.03' }, { name: '신주연', birth: '' }, { name: '최인혜', birth: '' }, { name: '강민지', birth: '' }];
  var USE_PRESETS = [
    { key: '재판', text: '재판준비를 위하여' },
    { key: '합의', text: '합의를 위하여' },
    { key: '공탁', text: '공탁을 위하여' }
  ];
  var TARGET_DEFAULT = '증거기록, 소송기록일체, 미디어파일 일체(CD 등)';
  var REQ = ['열람', '복사', '출력', '복제'];
  var METHODS = ['법원 복사기', '변호사단체 복사기', '신청인 복사설비', '필사'];
  var BOX_ON = '☑', BOX_OFF = '□';

  function todayISO() { return JU.todayISO(); }
  function fmtKoDate(iso) { // 'YYYY년 M월 D일'
    var m = ('' + (iso || '')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + '년 ' + parseInt(m[2], 10) + '월 ' + parseInt(m[3], 10) + '일' : '';
  }
  function fmtDotDate(iso) { // 'YYYY. M. D.'
    var m = ('' + (iso || '')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + '. ' + parseInt(m[2], 10) + '. ' + parseInt(m[3], 10) + '.' : '';
  }
  function ymd(s) { var m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : ''; }
  function spaced(name) { return String(name || '').trim().split('').join(' '); }
  function clean(name) { return HWPXFill.cleanName(name); }
  function fillAttorneyName(ctx, att) {
    if (att && att !== '서고은') ctx.replace('서 고 은', spaced(att)).replace('서고은', att);
  }
  // 압축폼: 한 칸의 '사건번호 사건명' → 첫 공백 기준 분리(사건번호=첫 토큰)
  function splitCase(v) { v = String(v || '').trim(); var i = v.indexOf(' '); return i < 0 ? { casenum: v, casename: '' } : { casenum: v.slice(0, i).trim(), casename: v.slice(i + 1).trim() }; }
  // 콤마 구분 문자열 → 항목 배열(각 항목 trim, 빈 항목 제거)
  function splitDocs(v) { return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }

  /* ── 검찰 '서류 등의 표목' 표: 콤마 목록을 각 행(순번1~)에 순서대로 채움 ──
     표를 '서류 등의 표목' 헤더로 특정(같은 col1/row2 셀이 다른 표에도 있어 범위 한정 필수).
     서류 열은 colAddr="1", 데이터행 rowAddr는 2부터. 샘플 2행은 목록이 적으면 비움. */
  function setRunText(tc, text) {
    if (/<hp:run\b[^>]*\/>/.test(tc)) return tc.replace(/<hp:run\b([^>]*)\/>/, '<hp:run$1><hp:t>' + HWPXFill.esc(text) + '</hp:t></hp:run>');
    return tc.replace(/<hp:t>[\s\S]*?<\/hp:t>/, '<hp:t>' + HWPXFill.esc(text) + '</hp:t>');
  }
  function setCellByAddr(tbl, col, row, text) {
    var marker = '<hp:cellAddr colAddr="' + col + '" rowAddr="' + row + '"/>';
    var mpos = tbl.indexOf(marker); if (mpos < 0) return tbl;
    var tcStart = tbl.lastIndexOf('<hp:tc', mpos), tcEnd = tbl.indexOf('</hp:tc>', mpos) + 8;
    if (tcStart < 0 || tcEnd < 8) return tbl;
    return tbl.slice(0, tcStart) + setRunText(tbl.slice(tcStart, tcEnd), text) + tbl.slice(tcEnd);
  }
  function fillDocTable(ctx, items) {
    var s = ctx.section, hpos = s.indexOf('서류 등의 표목'); if (hpos < 0) return;
    var tstart = s.lastIndexOf('<hp:tbl', hpos), tend = s.indexOf('</hp:tbl>', hpos) + 9;
    if (tstart < 0 || tend < 9) return;
    var tbl = s.slice(tstart, tend), n = Math.max(items.length, 2); // 샘플 2행(기록일체·미디어)은 최소 비움
    for (var i = 0; i < n; i++) tbl = setCellByAddr(tbl, 1, i + 2, items[i] || '');
    ctx.section = s.slice(0, tstart) + tbl + s.slice(tend);
  }

  /* ── 담당사무원 명단(이름+생년월일) ── */
  function loadClerks() {
    try { var raw = localStorage.getItem(CLERKS_KEY); var arr = raw ? JSON.parse(raw) : null; if (arr && arr.length) return arr; } catch (e) {}
    return CLERKS_SEED.slice();
  }
  function saveClerks(list) { try { localStorage.setItem(CLERKS_KEY, JSON.stringify(list)); } catch (e) {} }
  function addClerkEntry(name, birth) {
    name = (name || '').trim(); if (!name) return;
    var list = loadClerks(), found = false;
    for (var i = 0; i < list.length; i++) { if (list[i].name === name) { if (birth) list[i].birth = birth; found = true; break; } }
    if (!found) list.push({ name: name, birth: (birth || '').trim() });
    saveClerks(list);
  }
  function clerkBirth(name) { var list = loadClerks(); for (var i = 0; i < list.length; i++) { if (list[i].name === name) return list[i].birth || ''; } return ''; }

  /* ── 담당변호사 명단(이름+주민번호) — 검찰 위임장용, 열람등사 전용 ── */
  var ATTS_KEY = 'jeongseo_yeollam_atts';   // [{name, jumin}]
  var ATTS_SEED = [{ name: '서고은', jumin: '840219-2079920' }];
  function loadAtts() {
    try { var raw = localStorage.getItem(ATTS_KEY); var arr = raw ? JSON.parse(raw) : null; if (arr && arr.length) return arr; } catch (e) {}
    return ATTS_SEED.slice();
  }
  function saveAtts(list) { try { localStorage.setItem(ATTS_KEY, JSON.stringify(list)); } catch (e) {} }
  function addAttEntry(name, jumin) {
    name = (name || '').trim(); if (!name) return;
    if (typeof window !== 'undefined' && window.LawyerStore) { window.LawyerStore.setJumin(name, jumin); return; }
    var list = loadAtts(), found = false;
    for (var i = 0; i < list.length; i++) { if (list[i].name === name) { if (jumin) list[i].jumin = jumin; found = true; break; } }
    if (!found) list.push({ name: name, jumin: (jumin || '').trim() });
    saveAtts(list);
  }
  function attJumin(name) { if (typeof window !== 'undefined' && window.LawyerStore) return window.LawyerStore.juminOf(name); var list = loadAtts(); for (var i = 0; i < list.length; i++) { if (list[i].name === name) return list[i].jumin || ''; } return ''; }
  // 표시용 명단: 중앙관리 저장소(LawyerStore) 우선, 없으면 공용 명단+로컬 합집합
  function attNames() {
    if (typeof window !== 'undefined' && window.LawyerStore) return window.LawyerStore.activeNames();
    var stored = loadAtts(), names = [];
    var firm = (typeof window !== 'undefined' && window.ALL_ATTORNEYS) ? window.ALL_ATTORNEYS : ['서고은'];
    firm.forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    stored.forEach(function (a) { if (names.indexOf(a.name) < 0) names.push(a.name); });
    return names;
  }

  /* ══════════ 법원 채우기 ══════════
     yeollam_court.hwpx 샘플: 담당변호사 서고은 / 담당사무원 신주연 /
       자격 '피고인 채윤휘빈센트 (국선 채윤휘빈센트)의 변호인' / 재판준비를 위하여 /
       사건 2026고단485 / 마약류…(향정) / 형사7단독 / 증거기록,… / 2026년 7월 12일 */
  function fillCourt(ctx, c) {
    ctx.replace('신주연', c.clerk || '')
       .replace('피고인 채윤휘빈센트 (국선 채윤휘빈센트)의', (c.jiwi || '피고인') + ' ' + (c.defendant || '') + '의')
       .replace('재판준비를 위하여', c.use || '')
       .replace('2026고단485', c.casenum || '')
       .replace('마약류관리에관한법률위반(향정)', c.casename || '')
       .replace('형사7단독', c.courtDiv || '')
       .replace('증거기록, 소송기록일체, 미디어파일 일체(CD 등)', c.target || '')
       .replace('2026년 7월 12일', c.writeKo || '');
    if (c.gukseon) ctx.replace('<hp:t>변호인</hp:t>', '<hp:t>국선변호인</hp:t>');
    // 신청구분·복사방법: 선택→☑, 미선택→□ (템플릿 기본 상태와 무관하게 강제)
    REQ.forEach(function (k) { toggleBox(ctx, k, c.req.indexOf(k) >= 0); });
    METHODS.forEach(function (k) { toggleBox(ctx, k, c.methods.indexOf(k) >= 0); });
    fillAttorneyName(ctx, c.attorney);
    if (!c.keepSeal) ctx.stripSeal();
  }
  function toggleBox(ctx, label, on) {
    if (on) ctx.replace(BOX_OFF + ' ' + label, BOX_ON + ' ' + label);
    else ctx.replace(BOX_ON + ' ' + label, BOX_OFF + ' ' + label);
  }

  /* ══════════ 검찰 채우기 ══════════
     yeollam_prosecution.hwpx 샘플: 담당변호사 서고은 / 생년월일 840219-2079920 /
       사건 2026고단485 / 피고인 채윤휘빈센트 (국선 채윤휘빈센트) / 죄명 마약류…(향정) /
       작성일 2026. 7. 12. / 검찰청 '인천지방검찰청 홍길동 검사실' /
       서류 기록일체·미디어파일일체(CD 등) /
       [서약서·위임장] <2026년 7월 11일>·<원가을>·<94.11.03>·<별지> */
  function fillProsecution(ctx, c) {
    ctx.replace('840219-2079920', c.birth || '')
       .replace('2026고단485', c.casenum || '')
       .replace('채윤휘빈센트', c.defendant || '')
       .replace('마약류관리에관한법률위반(향정)', c.casename || '')
       .replace('2026. 7. 12.', c.writeDot || '')          // 1페이지·수수료 날짜
       .replace('2026년 7월 12일', c.writeKo || '')          // 서약서·위임장 날짜
       .replace('원가을', c.clerk || '')                     // 담당사무원(서약서·위임장)
       .replace('94.11.03', c.clerkBirth || '');            // 사무원 생년월일
    // 신청 서류: 콤마 목록을 '서류 등의 표목' 표 각 행에 순서대로
    fillDocTable(ctx, c.docs || []);
    // 검찰청(검사 이름 없이 검찰청만) — 4개 서식의 '인천지방검찰청'을 모두 치환
    ctx.replace('인천지방검찰청', c.prosOffice || '인천지방검찰청');
    fillAttorneyName(ctx, c.attorney);
    // 서고은 직인(image1): 템플릿에 정위치로 박혀 있음 → 유지 or 제거(막도장은 build 에서 image2 로 추가)
    if (!c.keepSeal) ctx.stripSeal();
  }

  /* ══════════ 상태 ══════════ */
  var state = null;
  function defaultState() {
    return {
      type: '법원', jiwi: '피고인', defendant: '', casenum: '', casename: '',
      courtDiv: '', clerk: CLERKS_SEED[0].name, use: USE_PRESETS[0].text, target: TARGET_DEFAULT,
      req: ['열람', '복사'], methods: ['신청인 복사설비'], gukseon: false,
      prosOffice: '인천지방검찰청',
      docs: '기록일체, 미디어파일일체(CD 등)',
      attorney: '서고은', writeDate: todayISO(), stamp: true
    };
  }
  function toCfg(s) {
    var att = s.attorney || '서고은';
    return {
      type: s.type, jiwi: s.jiwi, defendant: clean(s.defendant), casenum: s.casenum, casename: s.casename,
      courtDiv: s.courtDiv, clerk: s.clerk, clerkBirth: clerkBirth(s.clerk), use: s.use, target: s.target,
      req: s.req.slice(), methods: s.methods.slice(), gukseon: !!s.gukseon,
      birth: attJumin(att), prosOffice: s.prosOffice || '인천지방검찰청',
      docs: splitDocs(s.docs),
      writeKo: fmtKoDate(s.writeDate) || fmtKoDate(todayISO()),
      writeDot: fmtDotDate(s.writeDate) || fmtDotDate(todayISO()),
      attorney: att, stamp: !!s.stamp, keepSeal: !!s.stamp && att === '서고은'
    };
  }
  function downloadName(s) {
    return HWPXFill.safeName([s.type + '열람복사', clean(s.defendant), s.casenum, ymd(s.writeDate)]);
  }

  /* ══════════ CSS ══════════ */
  var STYLE_ID = 'yeollam-style';
  var YL_CSS =
    '#yeollamForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#yeollamForm.active{display:flex;}' +
    '#yeollamForm .yl-pick{display:flex;align-items:center;gap:10px;margin:0 0 9px;}' +
    '#yeollamForm .yl-pick-l{flex:none;min-width:64px;font-size:13px;color:var(--gray-700,#555);}' +
    '#yeollamForm .yl-pick .fs-chips{flex:1;gap:6px;}' +
    '#yeollamForm .fs-chips .fs-chip{padding:6px 13px;font-size:13px;cursor:pointer;}' +
    '#yeollamForm textarea.fs-input{min-height:64px;resize:vertical;line-height:1.5;}' +
    '#yeollamForm .yl-checks{display:flex;flex-wrap:wrap;gap:6px;}' +
    '#yeollamForm .yl-clerk-add{display:flex;gap:6px;margin-top:6px;}' +
    '#yeollamForm .yl-clerk-add input{flex:1;min-width:0;}' +
    '#yeollamForm .yl-prosecution{display:none;}' +
    '#yeollamForm.is-prosecution .yl-court{display:none;}' +
    '#yeollamForm.is-prosecution .yl-prosecution{display:block;}';
  function injectStyle() { FSDoc.injectOnce(STYLE_ID, YL_CSS); }

  /* ══════════ 화면(입력폼) ══════════ */
  var SHELL_ID = 'yeollam-shell';
  function chip(group, v, on) { return '<span class="fs-chip' + (on ? ' on' : '') + '" data-v="' + v + '" onclick="ylChip(\'' + group + '\',\'' + v + '\',this)">' + v + '</span>'; }
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var useChips = USE_PRESETS.map(function (p, i) { return '<span class="fs-chip' + (i === 0 ? ' on' : '') + '" data-v="' + p.text + '" onclick="ylUse(this)">' + p.key + '</span>'; }).join('');
    var reqChips = REQ.map(function (k) { return '<span class="fs-chip' + (k === '열람' || k === '복사' ? ' on' : '') + '" data-v="' + k + '" onclick="ylMulti(this)">' + k + '</span>'; }).join('');
    var methodChips = METHODS.map(function (k) { return '<span class="fs-chip' + (k === '신청인 복사설비' ? ' on' : '') + '" data-v="' + k + '" onclick="ylMulti(this)">' + k + '</span>'; }).join('');
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="yeollamForm">' +
        '<div class="fs-card">' +
          '<div class="fs-head">' +
            '<button class="fs-close" onclick="closeYeollamForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '<div class="fs-title">열람·복사 신청서</div>' +
          '</div>' +
          '<div class="fs-body">' +
            '<div class="yl-pick"><span class="yl-pick-l">제출처</span><div class="fs-chips" id="yl-type">' +
              '<span class="fs-chip on" data-v="법원" onclick="ylType(\'법원\')">법원</span>' +
              '<span class="fs-chip" data-v="검찰" onclick="ylType(\'검찰\')">검찰</span></div></div>' +

            '<div class="fs-section">사건 정보</div>' +
            '<div class="yl-pick"><span class="yl-pick-l">지위</span><div class="fs-chips" id="yl-jiwi">' +
              chip('jiwi', '피고인', true) + chip('jiwi', '피의자', false) + '</div></div>' +
            '<div class="fs-field"><label class="fs-label">의뢰인 성명 <span class="fs-hint">(국선 표기는 자동 제거)</span></label><input type="text" class="fs-input" id="yl-defendant" data-af="l_client" placeholder="홍길동"></div>' +
            '<div class="fs-field"><label class="fs-label">사건번호 · 사건명 <span class="fs-hint">(사건번호 한 칸 띄우고 사건명)</span></label><input type="text" class="fs-input" id="yl-case" placeholder="2026고단1234 마약류관리에관한법률위반(향정)"></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">재판부 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="text" class="fs-input" id="yl-courtdiv" placeholder="형사1단독"></div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">검찰청</label><input type="text" class="fs-input" id="yl-prosoffice" placeholder="인천지방검찰청"></div>' +

            '<div class="fs-section yl-court">신청 내용 (법원)</div>' +
            '<div class="yl-pick yl-court"><span class="yl-pick-l">사용용도</span><div class="fs-chips" id="yl-use">' + useChips + '</div></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">신청구분 <span class="fs-hint">(기본 열람·복사)</span></label><div class="fs-chips yl-checks" id="yl-req">' + reqChips + '</div></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">복사/출력 방법 <span class="fs-hint">(기본 신청인 복사설비)</span></label><div class="fs-chips yl-checks" id="yl-methods">' + methodChips + '</div></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">복사/출력·복제할 부분</label><textarea class="fs-input" id="yl-target">' + TARGET_DEFAULT + '</textarea></div>' +

            '<div class="fs-section yl-prosecution">신청 서류 (검찰)</div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">서류 목록 <span class="fs-hint">(콤마로 구분, 순서대로 표 각 칸에 채움)</span></label><input type="text" class="fs-input" id="yl-docs" placeholder="기록일체, 미디어파일일체(CD 등)"></div>' +

            '<div class="fs-section">담당사무원 <span class="fs-hint">(검찰 위임장·서약서에 이름·생년월일 사용)</span></div>' +
            '<div class="fs-field"><label class="fs-label">사무원 선택</label>' +
              '<div class="fs-chips att-chips" id="yl-clerk-chips" onclick="ylClerkClick(event)"></div>' +
              '<div class="yl-clerk-add"><input type="text" class="att-add-input" id="yl-clerk-new" placeholder="사무원 이름"><input type="text" class="att-add-input" id="yl-clerk-birth" placeholder="생년월일 예:94.11.03"><button type="button" class="att-add-btn" onclick="ylAddClerk()">＋ 추가</button></div>' +
              '<div class="fs-hint" id="yl-clerk-info" style="margin-top:4px"></div></div>' +

            '<div class="fs-section">서명 · 날인</div>' +
            '<div class="fs-field yl-court"><label class="fs-label"><input type="checkbox" id="yl-gukseon"> 국선사건 <span class="fs-hint">(자격을 "국선변호인"으로)</span></label></div>' +
            '<div class="fs-field"><label class="fs-label">담당변호사 <span class="fs-hint">(검찰 위임장에 주민번호 사용)</span></label>' +
              '<div class="fs-chips att-chips" id="yl-att" onclick="ylAttClick(event)"></div>' +
              '<div class="fs-hint" id="yl-att-info" style="margin-top:4px"></div></div>' +
            '<div class="fs-field"><label class="fs-label">작성일 (오늘 자동)</label><input type="date" class="fs-input" id="yl-writedate"></div>' +
            '<div class="fs-field"><label class="fs-label"><input type="checkbox" id="yl-stamp"> 서고은 도장 날인 <span class="fs-hint">(담당변호사가 서고은일 때)</span></label></div>' +
          '</div>' +
          '<div class="fs-foot">' +
            '<button class="fs-btn ghost" onclick="closeYeollamForm()">취소</button>' +
            '<button class="fs-btn primary" onclick="ylDownload()">한글 다운로드</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  /* ══════════ DOM 유틸 ══════════ */
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function getRaw(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  // 칩 박스에서 현재 선택(on)된 값
  function ylSelChip(boxId) { var el = document.querySelector('#' + boxId + ' .fs-chip.on'); return el ? el.getAttribute('data-v') : ''; }
  function chipHTML(name, on) { return '<div class="fs-chip att-chip' + (on ? ' on' : '') + '" data-v="' + JU.esc(name) + '">' + JU.esc(name) + '</div>'; }
  // ── 사무원 칩(단일 선택) ──
  function fillClerkChips(sel) {
    var box = document.getElementById('yl-clerk-chips'); if (!box) return;
    box.innerHTML = loadClerks().map(function (c) { return chipHTML(c.name, c.name === sel); }).join('');
    ylClerkInfo();
  }
  function ylClerkInfo() {
    var name = ylSelChip('yl-clerk-chips'), b = clerkBirth(name), info = document.getElementById('yl-clerk-info');
    if (info) info.textContent = name ? (b ? (name + ' · 생년월일 ' + b) : (name + ' · 생년월일 미등록(추가에서 등록)')) : '사무원을 선택하세요';
  }
  window.ylClerkClick = function (e) {
    var c = e.target.closest('.fs-chip'); if (!c) return;
    document.querySelectorAll('#yl-clerk-chips .fs-chip').forEach(function (x) { x.classList.toggle('on', x === c); });
    if (state) state.clerk = c.getAttribute('data-v');
    ylClerkInfo();
  };
  // ── 담당변호사 칩(단일 선택 + 주민번호) ──
  function fillAttChips(sel) {
    var box = document.getElementById('yl-att'); if (!box) return;
    box.innerHTML = attNames().map(function (n) { return chipHTML(n, n === sel); }).join('');
    ylAttInfo();
  }
  function ylAttInfo() {
    var name = ylSelChip('yl-att'), j = attJumin(name), info = document.getElementById('yl-att-info');
    if (info) info.textContent = name ? (j ? (name + ' · 주민번호 ' + j) : (name + ' · 주민번호 미등록(추가에서 등록)')) : '담당변호사를 선택하세요';
  }
  window.ylAttClick = function (e) {
    var c = e.target.closest('.fs-chip'); if (!c) return;
    document.querySelectorAll('#yl-att .fs-chip').forEach(function (x) { x.classList.toggle('on', x === c); });
    if (state) state.attorney = c.getAttribute('data-v');
    ylAttInfo();
  };

  window.ylType = function (v) {
    state.type = v;
    var g = document.getElementById('yl-type');
    if (g) g.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
    var f = document.getElementById('yeollamForm'); if (f) f.classList.toggle('is-prosecution', v === '검찰');
    var t = document.querySelector('#yeollamForm .fs-title'); if (t) t.textContent = v === '검찰' ? '열람·등사 신청서 (검찰)' : '열람·복사 신청서 (법원)';
  };
  window.ylChip = function (group, v, el) {
    state[group] = v;
    el.parentNode.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b === el); });
  };
  window.ylUse = function (el) {
    state.use = el.getAttribute('data-v');
    el.parentNode.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b === el); });
  };
  window.ylMulti = function (el) { el.classList.toggle('on'); };
  window.ylAddClerk = function () {
    var name = getVal('yl-clerk-new'), birth = getVal('yl-clerk-birth');
    if (!name) return; addClerkEntry(name, birth); fillClerkChips(name);
    if (state) state.clerk = name;
    setVal('yl-clerk-new', ''); setVal('yl-clerk-birth', '');
  };
  window.ylAddAtt = function () {
    var name = getVal('yl-att-new'), jumin = getVal('yl-att-jumin');
    if (!name) return; addAttEntry(name, jumin); fillAttChips(name);
    if (state) state.attorney = name;
    setVal('yl-att-new', ''); setVal('yl-att-jumin', '');
  };

  function fillFormFromState() {
    setVal('yl-defendant', state.defendant);
    setVal('yl-case', [state.casenum, state.casename].filter(Boolean).join(' '));
    setVal('yl-courtdiv', state.courtDiv);
    setVal('yl-prosoffice', state.prosOffice);
    setVal('yl-target', state.target);
    setVal('yl-docs', state.docs);
    setVal('yl-writedate', state.writeDate || todayISO());
    setVal('yl-clerk-new', ''); setVal('yl-clerk-birth', ''); setVal('yl-att-new', ''); setVal('yl-att-jumin', '');
    fillClerkChips(state.clerk);
    fillAttChips(state.attorney || '서고은');
    document.querySelectorAll('#yl-jiwi [data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === state.jiwi); });
    document.querySelectorAll('#yl-use [data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === state.use); });
    document.querySelectorAll('#yl-req [data-v]').forEach(function (b) { b.classList.toggle('on', state.req.indexOf(b.getAttribute('data-v')) >= 0); });
    document.querySelectorAll('#yl-methods [data-v]').forEach(function (b) { b.classList.toggle('on', state.methods.indexOf(b.getAttribute('data-v')) >= 0); });
    var gk = document.getElementById('yl-gukseon'); if (gk) gk.checked = !!state.gukseon;
    var st = document.getElementById('yl-stamp'); if (st) st.checked = !!state.stamp;
    window.ylType(state.type);
  }
  function collectChips(sel) { var out = []; document.querySelectorAll(sel + ' .fs-chip.on').forEach(function (c) { out.push(c.getAttribute('data-v')); }); return out; }
  function pickOn(sel, fallback) { var el = document.querySelector(sel + ' .fs-chip.on'); return el ? el.getAttribute('data-v') : fallback; }
  function collect() {
    state.jiwi = pickOn('#yl-jiwi', state.jiwi);
    state.defendant = getVal('yl-defendant');
    var _cs = splitCase(getVal('yl-case')); state.casenum = _cs.casenum; state.casename = _cs.casename;
    state.courtDiv = getVal('yl-courtdiv');
    state.prosOffice = getVal('yl-prosoffice') || '인천지방검찰청';
    state.target = getRaw('yl-target').trim();
    state.docs = getVal('yl-docs');
    state.use = pickOn('#yl-use', state.use);
    state.req = collectChips('#yl-req'); state.methods = collectChips('#yl-methods');
    state.clerk = ylSelChip('yl-clerk-chips') || state.clerk || CLERKS_SEED[0].name;
    state.writeDate = getVal('yl-writedate') || todayISO();
    state.attorney = ylSelChip('yl-att') || state.attorney || '서고은';
    var gk = document.getElementById('yl-gukseon'); state.gukseon = !!(gk && gk.checked);
    var st = document.getElementById('yl-stamp'); state.stamp = !!(st && st.checked);
  }

  /* ══════════ 진입점 ══════════ */
  function ensureUI() { injectStyle(); injectShell(); }
  window.goYeollam = function () {
    ensureUI(); state = defaultState(); fillFormFromState();
    document.getElementById('yeollamForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('yl-case', { caseCombine: 'yl-case', courtDept: 'yl-courtdiv' });
  };
  window.closeYeollamForm = function () { var f = document.getElementById('yeollamForm'); if (f) f.classList.remove('active'); };

  window.ylDownload = function () {
    if (!state) state = defaultState();
    collect();
    var cfg = toCfg(state);
    if (!cfg.casenum && !cfg.defendant) { alert('사건번호 또는 피고인을 먼저 입력해주세요.'); return; }
    var opts = { url: TPL[cfg.type], fill: function (ctx) { (cfg.type === '검찰' ? fillProsecution : fillCourt)(ctx, cfg); } };
    // 검찰 + 도장 날인이면 사무원 막도장(이름 도장) 생성 → 서약서 사무원 서명란에 겹침
    // 위치: 사무원 '주민등록번호(생년월일)' 문단에 앵커, 오른쪽정렬 오프셋(가로 32535·세로 2535)
    if (cfg.type === '검찰' && cfg.stamp && cfg.clerk && cfg.clerkBirth && typeof window.makeOvalSeal === 'function') {
      var dataUrl = window.makeOvalSeal(cfg.clerk);
      if (dataUrl) opts.nameSeal = { dataUrl: dataUrl, anchor: '주민등록번호(생년월일) : ' + cfg.clerkBirth, off: { h: 32535, v: 2535 } };
    }
    HWPXFill.build(opts).then(function (blob) {
      HWPXFill.saveBlob(blob, downloadName(state));
    }).catch(function (e) { alert('HWPX 생성 실패: ' + e.message); });
  };

  /* node 검증용 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fillCourt: fillCourt, fillProsecution: fillProsecution, toCfg: toCfg, downloadName: downloadName };
  }
})();
