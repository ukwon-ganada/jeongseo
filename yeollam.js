/* 법무법인 정서 PWA - 재판기록 열람·복사 신청서 (yeollam.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. 표준 HWPX 두 종을 채워 한글파일로 다운로드.
     · 법원: templates/yeollam_court.hwpx  (재판기록 열람·복사/출력·복제 신청서)
     · 검찰: templates/yeollam_prosecution.hwpx (열람·등사 신청서, 형소법 §266의3)
   흐름(참고자료·기일연기와 동일): goYeollam() → [입력폼] → [한글 다운로드] (확인창 없음)

   상단 칩으로 '법원 / 검찰' 전환(템플릿·표시 필드 전환).
   법원: 신청구분(열람·복사 기본 체크) · 복사방법(신청인 복사설비 기본) ·
         사용용도(재판/합의/공탁) · 대상기록(편집) · 담당사무원(기억) · 국선(자격 '국선변호인')
   검찰: 생년월일 · 병행사건번호 · 검찰청 · 서류목록(2건)
   도장(체크): 담당변호사 첫 번째가 '서고은'일 때 신청인 서명란 이름 위에 직인 겹침

   의존: HWPXFill(hwpxfill.js) · JU(util.js) · FSDoc(fsdoc.js)
        · renderAttChips/addAttorney/attChipClick(index.html) · initAutofillFor(autofill.js)
        · window.SEAL_SEOGOEUN(전역 도장, 선택)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TPL = { 법원: './templates/yeollam_court.hwpx', 검찰: './templates/yeollam_prosecution.hwpx' };
  var CLERKS_KEY = 'jeongseo_yeollam_clerks';
  var CLERKS_SEED = ['원가을', '신주연', '최인혜', '강민지'];
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
  function fmtKoDate(iso) { // 'YYYY년 M월 D일' (법원)
    var m = ('' + (iso || '')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + '년 ' + parseInt(m[2], 10) + '월 ' + parseInt(m[3], 10) + '일' : '';
  }
  function fmtKDate(iso) { // 'YYYY. M. D.' (검찰)
    var m = ('' + (iso || '')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + '. ' + parseInt(m[2], 10) + '. ' + parseInt(m[3], 10) + '.' : '';
  }
  function ymd(s) { var m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : ''; }
  function spaced(name) { return String(name || '').trim().split('').join(' '); }
  function loadClerks() { return FSDoc.roster(CLERKS_KEY, CLERKS_SEED).load(); }
  function saveClerk(n) { FSDoc.roster(CLERKS_KEY, CLERKS_SEED).save(n); }
  // 담당변호사 이름 치환(공백형 '서 고 은' + 일반형 '서고은' 모두)
  function fillAttorneyName(ctx, att) {
    if (att && att !== '서고은') ctx.replace('서 고 은', spaced(att)).replace('서고은', att);
  }

  /* ══════════ 법원 채우기 ══════════
     yeollam_court.hwpx 샘플: 담당변호사 서고은 / 원가을 / 피고인 김용철의 / 변호인 /
       재판준비를 위해 / 2026노1246 / 마약류관리에관한법률위반(향정) / 제1-1형사부 /
       증거기록,… / 2026년 7월 11일 / 신청인·영수인 서 고 은 / □ 신청구분·복사방법 */
  function fillCourt(ctx, c) {
    ctx.replace('원가을', c.clerk || '')
       .replace('피고인 김용철의', (c.jiwi || '피고인') + ' ' + (c.defendant || '') + '의')
       .replace('재판준비를 위해', c.use || '')
       .replace('2026노1246', c.casenum || '')
       .replace('마약류관리에관한법률위반(향정)', c.casename || '')
       .replace('제1-1형사부', c.courtDiv || '')
       .replace('증거기록, 소송기록일체, 미디어파일 일체(CD 등)', c.target || '')
       .replace('2026년 7월 11일', c.writeDate || '');
    // 자격의 '변호인' 셀(단독 문단) → 국선 시 '국선변호인'
    if (c.gukseon) ctx.replace('<hp:t>변호인</hp:t>', '<hp:t>국선변호인</hp:t>');
    // 신청구분 체크(기본 열람·복사)
    REQ.forEach(function (k) { if (c.req.indexOf(k) >= 0) ctx.replace(BOX_OFF + ' ' + k, BOX_ON + ' ' + k); });
    // 복사방법 체크(기본 신청인 복사설비)
    METHODS.forEach(function (k) { if (c.methods.indexOf(k) >= 0) ctx.replace(BOX_OFF + ' ' + k, BOX_ON + ' ' + k); });
    fillAttorneyName(ctx, c.attorney);
  }

  /* ══════════ 검찰 채우기 ══════════
     yeollam_prosecution.hwpx 샘플: 담당 변호사 서고은 / 생년월일 840219-2079920 /
       2026형제36763 / (2026고단101838) / 피고인 김병주 / 죄명 …(향정) /
       2026. 7. 11. / 신청인 변호사 서 고 은 / 인천지방검찰청 / 기록일체 · 미디어파일일체(cd등) */
  function fillProsecution(ctx, c) {
    ctx.replace('840219-2079920', c.birth || '')
       .replace('2026형제36763', c.casenum || '')
       .replace('김병주', c.defendant || '')
       .replace('마약류관리에관한법률위반(향정)', c.casename || '')
       .replace('2026. 7. 11.', c.writeDate || '')
       .replace('인천지방검찰청', c.prosOffice || '')
       .replace('기록일체', c.doc1 || '')
       .replace('미디어파일일체(cd등)', c.doc2 || '');
    // 병행 사건번호: 있으면 교체, 없으면 괄호째 제거
    ctx.replace('(2026고단101838)', c.parallel ? '(' + c.parallel + ')' : '');
    fillAttorneyName(ctx, c.attorney);
  }

  /* ══════════ 상태 ══════════ */
  var state = null;
  function defaultState() {
    return {
      type: '법원', jiwi: '피고인', defendant: '', casenum: '', casename: '',
      courtDiv: '', clerk: CLERKS_SEED[0], use: USE_PRESETS[0].text, target: TARGET_DEFAULT,
      req: ['열람', '복사'], methods: ['신청인 복사설비'], gukseon: false,
      birth: '840219-2079920', parallel: '', prosOffice: '인천지방검찰청',
      doc1: '기록일체', doc2: '미디어파일일체(CD 등)',
      attorneys: ['서고은'], writeDate: todayISO(), stamp: true
    };
  }
  function toCfg(s) {
    var att = (s.attorneys && s.attorneys.length) ? s.attorneys[0] : '서고은';
    return {
      type: s.type, jiwi: s.jiwi, defendant: s.defendant, casenum: s.casenum, casename: s.casename,
      courtDiv: s.courtDiv, clerk: s.clerk, use: s.use, target: s.target,
      req: s.req.slice(), methods: s.methods.slice(), gukseon: !!s.gukseon,
      birth: s.birth, parallel: s.parallel, prosOffice: s.prosOffice, doc1: s.doc1, doc2: s.doc2,
      writeDate: s.type === '검찰' ? (fmtKDate(s.writeDate) || fmtKDate(todayISO())) : (fmtKoDate(s.writeDate) || fmtKoDate(todayISO())),
      attorney: att, stamp: !!s.stamp
    };
  }
  function downloadName(s) {
    return HWPXFill.safeName([s.type + '열람복사', s.defendant, s.casenum, ymd(s.writeDate)]);
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
            '<div class="fs-field"><label class="fs-label">피고인</label><input type="text" class="fs-input" id="yl-defendant" data-af="l_client" placeholder="홍길동"></div>' +
            '<div class="fs-field"><label class="fs-label">사건번호</label><input type="text" class="fs-input" id="yl-casenum" data-af="l_code" placeholder="2026노1234 / 2026형제12345"></div>' +
            '<div class="fs-field"><label class="fs-label">사건명 · 죄명</label><input type="text" class="fs-input" id="yl-casename" data-af="l_name" placeholder="사기"></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">재판부 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="text" class="fs-input" id="yl-courtdiv" placeholder="제1형사부"></div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">병행 사건번호 <span class="fs-hint">(선택)</span></label><input type="text" class="fs-input" id="yl-parallel" placeholder="2026고단12345"></div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">검찰청</label><input type="text" class="fs-input" id="yl-prosoffice" placeholder="인천지방검찰청"></div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">담당변호사 생년월일 <span class="fs-hint">(신청인 변호사 기준)</span></label><input type="text" class="fs-input" id="yl-birth" placeholder="840219-2079920"></div>' +

            '<div class="fs-section yl-court">신청 내용 (법원)</div>' +
            '<div class="yl-pick yl-court"><span class="yl-pick-l">사용용도</span><div class="fs-chips" id="yl-use">' + useChips + '</div></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">신청구분 <span class="fs-hint">(기본 열람·복사)</span></label><div class="fs-chips yl-checks" id="yl-req">' + reqChips + '</div></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">복사/출력 방법 <span class="fs-hint">(기본 신청인 복사설비)</span></label><div class="fs-chips yl-checks" id="yl-methods">' + methodChips + '</div></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">복사/출력·복제할 부분</label><textarea class="fs-input" id="yl-target">' + TARGET_DEFAULT + '</textarea></div>' +
            '<div class="fs-field yl-court"><label class="fs-label">담당사무원</label>' +
              '<select class="fs-input" id="yl-clerk"></select>' +
              '<div class="att-add-row"><input type="text" class="att-add-input" id="yl-clerk-new" placeholder="추가할 사무원 이름"><button type="button" class="att-add-btn" onclick="ylAddClerk()">＋ 추가</button></div></div>' +

            '<div class="fs-section yl-prosecution">신청 서류 (검찰)</div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">서류 1</label><input type="text" class="fs-input" id="yl-doc1" placeholder="기록일체"></div>' +
            '<div class="fs-field yl-prosecution"><label class="fs-label">서류 2</label><input type="text" class="fs-input" id="yl-doc2" placeholder="미디어파일일체(CD 등)"></div>' +

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
    el.innerHTML = loadClerks().map(function (n) { return '<option value="' + JU.esc(n) + '"' + (n === sel ? ' selected' : '') + '>' + JU.esc(n) + '</option>'; }).join('');
  }

  window.ylType = function (v) {
    state.type = v;
    var g = document.getElementById('yl-type');
    if (g) g.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
    var f = document.getElementById('yeollamForm'); if (f) f.classList.toggle('is-prosecution', v === '검찰');
    var t = document.querySelector('#yeollamForm .fs-title'); if (t) t.textContent = v === '검찰' ? '열람·등사 신청서 (검찰)' : '열람·복사 신청서 (법원)';
  };
  window.ylChip = function (group, v, el) {
    state[group] = v;
    var box = el.parentNode; box.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b === el); });
  };
  window.ylUse = function (el) {
    state.use = el.getAttribute('data-v');
    el.parentNode.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b === el); });
  };
  window.ylMulti = function (el) { el.classList.toggle('on'); };
  window.ylAddClerk = function () {
    var inp = document.getElementById('yl-clerk-new'); var name = inp ? inp.value.trim() : '';
    if (!name) return; saveClerk(name); fillClerkSelect(name); if (inp) inp.value = '';
  };

  function fillFormFromState() {
    setVal('yl-defendant', state.defendant); setVal('yl-casenum', state.casenum);
    setVal('yl-casename', state.casename); setVal('yl-courtdiv', state.courtDiv);
    setVal('yl-parallel', state.parallel); setVal('yl-prosoffice', state.prosOffice);
    setVal('yl-birth', state.birth); setVal('yl-target', state.target);
    setVal('yl-doc1', state.doc1); setVal('yl-doc2', state.doc2);
    setVal('yl-writedate', state.writeDate || todayISO());
    setVal('yl-clerk-new', ''); setVal('yl-att-new', '');
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
  function collect() {
    state.jiwi = (document.querySelector('#yl-jiwi .fs-chip.on') || {}).getAttribute ? document.querySelector('#yl-jiwi .fs-chip.on').getAttribute('data-v') : state.jiwi;
    state.defendant = getVal('yl-defendant'); state.casenum = getVal('yl-casenum');
    state.casename = getVal('yl-casename'); state.courtDiv = getVal('yl-courtdiv');
    state.parallel = getVal('yl-parallel'); state.prosOffice = getVal('yl-prosoffice') || '인천지방검찰청';
    state.birth = getVal('yl-birth'); state.target = getRaw('yl-target').trim();
    state.doc1 = getVal('yl-doc1') || '기록일체'; state.doc2 = getVal('yl-doc2');
    state.use = (document.querySelector('#yl-use .fs-chip.on') || {}).getAttribute ? document.querySelector('#yl-use .fs-chip.on').getAttribute('data-v') : state.use;
    state.req = collectChips('#yl-req'); state.methods = collectChips('#yl-methods');
    state.clerk = getVal('yl-clerk') || CLERKS_SEED[0];
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
    var wantSeal = cfg.stamp && cfg.attorney === '서고은' && (typeof window !== 'undefined') && window.SEAL_SEOGOEUN;
    var anchor = cfg.type === '검찰' ? ('신청인 변호사 ' + spaced(cfg.attorney)) : ('신청인 ' + spaced(cfg.attorney));
    HWPXFill.build({
      url: TPL[cfg.type],
      fill: function (ctx) { (cfg.type === '검찰' ? fillProsecution : fillCourt)(ctx, cfg); },
      sealDataUrl: wantSeal ? window.SEAL_SEOGOEUN : null,
      sealAnchor: anchor
    }).then(function (blob) {
      HWPXFill.saveBlob(blob, downloadName(state));
    }).catch(function (e) { alert('HWPX 생성 실패: ' + e.message); });
  };

  /* node 검증용 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fillCourt: fillCourt, fillProsecution: fillProsecution, toCfg: toCfg, downloadName: downloadName };
  }
})();
