/* 법무법인 정서 — 국선 사건 관리 (네이티브 · gsmgr.js)
   ───────────────────────────────────────────────────────────────
   기존 iframe React 앱(gukseon-manager.html)을 정서 본체 스타일로 새로 만든다.
   [Phase 1] 읽기 전용:
     · 같은 Supabase 테이블 gukseon_cases 를 그대로 읽어 3패널(진행/종결/보수)로 표시
     · 실시간(realtime) 구독으로 다른 기기 변경 즉시 반영
     · 데이터는 절대 변경하지 않음(추가/편집은 "기존 화면" 버튼 → openCaseMgrLegacy)
   데이터 구조(1행=1사건): { id, data:{ defendant, contact, caseNumber, caseName,
     hearingType, hearingDate, verdictDate, todo, claimed, feeForm{...},
     depositDate, depositAmount, appeal, appealStamped } }
   패널(파생, 저장 안 함):
     · 종결 = verdictDate 있고 오늘 ≥ verdictDate(선고기일 지남)
     · 보수 = 종결 && claimed(보수청구 체크) — 필터뷰(종결에도 남음)
     · 진행 = 그 외
   진입점: window.goCaseManager() / window.closeGsmgr()
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var SHELL_ID = 'gsmgrScreen';
  var STYLE_ID = 'gsmgr-style';
  var TABLE_ID = 'gsmgr-tbl';

  var state = { cases: [], tab: 'active', loaded: false, error: '' };
  var channel = null;

  /* ── 유틸 ── */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  // 날짜 문자열을 YYYYMMDD 로 정규화(대시/점/붙임 등 형식 무관)
  function ymd(dstr) {
    var m = String(dstr == null ? '' : dstr).match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
    return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : '';
  }
  function ymdToday() {
    var d = new Date();
    return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
  }
  function reached(dstr) { var a = ymd(dstr); return !!a && a <= ymdToday(); }
  function fmtDate(dstr) {
    var m = String(dstr == null ? '' : dstr).match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
    return m ? m[1] + '. ' + Number(m[2]) + '. ' + Number(m[3]) + '.' : '';
  }

  /* ── 파생 패널 ── */
  // 선고일 = verdictDate 우선, 없으면 hearingType==='선고'일 때 hearingDate
  function verdictOf(c) { return c.verdictDate || (c.hearingType === '선고' ? c.hearingDate : ''); }
  function isClosed(c) { return reached(verdictOf(c)); }
  function panelCases(tab) {
    var arr = state.cases.filter(function (c) {
      if (tab === 'closed') return isClosed(c);
      if (tab === 'fee') return isClosed(c) && !!c.claimed;
      return !isClosed(c); // active
    });
    arr.sort(function (a, b) {
      if (tab === 'active') { // 임박한 기일 먼저
        return (activeDate(a) || '9999').localeCompare(activeDate(b) || '9999');
      }
      // 종결/보수: 최근 선고 먼저
      return ymd(verdictOf(b)).localeCompare(ymd(verdictOf(a)));
    });
    return arr;
  }
  // 진행 패널의 '기일' = 선고기일 예정 있으면 그것, 없으면 최근 공판기일
  function activeDate(c) { return verdictOf(c) || c.hearingDate || ''; }

  /* ── 스타일(테마 통일 · 업무용 고가시성) ── */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#' + SHELL_ID + '{display:none;position:fixed;inset:0;z-index:1100;background:#eef2f7;',
        'flex-direction:column;font-family:var(--font,-apple-system,\'Malgun Gothic\',sans-serif);color:#1a1a1a;}',
      '#' + SHELL_ID + '.active{display:flex;}',
      /* 앱바 */
      '#' + SHELL_ID + ' .gm-bar{flex:none;display:flex;align-items:center;gap:10px;height:56px;',
        'padding:0 16px;background:rgba(255,255,255,.85);backdrop-filter:blur(14px);',
        '-webkit-backdrop-filter:blur(14px);border-bottom:1px solid rgba(22,38,63,.12);}',
      '#' + SHELL_ID + ' .gm-back{display:inline-flex;align-items:center;gap:6px;border:none;background:none;',
        'cursor:pointer;font:inherit;font-size:15px;font-weight:600;color:#16263f;padding:8px 8px;border-radius:9px;}',
      '#' + SHELL_ID + ' .gm-back:hover{background:#e6ecf5;}',
      '#' + SHELL_ID + ' .gm-back svg{width:18px;height:18px;}',
      '#' + SHELL_ID + ' .gm-title{font-family:\'Noto Serif KR\',serif;font-size:18px;font-weight:600;color:#16263f;}',
      '#' + SHELL_ID + ' .gm-spacer{flex:1;}',
      '#' + SHELL_ID + ' .gm-edit{border:1.5px solid #16263f;background:#fff;color:#16263f;font-weight:600;',
        'font-size:13.5px;height:38px;padding:0 15px;border-radius:999px;cursor:pointer;font-family:inherit;}',
      '#' + SHELL_ID + ' .gm-edit:hover{background:#eef2f9;}',
      /* 탭 */
      '#' + SHELL_ID + ' .gm-tabs{flex:none;display:flex;gap:8px;padding:14px 16px 6px;}',
      '#' + SHELL_ID + ' .gm-tab{border:1px solid rgba(22,38,63,.16);background:#fff;color:#41537a;',
        'font-weight:600;font-size:14px;padding:9px 18px;border-radius:999px;cursor:pointer;font-family:inherit;',
        'display:inline-flex;align-items:center;gap:7px;transition:.12s;}',
      '#' + SHELL_ID + ' .gm-tab:hover{border-color:#16263f;}',
      '#' + SHELL_ID + ' .gm-tab.on{background:#16263f;border-color:#16263f;color:#fff;}',
      '#' + SHELL_ID + ' .gm-cnt{display:inline-block;min-width:20px;text-align:center;font-size:12px;',
        'padding:1px 7px;border-radius:999px;background:rgba(22,38,63,.10);color:#41537a;font-weight:700;}',
      '#' + SHELL_ID + ' .gm-tab.on .gm-cnt{background:rgba(255,255,255,.22);color:#fff;}',
      /* 본문/표 */
      '#' + SHELL_ID + ' .gm-body{flex:1;overflow:auto;padding:8px 16px 28px;-webkit-overflow-scrolling:touch;}',
      '#' + SHELL_ID + ' .gm-card{background:#fff;border:1px solid rgba(22,38,63,.10);border-radius:16px;',
        'box-shadow:0 18px 40px -28px rgba(20,40,70,.35);overflow:hidden;max-width:1100px;margin:0 auto;}',
      '#' + SHELL_ID + ' table{width:100%;border-collapse:collapse;font-size:14px;}',
      '#' + SHELL_ID + ' thead th{position:sticky;top:0;background:#f4f7fb;color:#41537a;font-weight:700;',
        'font-size:12.5px;text-align:left;padding:12px 14px;border-bottom:1.5px solid rgba(22,38,63,.14);white-space:nowrap;z-index:1;}',
      '#' + SHELL_ID + ' tbody td{padding:13px 14px;border-bottom:1px solid rgba(22,38,63,.07);vertical-align:middle;}',
      '#' + SHELL_ID + ' tbody tr:hover{background:#f7faff;}',
      '#' + SHELL_ID + ' tbody tr:last-child td{border-bottom:none;}',
      '#' + SHELL_ID + ' .gm-name{font-weight:700;color:#16263f;cursor:default;position:relative;',
        'border-bottom:1px dotted rgba(22,38,63,.4);}',
      '#' + SHELL_ID + ' .gm-code{font-family:\'IBM Plex Mono\',monospace;color:#243d5e;font-size:13px;}',
      '#' + SHELL_ID + ' .gm-tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-right:6px;}',
      '#' + SHELL_ID + ' .tag-gongpan{background:#e7eefb;color:#1a4ea2;}',
      '#' + SHELL_ID + ' .tag-sgo{background:#fdecea;color:#b23a2e;}',
      '#' + SHELL_ID + ' .tag-cancel{background:#eef0f2;color:#6b7280;}',
      '#' + SHELL_ID + ' .gm-yes{color:#1a7f3c;font-weight:700;}',
      '#' + SHELL_ID + ' .gm-no{color:#9aa6b8;}',
      '#' + SHELL_ID + ' .gm-memo{color:#444;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#' + SHELL_ID + ' .gm-empty{padding:60px 20px;text-align:center;color:#8a97ab;font-size:14px;}',
      '#' + SHELL_ID + ' .gm-loading{padding:60px 20px;text-align:center;color:#8a97ab;font-size:14px;}',
      /* 수감번호/연락처 툴팁 */
      '#' + SHELL_ID + ' .gm-tip{position:fixed;z-index:1200;background:#16263f;color:#fff;font-size:12.5px;',
        'padding:8px 12px;border-radius:10px;box-shadow:0 12px 30px rgba(12,25,45,.4);pointer-events:none;',
        'max-width:260px;line-height:1.5;display:none;}',
      '#' + SHELL_ID + ' .gm-tip b{color:#EAF1F9;}',
      '#' + SHELL_ID + ' .gm-tip .gm-tip-lbl{color:#9fb4d6;font-size:10.5px;letter-spacing:.04em;display:block;margin-bottom:2px;}',
      /* 좁은 화면(모바일) */
      '@media (max-width:640px){',
        '#' + SHELL_ID + ' .gm-body{padding:6px 8px 24px;}',
        '#' + SHELL_ID + ' table{font-size:13px;}',
        '#' + SHELL_ID + ' thead th,#' + SHELL_ID + ' tbody td{padding:10px 9px;}',
        '#' + SHELL_ID + ' .gm-title{font-size:16px;}',
        '#' + SHELL_ID + ' .gm-memo{max-width:120px;}',
      '}'
    ].join('');
    var s = document.createElement('style');
    s.id = STYLE_ID; s.textContent = css;
    document.head.appendChild(s);
  }

  /* ── 셸(앱바 + 탭 + 본문) ── */
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var el = document.createElement('div');
    el.id = SHELL_ID;
    el.innerHTML =
      '<div class="gm-bar">' +
        '<button class="gm-back" onclick="closeGsmgr()" aria-label="홈">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>홈' +
        '</button>' +
        '<span class="gm-title">국선 사건 관리</span>' +
        '<span class="gm-spacer"></span>' +
        '<button class="gm-edit" onclick="if(window.openCaseMgrLegacy)openCaseMgrLegacy()">＋ 사건 추가 · 편집</button>' +
      '</div>' +
      '<div class="gm-tabs" id="gsmgr-tabs"></div>' +
      '<div class="gm-body" id="gsmgr-body"></div>' +
      '<div class="gm-tip" id="gsmgr-tip"></div>';
    document.body.appendChild(el);
  }

  function ensureUI() { injectStyle(); injectShell(); }

  /* ── 기존 데이터 정규화(빠진 필드 기본값 채움 · 저장 안 함) ── */
  function normalize(row) {
    var d = row && row.data ? row.data : {};
    var c = {
      id: row.id,
      defendant: d.defendant || '', contact: d.contact || '',
      caseNumber: d.caseNumber || '', caseName: d.caseName || '',
      hearingType: d.hearingType || '공판', hearingDate: d.hearingDate || '',
      verdictDate: d.verdictDate || '', todo: d.todo || '',
      claimed: !!d.claimed, appeal: d.appeal || '', appealStamped: !!d.appealStamped,
      depositDate: d.depositDate || '', depositAmount: d.depositAmount || '',
      _raw: d
    };
    return c;
  }

  /* ── 데이터 로드 ── */
  function load() {
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb) { state.error = 'nosb'; render(); return; }
    sb.from('gukseon_cases').select('id,data').then(function (res) {
      if (res && res.error) { state.error = 'err'; state.loaded = true; render(); return; }
      state.error = '';
      state.cases = (res.data || []).map(normalize);
      state.loaded = true;
      render();
    }, function () { state.error = 'err'; state.loaded = true; render(); });
  }

  /* ── 실시간 구독 ── */
  function subscribe() {
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb || channel) return;
    try {
      channel = sb.channel('gsmgr-cases')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'gukseon_cases' }, function () { load(); })
        .subscribe();
    } catch (e) { /* realtime 미지원이어도 수동 로드로 동작 */ }
  }
  function unsubscribe() {
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (sb && channel) { try { sb.removeChannel(channel); } catch (e) {} }
    channel = null;
  }

  /* ── 렌더 ── */
  var TABS = [
    { key: 'active', label: '진행' },
    { key: 'closed', label: '종결' },
    { key: 'fee', label: '보수' }
  ];

  function render() {
    var tabsBox = document.getElementById('gsmgr-tabs');
    var body = document.getElementById('gsmgr-body');
    if (!tabsBox || !body) return;

    tabsBox.innerHTML = TABS.map(function (t) {
      var n = panelCases(t.key).length;
      return '<button class="gm-tab' + (state.tab === t.key ? ' on' : '') + '" onclick="gsmgrTab(\'' + t.key + '\')">' +
        t.label + '<span class="gm-cnt">' + n + '</span></button>';
    }).join('');

    if (!state.loaded) { body.innerHTML = '<div class="gm-loading">불러오는 중…</div>'; return; }
    if (state.error === 'nosb') { body.innerHTML = '<div class="gm-empty">데이터 연결 준비 중입니다. 잠시 후 다시 열어 주세요.</div>'; return; }
    if (state.error === 'err') { body.innerHTML = '<div class="gm-empty">불러오지 못했습니다. 로그인 상태를 확인해 주세요.</div>'; return; }

    var rows = panelCases(state.tab);
    if (!rows.length) {
      body.innerHTML = '<div class="gm-empty">' +
        (state.tab === 'active' ? '진행 중인 사건이 없습니다.' :
         state.tab === 'closed' ? '종결된 사건이 없습니다.' : '보수 청구한 사건이 없습니다.') +
        '</div>';
      return;
    }
    body.innerHTML = '<div class="gm-card"><table id="' + TABLE_ID + '">' +
      thead(state.tab) + '<tbody>' + rows.map(function (c) { return trow(state.tab, c); }).join('') + '</tbody></table></div>';
  }

  function thead(tab) {
    var cols;
    if (tab === 'active') cols = ['피고인', '사건번호', '사건명', '기일', '메모'];
    else if (tab === 'closed') cols = ['피고인', '사건번호', '사건명', '선고일', '항소', '보수청구'];
    else cols = ['피고인', '사건번호', '선고기일', '보수청구', '보수입금일', '입금액'];
    return '<thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead>';
  }

  function nameCell(c) {
    return '<span class="gm-name" data-tip="' + esc(c.contact) + '">' + (esc(c.defendant) || '—') + '</span>';
  }
  function hearingTag(c) {
    var v = verdictOf(c);
    if (v && !reached(v)) { // 선고기일이 예정(미래)된 진행 사건
      return '<span class="gm-tag tag-sgo">선고</span>' + fmtDate(v);
    }
    var t = c.hearingType || '공판';
    var cls = t === '선고' ? 'tag-sgo' : (t === '선정취소' ? 'tag-cancel' : 'tag-gongpan');
    return '<span class="gm-tag ' + cls + '">' + esc(t) + '</span>' + fmtDate(c.hearingDate);
  }
  function yesNo(v) { return v ? '<span class="gm-yes">O</span>' : '<span class="gm-no">—</span>'; }

  function trow(tab, c) {
    if (tab === 'active') {
      return '<tr>' +
        '<td>' + nameCell(c) + '</td>' +
        '<td class="gm-code">' + esc(c.caseNumber) + '</td>' +
        '<td>' + esc(c.caseName) + '</td>' +
        '<td>' + hearingTag(c) + '</td>' +
        '<td class="gm-memo" title="' + esc(c.todo) + '">' + esc(c.todo) + '</td>' +
      '</tr>';
    }
    if (tab === 'closed') {
      return '<tr>' +
        '<td>' + nameCell(c) + '</td>' +
        '<td class="gm-code">' + esc(c.caseNumber) + '</td>' +
        '<td>' + esc(c.caseName) + '</td>' +
        '<td>' + fmtDate(verdictOf(c)) + '</td>' +
        '<td>' + (c.appeal ? '<span class="gm-yes">' + esc(c.appeal) + '</span>' : yesNo(c.appealStamped)) + '</td>' +
        '<td>' + yesNo(c.claimed) + '</td>' +
      '</tr>';
    }
    // fee
    return '<tr>' +
      '<td>' + nameCell(c) + '</td>' +
      '<td class="gm-code">' + esc(c.caseNumber) + '</td>' +
      '<td>' + fmtDate(verdictOf(c)) + '</td>' +
      '<td>' + yesNo(c.claimed) + '</td>' +
      '<td>' + fmtDate(c.depositDate) + '</td>' +
      '<td>' + (c.depositAmount ? esc(c.depositAmount) : '<span class="gm-no">—</span>') + '</td>' +
    '</tr>';
  }

  /* ── 피고인 hover(PC)/탭(모바일) → 연락처·수감번호 툴팁 ── */
  function tipFor(target, x, y) {
    var tip = document.getElementById('gsmgr-tip');
    if (!tip) return;
    var val = target.getAttribute('data-tip') || '';
    if (!val) { tip.style.display = 'none'; return; }
    tip.innerHTML = '<span class="gm-tip-lbl">연락처 · 수감번호</span><b>' + esc(val) + '</b>';
    tip.style.display = 'block';
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8);
    var top = y - h - 12; if (top < 8) top = y + 18;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  function hideTip() { var t = document.getElementById('gsmgr-tip'); if (t) t.style.display = 'none'; }

  function bindTip() {
    var shell = document.getElementById(SHELL_ID);
    if (!shell || shell._tipBound) return; shell._tipBound = true;
    shell.addEventListener('mouseover', function (e) {
      var t = e.target.closest && e.target.closest('.gm-name');
      if (t) { var r = t.getBoundingClientRect(); tipFor(t, r.left + r.width / 2, r.top); }
    });
    shell.addEventListener('mouseout', function (e) {
      if (e.target.closest && e.target.closest('.gm-name')) hideTip();
    });
    // 모바일: 탭하면 잠깐 표시
    shell.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.gm-name');
      if (t) { var r = t.getBoundingClientRect(); tipFor(t, r.left + r.width / 2, r.top); setTimeout(hideTip, 2200); }
      else hideTip();
    });
  }

  /* ── 외부 API ── */
  window.gsmgrTab = function (k) { state.tab = k; render(); };

  window.goCaseManager = function () {
    ensureUI();
    document.getElementById(SHELL_ID).classList.add('active');
    document.body.style.overflow = 'hidden';
    bindTip();
    if (!state.loaded) render(); // 로딩 표시
    load();
    subscribe();
  };

  window.closeGsmgr = function () {
    var el = document.getElementById(SHELL_ID);
    if (el) el.classList.remove('active');
    document.body.style.overflow = '';
    hideTip();
  };

  /* node 검증/하네스용 (브라우저에선 무시) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { _state: state, normalize: normalize, panelCases: panelCases, render: render, reached: reached };
  }
})();
