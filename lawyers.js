/* 법무법인 정서 — 담당변호사 중앙관리 (lawyers.js)
   ───────────────────────────────────────────────────────────────
   하나의 저장소로 모든 서면의 담당변호사 명단을 통합 관리한다.
   · 저장소: localStorage 'jeongseo_lawyers_v1'
       [{ id, name, jumin(주민번호·선택), teams:[자유라벨…], active }]
   · window.ALL_ATTORNEYS 를 이 저장소의 '활성 변호사'로 파생시켜, 기존 8개 서면의
     담당변호사 선택창이 코드 변경 없이 이 명단을 따르게 한다.
   · 관리 화면(전체화면 오버레이)에서 추가/수정/삭제·팀 배정 → 즉시 전 서면 반영.
   진입점: window.openLawyerAdmin() / window.closeLawyerAdmin()
   공개 API: window.LawyerStore = { load, activeNames, juminOf, setJumin, allTeams }
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var KEY = 'jeongseo_lawyers_v1';
  var SHELL_ID = 'lawyerAdminShell';
  var STYLE_ID = 'lawyer-admin-style';
  // 시드: 기존 명단(우숭민 제외) + 서고은 주민번호
  var SEED = [
    { name: '서고은', jumin: '840219-2079920' },
    { name: '정필성', jumin: '' }, { name: '김홍일', jumin: '' },
    { name: '양선화', jumin: '' }, { name: '이예나', jumin: '' }, { name: '손영우', jumin: '' }
  ];
  var _seq = 0;
  function uid() { return 'lw' + Date.now().toString(36) + (_seq++).toString(36); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function normalize(list) {
    return (list || []).map(function (x) {
      return {
        id: x.id || uid(), name: (x.name || '').trim(), jumin: (x.jumin || '').trim(),
        teams: Array.isArray(x.teams) ? x.teams.map(function (t) { return String(t).trim(); }).filter(Boolean) : [],
        active: x.active !== false
      };
    }).filter(function (x) { return x.name; });
  }

  function migrate() {
    // 기존 세 소스(하드코딩 명단·열람 주민번호)를 하나로 병합해 최초 시드
    var byName = {};
    SEED.forEach(function (s) { byName[s.name] = { name: s.name, jumin: s.jumin || '', teams: [], active: true }; });
    try { (window.ALL_ATTORNEYS || []).forEach(function (n) { if (n && !byName[n]) byName[n] = { name: n, jumin: '', teams: [], active: true }; }); } catch (e) {}
    try {
      var yl = JSON.parse(localStorage.getItem('jeongseo_yeollam_atts') || '[]');
      yl.forEach(function (a) {
        if (!a || !a.name) return;
        if (!byName[a.name]) byName[a.name] = { name: a.name, jumin: a.jumin || '', teams: [], active: true };
        else if (a.jumin && !byName[a.name].jumin) byName[a.name].jumin = a.jumin;
      });
    } catch (e) {}
    return normalize(Object.keys(byName).map(function (k) { return byName[k]; }));
  }

  function load() {
    try { var raw = localStorage.getItem(KEY); var a = raw ? JSON.parse(raw) : null; if (a && a.length) return normalize(a); } catch (e) {}
    var seeded = migrate(); save(seeded); return seeded;
  }
  function save(list) {
    var norm = normalize(list);
    try { localStorage.setItem(KEY, JSON.stringify(norm)); } catch (e) {}
    syncGlobal();
    return norm;
  }
  function activeNames() { return load().filter(function (x) { return x.active; }).map(function (x) { return x.name; }); }
  function juminOf(name) { var l = load(); for (var i = 0; i < l.length; i++) { if (l[i].name === name) return l[i].jumin || ''; } return ''; }
  function setJumin(name, jumin) {
    var l = load(), f = false;
    for (var i = 0; i < l.length; i++) { if (l[i].name === name) { l[i].jumin = (jumin || '').trim(); f = true; break; } }
    if (!f) l.push({ id: uid(), name: (name || '').trim(), jumin: (jumin || '').trim(), teams: [], active: true });
    save(l);
  }
  function allTeams() { var t = {}; load().forEach(function (x) { x.teams.forEach(function (g) { if (g) t[g] = 1; }); }); return Object.keys(t); }

  // 기존 서면들이 참조하는 window.ALL_ATTORNEYS 를 저장소 활성명단으로 동기화(코어 통합점)
  function syncGlobal() { try { if (typeof window !== 'undefined') window.ALL_ATTORNEYS = load().filter(function (x) { return x.active; }).map(function (x) { return x.name; }); } catch (e) {} }

  if (typeof window !== 'undefined') {
    window.LawyerStore = { load: load, save: save, activeNames: activeNames, juminOf: juminOf, setJumin: setJumin, allTeams: allTeams };
  }

  /* ══════════ 관리 화면 ══════════ */
  var CSS =
    '#lawyerAdmin{display:none;position:fixed;inset:0;z-index:1200;background:#fff;flex-direction:column;}' +
    '#lawyerAdmin.active{display:flex;}' +
    '#lawyerAdmin .fs-body{padding:16px;overflow-y:auto;flex:1;}' +
    '#lawyerAdmin .lw-hint{font-size:12.5px;color:var(--gray-400,#9096a1);margin:0 2px 14px;line-height:1.6;}' +
    '#lawyerAdmin .lw-row{border:1px solid var(--border,#e7e9ee);border-radius:14px;padding:12px 12px 10px;margin-bottom:12px;background:#fff;}' +
    '#lawyerAdmin .lw-row.off{opacity:.5;}' +
    '#lawyerAdmin .lw-r1{display:flex;gap:8px;align-items:center;}' +
    '#lawyerAdmin .lw-name{flex:0 0 92px;font-weight:600;}' +
    '#lawyerAdmin .lw-jumin{flex:1;min-width:0;}' +
    '#lawyerAdmin .lw-r2{display:flex;gap:8px;align-items:center;margin-top:8px;}' +
    '#lawyerAdmin .lw-teams{flex:1;min-width:0;}' +
    '#lawyerAdmin .lw-r3{display:flex;gap:12px;align-items:center;margin-top:9px;}' +
    '#lawyerAdmin .lw-act{display:flex;align-items:center;gap:6px;font-size:13.5px;color:var(--gray-700,#555);cursor:pointer;}' +
    '#lawyerAdmin .lw-del{margin-left:auto;font-size:13px;color:#c0392b;background:none;border:1px solid rgba(192,57,43,.35);border-radius:var(--r-pill,999px);padding:5px 13px;cursor:pointer;}' +
    '#lawyerAdmin .lw-del:active{background:rgba(192,57,43,.08);}' +
    '#lawyerAdmin .lw-tlabel{font-size:12px;color:var(--gray-400,#9096a1);flex:0 0 auto;}' +
    '#lawyerAdmin .lw-addbtn{width:100%;border:1px dashed var(--border,#cfd4dc);background:none;border-radius:14px;padding:12px;font-size:14px;color:var(--gray-700,#555);cursor:pointer;margin-top:2px;}' +
    '#lawyerAdmin .lw-addbtn:active{background:var(--gray-100,#f2f3f5);}' +
    '#lawyerAdmin .lw-teamsall{font-size:12px;color:var(--gray-400,#9096a1);margin:2px 2px 14px;}';

  function ensureUI() {
    FSDoc.injectOnce(STYLE_ID, CSS);
    if (document.getElementById(SHELL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="lawyerAdmin">' +
        '<div class="fs-card">' +
          '<div class="fs-head">' +
            '<button class="fs-close" onclick="closeLawyerAdmin()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '<div class="fs-title">담당변호사 관리</div>' +
          '</div>' +
          '<div class="fs-body">' +
            '<div class="lw-hint">모든 서면의 담당변호사 선택창이 이 명단을 따릅니다. 이름·주민번호(위임장용)·팀(쉼표로 자유롭게)을 수정하고, 아래 <b>저장</b>을 누르세요. 비활성으로 두면 선택창에서 숨겨집니다(삭제 대신 사용 가능).</div>' +
            '<div id="lw-list"></div>' +
            '<button type="button" class="lw-addbtn" onclick="lwAddRow()">＋ 변호사 추가</button>' +
            '<div class="lw-teamsall" id="lw-teamsall"></div>' +
          '</div>' +
          '<div class="fs-foot">' +
            '<button class="fs-btn ghost" onclick="closeLawyerAdmin()">닫기</button>' +
            '<button class="fs-btn primary" onclick="lwSaveAll()">저장</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  function rowHTML(l) {
    l = l || { id: uid(), name: '', jumin: '', teams: [], active: true };
    return '<div class="lw-row' + (l.active ? '' : ' off') + '" data-id="' + esc(l.id) + '">' +
      '<div class="lw-r1">' +
        '<input class="fs-input lw-name" placeholder="이름" value="' + esc(l.name) + '">' +
        '<input class="fs-input lw-jumin" placeholder="주민번호(선택, 위임장용)" value="' + esc(l.jumin) + '">' +
      '</div>' +
      '<div class="lw-r2">' +
        '<span class="lw-tlabel">팀</span>' +
        '<input class="fs-input lw-teams" placeholder="예: 형사팀, 파트너 (쉼표로 구분)" value="' + esc(l.teams.join(', ')) + '">' +
      '</div>' +
      '<div class="lw-r3">' +
        '<label class="lw-act"><input type="checkbox" class="lw-active"' + (l.active ? ' checked' : '') + ' onchange="lwToggleRow(this)"> 활성</label>' +
        '<button type="button" class="lw-del" onclick="lwDelRow(this)">삭제</button>' +
      '</div>' +
    '</div>';
  }

  function renderList() {
    var box = document.getElementById('lw-list'); if (!box) return;
    box.innerHTML = load().map(rowHTML).join('');
    renderTeamsAll();
  }
  function renderTeamsAll() {
    var el = document.getElementById('lw-teamsall'); if (!el) return;
    var ts = allTeams();
    el.textContent = ts.length ? ('등록된 팀: ' + ts.join(' · ')) : '';
  }

  window.lwAddRow = function () {
    var box = document.getElementById('lw-list'); if (!box) return;
    box.insertAdjacentHTML('beforeend', rowHTML(null));
    var rows = box.querySelectorAll('.lw-row');
    var last = rows[rows.length - 1]; if (last) { var n = last.querySelector('.lw-name'); if (n) n.focus(); }
  };
  window.lwDelRow = function (btn) {
    var row = btn.closest('.lw-row'); if (!row) return;
    var nm = (row.querySelector('.lw-name') || {}).value || '';
    if (nm && !confirm('"' + nm + '" 변호사를 목록에서 삭제할까요?\n(숨기기만 원하면 [활성] 체크를 해제하세요)')) return;
    row.parentNode.removeChild(row);
  };
  window.lwToggleRow = function (chk) { var row = chk.closest('.lw-row'); if (row) row.classList.toggle('off', !chk.checked); };

  function collectRows() {
    var out = [];
    document.querySelectorAll('#lw-list .lw-row').forEach(function (row) {
      var name = (row.querySelector('.lw-name') || {}).value || '';
      name = name.trim(); if (!name) return;
      var jumin = ((row.querySelector('.lw-jumin') || {}).value || '').trim();
      var teams = ((row.querySelector('.lw-teams') || {}).value || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      var active = !!(row.querySelector('.lw-active') || {}).checked;
      out.push({ id: row.getAttribute('data-id') || uid(), name: name, jumin: jumin, teams: teams, active: active });
    });
    return out;
  }
  function dupName(list) {
    var seen = {}; for (var i = 0; i < list.length; i++) { var n = list[i].name; if (seen[n]) return n; seen[n] = 1; } return '';
  }

  window.lwSaveAll = function () {
    var list = collectRows();
    var d = dupName(list);
    if (d) { alert('같은 이름의 변호사가 중복됩니다: ' + d); return; }
    if (!list.filter(function (x) { return x.active; }).length) { alert('활성 변호사가 최소 1명은 있어야 합니다.'); return; }
    save(list);
    renderList();
    if (typeof window.fsToast === 'function') window.fsToast('저장했습니다'); else alert('저장했습니다.');
  };

  window.openLawyerAdmin = function () { ensureUI(); renderList(); document.getElementById('lawyerAdmin').classList.add('active'); };
  window.closeLawyerAdmin = function () { var f = document.getElementById('lawyerAdmin'); if (f) f.classList.remove('active'); syncGlobal(); };

  // 로드 즉시 동기화: 기존 하드코딩 ALL_ATTORNEYS 를 저장소 활성명단으로 대체
  syncGlobal();
})();
