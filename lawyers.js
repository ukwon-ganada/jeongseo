/* 법무법인 정서 — 담당변호사 중앙관리 (lawyers.js)
   ───────────────────────────────────────────────────────────────
   하나의 저장소로 모든 서면의 담당변호사 명단을 통합 관리한다.
   · 저장소: localStorage 'jeongseo_lawyers_v1'
       [{ id, name, jumin(주민번호·선택), teams:[자유라벨…], active }]
   · window.ALL_ATTORNEYS 를 이 저장소의 '활성 변호사'로 파생시켜, 기존 8개 서면의
     담당변호사 선택창이 코드 변경 없이 이 명단을 따르게 한다.
   · 관리 화면(PC 관리 콘솔: 디렉터리 표 + 우측 편집 드로어)에서 추가/수정/삭제·팀
     배정 → 즉시 전 서면 반영.
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

  /* ══════════ 관리 콘솔 (PC: 디렉터리 표 + 우측 편집 드로어) ══════════ */
  var CSS =
    // 딤 배경 + 중앙 정렬
    '#lawyerAdmin{display:none;position:fixed;inset:0;z-index:1200;background:rgba(16,20,28,.5);' +
      'align-items:center;justify-content:center;padding:24px;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}' +
    '#lawyerAdmin.active{display:flex;}' +
    '.la-panel{position:relative;overflow:hidden;display:flex;flex-direction:column;' +
      'width:min(960px,94vw);max-height:86vh;background:#fff;border-radius:18px;box-shadow:0 24px 64px rgba(0,0,0,.32);}' +
    // 헤더
    '.la-head{display:flex;align-items:center;gap:12px;padding:18px 20px 0;}' +
    '.la-title{font-size:16.5px;font-weight:700;color:var(--black,#15181d);letter-spacing:-.01em;}' +
    '.la-close{width:34px;height:34px;border:0;background:var(--gray-100,#f2f3f5);border-radius:10px;color:var(--gray-700,#555);' +
      'cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .14s;}' +
    '.la-close:hover{background:#e7e9ee;}.la-close svg{width:18px;height:18px;}' +
    '.la-head .la-close{margin-left:auto;}' +
    // 세그먼트 탭(변호사 / 직원)
    '.la-tabs{display:inline-flex;gap:2px;background:var(--gray-100,#f2f3f5);border-radius:11px;padding:3px;margin:14px 20px 0;align-self:flex-start;}' +
    '.la-tab{border:0;background:transparent;padding:7px 16px;border-radius:8px;font-size:13.5px;font-weight:600;' +
      'color:var(--gray-500,#8a8f98);cursor:pointer;font-family:var(--font);transition:color .14s;}' +
    '.la-tab.on{background:#fff;color:var(--black,#15181d);box-shadow:0 1px 3px rgba(0,0,0,.1);}' +
    '.la-tab-soon{font-size:10px;color:var(--gray-400,#9096a1);margin-left:5px;font-weight:600;}' +
    // 툴바
    '.la-toolbar{display:flex;align-items:center;gap:10px;padding:16px 20px 12px;flex-wrap:wrap;}' +
    '.la-search{position:relative;flex:1;min-width:180px;max-width:300px;}' +
    '.la-search>svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--gray-400,#9096a1);pointer-events:none;}' +
    '.la-search input{width:100%;height:38px;border:1px solid var(--border,#e7e9ee);border-radius:10px;padding:0 12px 0 34px;' +
      'font-size:14px;font-family:var(--font);background:var(--gray-50,#fafbfc);outline:none;transition:border-color .14s,background .14s;}' +
    '.la-search input:focus{border-color:var(--hero,#3a6df0);background:#fff;}' +
    '.la-teamfilter{height:38px;border:1px solid var(--border,#e7e9ee);border-radius:10px;padding:0 10px;font-size:13.5px;' +
      'color:var(--gray-700,#555);background:#fff;font-family:var(--font);cursor:pointer;outline:none;}' +
    '.la-count{font-size:12.5px;color:var(--gray-400,#9096a1);white-space:nowrap;}' +
    '.la-add{margin-left:auto;white-space:nowrap;flex:0 0 auto;height:38px;padding:0 18px;font-size:13.5px;border-radius:10px;}' +
    // 표
    '.la-tablewrap{flex:1;overflow-y:auto;padding:0 20px 20px;-webkit-overflow-scrolling:touch;}' +
    '.la-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;}' +
    '.la-table thead th{position:sticky;top:0;background:#fff;text-align:left;font-size:10.5px;font-weight:700;letter-spacing:.06em;' +
      'color:var(--gray-400,#9096a1);text-transform:uppercase;padding:7px 12px;border-bottom:1px solid var(--border,#e7e9ee);z-index:1;}' +
    '.la-table tbody td{padding:8px 12px;border-bottom:1px solid var(--gray-100,#f2f3f5);vertical-align:middle;}' +
    '.la-table tbody tr{cursor:pointer;transition:background .12s;}' +
    '.la-table tbody tr:hover{background:var(--gray-50,#fafbfc);}' +
    '.la-table tbody tr.off td{opacity:.45;}' +
    '.la-td-name{font-weight:600;color:var(--black,#15181d);}' +
    '.la-td-name .la-edit-ic{opacity:0;margin-left:7px;color:var(--gray-400,#9096a1);transition:opacity .12s;}' +
    '.la-table tbody tr:hover .la-edit-ic{opacity:1;}' +
    '.la-jumin{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--gray-500,#8a8f98);letter-spacing:.02em;white-space:nowrap;}' +
    '.la-teamchips{display:flex;flex-wrap:wrap;gap:5px;}' +
    '.la-tchip{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--gray-100,#f2f3f5);color:var(--gray-700,#555);white-space:nowrap;}' +
    '.la-teamnone{color:#c5cad2;font-size:12px;}' +
    '.la-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;white-space:nowrap;}' +
    '.la-dot{width:7px;height:7px;border-radius:50%;flex:none;}' +
    '.la-status.on{color:#1f7a4d;}.la-status.on .la-dot{background:#2f9e6a;box-shadow:0 0 0 3px rgba(47,158,106,.14);}' +
    '.la-status.off{color:var(--gray-400,#9096a1);}.la-status.off .la-dot{background:#c5cad2;}' +
    '.la-empty{text-align:center;color:var(--gray-400,#9096a1);padding:44px 0;font-size:14px;}' +
    // 드로어 + 스크림
    '.la-scrim{position:absolute;inset:0;background:rgba(16,20,28,.26);opacity:0;pointer-events:none;transition:opacity .2s;z-index:5;}' +
    '.la-scrim.show{opacity:1;pointer-events:auto;}' +
    '.la-drawer{position:absolute;top:0;right:0;bottom:0;width:364px;max-width:90%;background:#fff;z-index:6;' +
      'box-shadow:-16px 0 44px rgba(0,0,0,.18);transform:translateX(100%);transition:transform .26s cubic-bezier(.22,1,.36,1);display:flex;flex-direction:column;}' +
    '.la-drawer.open{transform:translateX(0);}' +
    '.la-dhead{display:flex;align-items:center;padding:18px 20px;border-bottom:1px solid var(--gray-100,#f2f3f5);}' +
    '.la-dtitle{font-size:16px;font-weight:700;color:var(--black,#15181d);}' +
    '.la-dbody{flex:1;overflow-y:auto;padding:18px 20px;}' +
    '.la-field{margin-bottom:16px;}' +
    '.la-label{display:block;font-size:12.5px;font-weight:600;color:var(--gray-700,#555);margin-bottom:6px;}' +
    '.la-label .la-opt{font-weight:400;color:var(--gray-400,#9096a1);}' +
    '.la-drawer .fs-input{width:100%;}' +
    '.la-hint{font-size:11.5px;color:var(--gray-400,#9096a1);margin-top:5px;line-height:1.5;}' +
    '.la-suggest{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;}' +
    '.la-sg{font-size:11.5px;padding:4px 10px;border-radius:999px;border:1px dashed var(--border,#cfd4dc);color:#6b7280;background:none;cursor:pointer;font-family:var(--font);}' +
    '.la-sg:hover{background:var(--gray-100,#f2f3f5);}' +
    '.la-toggle{display:flex;align-items:center;gap:11px;}' +
    '.la-switch{position:relative;width:42px;height:24px;border-radius:999px;background:#cfd4dc;cursor:pointer;transition:background .18s;flex:none;border:0;padding:0;}' +
    '.la-switch.on{background:#2f9e6a;}' +
    '.la-switch::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .18s;}' +
    '.la-switch.on::after{transform:translateX(18px);}' +
    '.la-switch-label{font-size:13.5px;color:var(--gray-700,#555);}' +
    '.la-dfoot{display:flex;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--gray-100,#f2f3f5);}' +
    '.la-del{font-size:13px;color:#c0392b;background:none;border:1px solid rgba(192,57,43,.3);border-radius:10px;padding:9px 14px;cursor:pointer;font-family:var(--font);}' +
    '.la-del:hover{background:rgba(192,57,43,.06);}' +
    '.la-dfoot .la-spacer{margin-left:auto;}' +
    '@media (prefers-reduced-motion:reduce){.la-drawer,.la-scrim,.la-switch,.la-switch::after{transition:none;}}';

  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  var ICON_EDIT = '<svg class="la-edit-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

  function maskJumin(j) {
    j = (j || '').trim(); if (!j) return '—';
    var d = j.replace(/[^0-9]/g, '');
    if (d.length >= 8) return d.slice(0, 6) + '-' + d.slice(6, 7) + '******';
    return esc(j);
  }

  function ensureUI() {
    FSDoc.injectOnce(STYLE_ID, CSS);
    if (document.getElementById(SHELL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="lawyerAdmin" onclick="laBackdrop(event)">' +
        '<div class="la-panel">' +
          '<div class="la-head">' +
            '<div class="la-title">인적 관리</div>' +
            '<button class="la-close" onclick="closeLawyerAdmin()" aria-label="닫기">' + ICON_CLOSE + '</button>' +
          '</div>' +
          '<div class="la-tabs" role="tablist">' +
            '<button class="la-tab on" id="la-tab-lawyer" role="tab" onclick="laSwitchTab(\'lawyer\')">변호사</button>' +
            '<button class="la-tab" id="la-tab-staff" role="tab" onclick="laSwitchTab(\'staff\')">직원<span class="la-tab-soon">준비중</span></button>' +
          '</div>' +
          '<div class="la-toolbar">' +
            '<div class="la-search">' + ICON_SEARCH + '<input id="la-search" type="text" placeholder="이름·팀 검색" oninput="laRender()" autocomplete="off"></div>' +
            '<select class="la-teamfilter" id="la-teamfilter" onchange="laRender()"><option value="">전체 팀</option></select>' +
            '<span class="la-count" id="la-count"></span>' +
            '<button class="fs-btn primary la-add" onclick="laOpenDrawer(\'\')">＋ 변호사 추가</button>' +
          '</div>' +
          '<div class="la-tablewrap">' +
            '<table class="la-table">' +
              '<thead><tr><th style="width:26%">이름</th><th style="width:26%">주민등록번호</th><th style="width:32%">팀</th><th style="width:16%">상태</th></tr></thead>' +
              '<tbody id="la-tbody"></tbody>' +
            '</table>' +
            '<div class="la-empty" id="la-empty" style="display:none;">표시할 변호사가 없습니다.</div>' +
          '</div>' +
          '<div class="la-scrim" id="la-scrim" onclick="laCloseDrawer()"></div>' +
          '<div class="la-drawer" id="la-drawer" role="dialog" aria-label="변호사 편집">' +
            '<div class="la-dhead">' +
              '<div class="la-dtitle" id="la-dtitle">변호사 편집</div>' +
              '<button class="la-close" style="margin-left:auto" onclick="laCloseDrawer()" aria-label="닫기">' + ICON_CLOSE + '</button>' +
            '</div>' +
            '<div class="la-dbody">' +
              '<input type="hidden" id="la-f-id">' +
              '<div class="la-field"><label class="la-label" for="la-f-name">이름</label>' +
                '<input class="fs-input" id="la-f-name" placeholder="예: 서고은" autocomplete="off"></div>' +
              '<div class="la-field"><label class="la-label" for="la-f-jumin">주민등록번호 <span class="la-opt">(위임장용·선택)</span></label>' +
                '<input class="fs-input" id="la-f-jumin" placeholder="840219-2079920" autocomplete="off" style="font-family:\'IBM Plex Mono\',monospace">' +
                '<div class="la-hint">표에서는 뒷자리가 가려지고(●●●●●●), 이 편집창에서만 전체가 보입니다.</div></div>' +
              '<div class="la-field"><label class="la-label" for="la-f-teams">팀</label>' +
                '<input class="fs-input" id="la-f-teams" placeholder="예: 형사팀, 파트너 (쉼표로 구분)" autocomplete="off">' +
                '<div class="la-suggest" id="la-suggest"></div></div>' +
              '<div class="la-field"><label class="la-label">상태</label>' +
                '<div class="la-toggle"><button type="button" class="la-switch on" id="la-f-active" onclick="laToggleSwitch()" aria-label="활성 전환"></button>' +
                '<span class="la-switch-label" id="la-f-active-label">활성 · 선택창에 노출됩니다</span></div></div>' +
            '</div>' +
            '<div class="la-dfoot">' +
              '<button class="la-del" id="la-del" onclick="laDeleteDrawer()">삭제</button>' +
              '<span class="la-spacer"></span>' +
              '<button class="fs-btn ghost" onclick="laCloseDrawer()">취소</button>' +
              '<button class="fs-btn primary" onclick="laSaveDrawer()">저장</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  /* ── 렌더 ── */
  function rowHTML(l) {
    var teams = l.teams.length
      ? '<div class="la-teamchips">' + l.teams.map(function (t) { return '<span class="la-tchip">' + esc(t) + '</span>'; }).join('') + '</div>'
      : '<span class="la-teamnone">—</span>';
    var status = l.active
      ? '<span class="la-status on"><span class="la-dot"></span>활성</span>'
      : '<span class="la-status off"><span class="la-dot"></span>비활성</span>';
    return '<tr class="' + (l.active ? '' : 'off') + '" data-id="' + esc(l.id) + '" onclick="laOpenDrawer(\'' + esc(l.id) + '\')">' +
      '<td class="la-td-name">' + esc(l.name) + ICON_EDIT + '</td>' +
      '<td class="la-jumin">' + maskJumin(l.jumin) + '</td>' +
      '<td>' + teams + '</td>' +
      '<td>' + status + '</td>' +
    '</tr>';
  }

  window.laRender = function () {
    var tb = document.getElementById('la-tbody'); if (!tb) return;
    var all = load();
    // 팀 필터 옵션 갱신(현재 선택 보존)
    var sel = document.getElementById('la-teamfilter');
    var curTeam = sel ? sel.value : '';
    if (sel) {
      var teams = allTeams();
      sel.innerHTML = '<option value="">전체 팀</option>' + teams.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('');
      sel.value = teams.indexOf(curTeam) >= 0 ? curTeam : '';
      curTeam = sel.value;
    }
    var q = ((document.getElementById('la-search') || {}).value || '').trim().toLowerCase();
    var rows = all.filter(function (l) {
      if (curTeam && l.teams.indexOf(curTeam) < 0) return false;
      if (q) {
        var hay = (l.name + ' ' + l.teams.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    tb.innerHTML = rows.map(rowHTML).join('');
    var empty = document.getElementById('la-empty'); if (empty) empty.style.display = rows.length ? 'none' : 'block';
    var cnt = document.getElementById('la-count');
    if (cnt) {
      var active = all.filter(function (x) { return x.active; }).length;
      cnt.textContent = '변호사 ' + all.length + '명 · 활성 ' + active + '명';
    }
  };

  /* ── 편집 드로어 ── */
  function setSwitch(on) {
    var sw = document.getElementById('la-f-active'), lb = document.getElementById('la-f-active-label');
    if (sw) sw.classList.toggle('on', !!on);
    if (lb) lb.textContent = on ? '활성 · 선택창에 노출됩니다' : '비활성 · 선택창에서 숨겨집니다';
  }
  window.laToggleSwitch = function () { var sw = document.getElementById('la-f-active'); setSwitch(!(sw && sw.classList.contains('on'))); };
  window.laAddSuggest = function (t) {
    var inp = document.getElementById('la-f-teams'); if (!inp) return;
    var cur = inp.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (cur.indexOf(t) < 0) cur.push(t);
    inp.value = cur.join(', ');
  };
  function renderSuggest() {
    var box = document.getElementById('la-suggest'); if (!box) return;
    var ts = allTeams();
    box.innerHTML = ts.length
      ? ts.map(function (t) { return '<button type="button" class="la-sg" onclick="laAddSuggest(\'' + esc(t) + '\')">＋ ' + esc(t) + '</button>'; }).join('')
      : '';
  }

  window.laOpenDrawer = function (id) {
    var rec = null;
    if (id) { var l = load(); for (var i = 0; i < l.length; i++) { if (l[i].id === id) { rec = l[i]; break; } } }
    var isNew = !rec;
    document.getElementById('la-f-id').value = isNew ? '' : rec.id;
    document.getElementById('la-f-name').value = isNew ? '' : rec.name;
    document.getElementById('la-f-jumin').value = isNew ? '' : rec.jumin;
    document.getElementById('la-f-teams').value = isNew ? '' : rec.teams.join(', ');
    setSwitch(isNew ? true : rec.active);
    document.getElementById('la-dtitle').textContent = isNew ? '변호사 추가' : '변호사 편집';
    document.getElementById('la-del').style.display = isNew ? 'none' : '';
    renderSuggest();
    document.getElementById('la-scrim').classList.add('show');
    document.getElementById('la-drawer').classList.add('open');
    var nm = document.getElementById('la-f-name'); if (nm) setTimeout(function () { nm.focus(); }, 60);
  };
  window.laCloseDrawer = function () {
    var d = document.getElementById('la-drawer'), s = document.getElementById('la-scrim');
    if (d) d.classList.remove('open'); if (s) s.classList.remove('show');
  };

  window.laSaveDrawer = function () {
    var id = document.getElementById('la-f-id').value;
    var name = (document.getElementById('la-f-name').value || '').trim();
    var jumin = (document.getElementById('la-f-jumin').value || '').trim();
    var teams = (document.getElementById('la-f-teams').value || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    var active = document.getElementById('la-f-active').classList.contains('on');
    if (!name) { alert('이름을 입력하세요.'); document.getElementById('la-f-name').focus(); return; }
    var list = load(), found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name && list[i].id !== id) { alert('같은 이름의 변호사가 이미 있습니다: ' + name); return; }
    }
    for (var j = 0; j < list.length; j++) {
      if (id && list[j].id === id) { list[j] = { id: id, name: name, jumin: jumin, teams: teams, active: active }; found = true; break; }
    }
    if (!found) list.push({ id: id || uid(), name: name, jumin: jumin, teams: teams, active: active });
    if (!list.filter(function (x) { return x.active; }).length) { alert('활성 변호사가 최소 1명은 있어야 합니다.'); return; }
    save(list);
    laRender();
    laCloseDrawer();
    if (typeof window.fsToast === 'function') window.fsToast('저장했습니다');
  };

  window.laDeleteDrawer = function () {
    var id = document.getElementById('la-f-id').value; if (!id) { laCloseDrawer(); return; }
    var list = load(), name = '';
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { name = list[i].name; break; } }
    if (name && !confirm('"' + name + '" 변호사를 목록에서 삭제할까요?\n(숨기기만 원하면 상태를 [비활성]으로 두세요)')) return;
    var next = list.filter(function (x) { return x.id !== id; });
    if (!next.filter(function (x) { return x.active; }).length) { alert('활성 변호사가 최소 1명은 있어야 합니다.'); return; }
    save(next);
    laRender();
    laCloseDrawer();
    if (typeof window.fsToast === 'function') window.fsToast('삭제했습니다');
  };

  window.laSwitchTab = function (kind) {
    if (kind === 'staff') {
      if (typeof window.fsToast === 'function') window.fsToast('직원 관리는 준비 중입니다'); else alert('직원 관리는 준비 중입니다.');
      return; // 변호사 탭 유지
    }
  };

  window.laBackdrop = function (e) { if (e && e.target && e.target.id === 'lawyerAdmin') closeLawyerAdmin(); };

  function onEsc(e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    var d = document.getElementById('la-drawer');
    if (d && d.classList.contains('open')) laCloseDrawer(); else closeLawyerAdmin();
  }

  window.openLawyerAdmin = function () {
    ensureUI();
    var s = document.getElementById('la-search'); if (s) s.value = '';
    var tf = document.getElementById('la-teamfilter'); if (tf) tf.value = '';
    laCloseDrawer();
    laRender();
    document.getElementById('lawyerAdmin').classList.add('active');
    document.addEventListener('keydown', onEsc);
  };
  window.closeLawyerAdmin = function () {
    var f = document.getElementById('lawyerAdmin'); if (f) f.classList.remove('active');
    document.removeEventListener('keydown', onEsc);
    syncGlobal();
  };

  // 로드 즉시 동기화: 기존 하드코딩 ALL_ATTORNEYS 를 저장소 활성명단으로 대체
  syncGlobal();
})();
