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
       .replace('기록일체', c.doc1 || '')
       .replace('미디어파일일체(CD 등)', c.doc2 || '')
       .replace('원가을', c.clerk || '')                     // 담당사무원(서약서·위임장)
       .replace('94.11.03', c.clerkBirth || '');            // 사무원 생년월일
    // 검찰청·검사실
    if (c.prosecutor) ctx.replace('인천지방검찰청  검사실', (c.prosOffice || '') + ' ' + c.prosecutor + ' 검사실');
    else ctx.replace('인천지방검찰청', c.prosOffice || '');
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
      birth: '840219-2079920', prosOffice: '인천지방검찰청', prosecutor: '',
      doc1: '기록일체', doc2: '미디어파일일체(CD 등)',
      attorneys: ['서고은'], writeDate: todayISO(), stamp: true
    };
  }
  function toCfg(s) {
    var att = (s.attorneys && s.attorneys.length) ? s.attorneys[0] : '서고은';
    return {
      type: s.type, jiwi: s.jiwi, defendant: clean(s.defendant), casenum: s.casenum, casename: s.casename,
      courtDiv: s.courtDiv, clerk: s.clerk, clerkBirth: clerkBirth(s.clerk), use: s.use, target: s.target,
      req: s.req.slice(), methods: s.methods.slice(), gukseon: !!s.gukseon,
      birth: s.birth, prosOffice: s.prosOffice || '인천지방검찰청', prosecutor: s.prosecutor || '',
      doc1: s.doc1 || '기록일체', doc2: s.doc2,
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
            '<div class="fs-field"><label class="fs-label">사건번호</label><input type="text" class="fs-input" id="yl-casenum" data-af="l_code" placeholder="2026고단1234"></div>' +
            '<div class="fs-field"><label class="fs-label">사건명 · 죄명</label><input type="text" class="fs-input" id="yl-casename" data-af="l_name" placeholder="사기"></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">재판부 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="text" class="fs-input" id="yl-courtdiv" placeholder="형사1단독"></div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">검찰청</label><input type="text" class="fs-input" id="yl-prosoffice" placeholder="인천지방검찰청"></div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">검사 <span class="fs-hint">(검사실, 예: 홍길동)</span></label><input type="text" class="fs-input" id="yl-prosecutor" placeholder="담당검사 이름"></div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">담당변호사 생년월일 <span class="fs-hint">(신청인 변호사)</span></label><input type="text" class="fs-input" id="yl-birth" placeholder="840219-2079920"></div>' +

            '<div class="fs-section yl-court">신청 내용 (법원)</div>' +
            '<div class="yl-pick yl-court"><span class="yl-pick-l">사용용도</span><div class="fs-chips" id="yl-use">' + useChips + '</div></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">신청구분 <span class="fs-hint">(기본 열람·복사)</span></label><div class="fs-chips yl-checks" id="yl-req">' + reqChips + '</div></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">복사/출력 방법 <span class="fs-hint">(기본 신청인 복사설비)</span></label><div class="fs-chips yl-checks" id="yl-methods">' + methodChips + '</div></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">복사/출력·복제할 부분</label><textarea class="fs-input" id="yl-target">' + TARGET_DEFAULT + '</textarea></div>' +

            '<div class="fs-section yl-prosecution">신청 서류 (검찰)</div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">서류 1</label><input type="text" class="fs-input" id="yl-doc1" placeholder="기록일체"></div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">서류 2</label><input type="text" class="fs-input" id="yl-doc2" placeholder="미디어파일일체(CD 등)"></div>' +

            '<div class="fs-section">담당사무원 <span class="fs-hint">(검찰 위임장·서약서에 이름·생년월일 사용)</span></div>' +
            '<div class="fs-field"><label class="fs-label">사무원 선택</label>' +
              '<select class="fs-input" id="yl-clerk" onchange="ylClerkPick()"></select>' +
              '<div class="yl-clerk-add"><input type="text" class="att-add-input" id="yl-clerk-new" placeholder="사무원 이름"><input type="text" class="att-add-input" id="yl-clerk-birth" placeholder="생년월일 예:94.11.03"><button type="button" class="att-add-btn" onclick="ylAddClerk()">＋ 추가</button></div>' +
              '<div class="fs-hint" id="yl-clerk-info" style="margin-top:4px"></div></div>' +

            '<div class="fs-section">서명 · 날인</div>' +
            '<div class="fs-field yl-court"><label class="fs-label"><input type="checkbox" id="yl-gukseon"> 국선사건 <span class="fs-hint">(자격을 "국선변호인"으로)</span></label></div>' +
            '<div class="fs-field"><label class="fs-label">담당변호사</label>' +
              '<div class="fs-chips att-chips" id="yl-att" onclick="attChipClick(event,\'yl\')"></div>' +
              '<div class="att-add-row"><input type="text" class="att-add-input" id="yl-att-new" placeholder="추가할 변호사 이름"><button type="button" class="att-add-btn" onclick="addAttorney(\'yl\')">＋ 추가</button></div></div>' +
            '<div class="fs-field"><label class="fs-label">작성일 (오늘 자동)</label><input type="date" class="fs-input" id="yl-writedate"></div>' +
            '<div class="fs-field"><label class="fs-label"><input type="checkbox" id="yl-stamp"> 서고은 도장 날인 <span class="fs-hint">(담당변호사 첫 번째가 서고은일 때)</span></label></div>' +
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
  function fillClerkSelect(sel) {
    var el = document.getElementById('yl-clerk'); if (!el) return;
    el.innerHTML = loadClerks().map(function (c) { return '<option value="' + JU.esc(c.name) + '"' + (c.name === sel ? ' selected' : '') + '>' + JU.esc(c.name) + '</option>'; }).join('');
    ylClerkInfo();
  }
  function ylClerkInfo() {
    var name = getVal('yl-clerk'), b = clerkBirth(name), info = document.getElementById('yl-clerk-info');
    if (info) info.textContent = b ? (name + ' · 생년월일 ' + b) : (name + ' · 생년월일 미등록(추가에서 등록)');
  }
  window.ylClerkPick = function () { if (state) state.clerk = getVal('yl-clerk'); ylClerkInfo(); };

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
    if (!name) return; addClerkEntry(name, birth); fillClerkSelect(name);
    setVal('yl-clerk-new', ''); setVal('yl-clerk-birth', '');
  };

  function fillFormFromState() {
    setVal('yl-defendant', state.defendant); setVal('yl-casenum', state.casenum);
    setVal('yl-casename', state.casename); setVal('yl-courtdiv', state.courtDiv);
    setVal('yl-prosoffice', state.prosOffice); setVal('yl-prosecutor', state.prosecutor);
    setVal('yl-birth', state.birth); setVal('yl-target', state.target);
    setVal('yl-doc1', state.doc1); setVal('yl-doc2', state.doc2);
    setVal('yl-writedate', state.writeDate || todayISO());
    setVal('yl-clerk-new', ''); setVal('yl-clerk-birth', ''); setVal('yl-att-new', '');
    fillClerkSelect(state.clerk);
    document.querySelectorAll('#yl-jiwi [data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === state.jiwi); });
    document.querySelectorAll('#yl-use [data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === state.use); });
    document.querySelectorAll('#yl-req [data-v]').forEach(function (b) { b.classList.toggle('on', state.req.indexOf(b.getAttribute('data-v')) >= 0); });
    document.querySelectorAll('#yl-methods [data-v]').forEach(function (b) { b.classList.toggle('on', state.methods.indexOf(b.getAttribute('data-v')) >= 0); });
    var gk = document.getElementById('yl-gukseon'); if (gk) gk.checked = !!state.gukseon;
    var st = document.getElementById('yl-stamp'); if (st) st.checked = !!state.stamp;
    if (typeof renderAttChips === 'function') renderAttChips('yl', (state.attorneys && state.attorneys.length) ? state.attorneys : ['서고은']);
    window.ylType(state.type);
  }
  function collectChips(sel) { var out = []; document.querySelectorAll(sel + ' .fs-chip.on').forEach(function (c) { out.push(c.getAttribute('data-v')); }); return out; }
  function pickOn(sel, fallback) { var el = document.querySelector(sel + ' .fs-chip.on'); return el ? el.getAttribute('data-v') : fallback; }
  function collect() {
    state.jiwi = pickOn('#yl-jiwi', state.jiwi);
    state.defendant = getVal('yl-defendant'); state.casenum = getVal('yl-casenum');
    state.casename = getVal('yl-casename'); state.courtDiv = getVal('yl-courtdiv');
    state.prosOffice = getVal('yl-prosoffice') || '인천지방검찰청'; state.prosecutor = getVal('yl-prosecutor');
    state.birth = getVal('yl-birth'); state.target = getRaw('yl-target').trim();
    state.doc1 = getVal('yl-doc1') || '기록일체'; state.doc2 = getVal('yl-doc2');
    state.use = pickOn('#yl-use', state.use);
    state.req = collectChips('#yl-req'); state.methods = collectChips('#yl-methods');
    state.clerk = getVal('yl-clerk') || CLERKS_SEED[0].name;
    state.writeDate = getVal('yl-writedate') || todayISO();
    var atts = []; document.querySelectorAll('#yl-att .fs-chip.on').forEach(function (c) { atts.push(c.dataset.att); });
    state.attorneys = atts.length ? atts : ['서고은'];
    var gk = document.getElementById('yl-gukseon'); state.gukseon = !!(gk && gk.checked);
    var st = document.getElementById('yl-stamp'); state.stamp = !!(st && st.checked);
  }

  /* ══════════ 진입점 ══════════ */
  function ensureUI() { injectStyle(); injectShell(); }
  window.goYeollam = function () {
    ensureUI(); state = defaultState(); fillFormFromState();
    document.getElementById('yeollamForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('yl-casenum', { courtDept: 'yl-courtdiv' });
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
