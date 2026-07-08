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
     · 기준일 = 선고일(verdictDate, 없으면 hearingType='선고'의 hearingDate) 우선, 없으면 (최근)기일
     · 종결 = 기준일이 오늘 지남(선고든 공판이든)  · 진행 = 미래 기일이거나 기일 없음
     · 보수 = 종결 && claimed(보수청구 체크) — 필터뷰(종결에도 남음)
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
  // <input type=date> 용 YYYY-MM-DD (형식 무관 입력을 정규화)
  function ymdDash(dstr) {
    var m = String(dstr == null ? '' : dstr).match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
    return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
  }

  /* ── 파생 패널 ── */
  // 선고일 = verdictDate 우선, 없으면 hearingType==='선고'일 때 hearingDate
  function verdictOf(c) { return c.verdictDate || (c.hearingType === '선고' ? c.hearingDate : ''); }
  // 사건의 기준 날짜 = 선고일 우선, 없으면 (최근)기일
  function caseDate(c) { return verdictOf(c) || c.hearingDate || ''; }
  // 종결 = 기준 날짜가 오늘 지남(선고든 공판이든). 미래 기일이면 진행.
  function isClosed(c) { return reached(caseDate(c)); }
  function panelCases(tab) {
    var arr = state.cases.filter(function (c) {
      if (tab === 'closed') return isClosed(c);
      if (tab === 'fee') return isClosed(c) && !!c.claimed;
      return !isClosed(c); // active
    });
    arr.sort(function (a, b) {
      if (tab === 'active') { // 기일이 빠른(임박한) 순 — 기일 없는 사건은 맨 뒤
        return (ymd(activeDate(a)) || '99999999').localeCompare(ymd(activeDate(b)) || '99999999');
      }
      // 종결/보수: 최근 선고 먼저
      return ymd(caseDate(b)).localeCompare(ymd(caseDate(a)));
    });
    return arr;
  }
  // 진행 패널의 '기일' = 선고기일 예정 있으면 그것, 없으면 최근 공판기일
  function activeDate(c) { return verdictOf(c) || c.hearingDate || ''; }
  // 날짜(YYYYMMDD) → 오늘 기준 남은 일수(음수=지남)
  function dayDiff(y) {
    if (!y || y.length < 8) return null;
    var d = new Date(+y.slice(0, 4), +y.slice(4, 6) - 1, +y.slice(6, 8));
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  }
  // 임박도 등급 — 색상/강조용 (진행 패널)
  function dueLevel(c) {
    var n = dayDiff(ymd(activeDate(c)));
    if (n == null) return '';
    if (n <= 2) return 'urgent';
    if (n <= 6) return 'soon';
    if (n <= 13) return 'near';
    return 'far';
  }
  // D-day 뱃지 (진행 패널)
  function dueBadge(c) {
    var n = dayDiff(ymd(activeDate(c)));
    if (n == null) return '';
    var lbl = n < 0 ? '지남' : (n === 0 ? 'D-day' : 'D-' + n);
    return '<span class="gm-due due-' + (dueLevel(c) || 'far') + '">' + lbl + '</span>';
  }

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
      '#' + SHELL_ID + ' .gm-body{flex:1;overflow:auto;padding:6px 10px 16px;-webkit-overflow-scrolling:touch;}',
      '#' + SHELL_ID + ' .gm-card{background:#fff;border:1px solid rgba(22,38,63,.10);border-radius:14px;',
        'box-shadow:0 10px 30px -22px rgba(20,40,70,.3);overflow:hidden;max-width:none;margin:0;}',
      '#' + SHELL_ID + ' table{width:100%;border-collapse:collapse;font-size:14px;table-layout:fixed;}',
      '#' + SHELL_ID + ' thead th{position:sticky;top:0;background:#f4f7fb;color:#41537a;font-weight:700;',
        'font-size:12.5px;text-align:left;padding:12px 14px;border-bottom:1.5px solid rgba(22,38,63,.14);white-space:nowrap;z-index:1;}',
      '#' + SHELL_ID + ' tbody td{padding:13px 14px;border-bottom:1px solid rgba(22,38,63,.07);vertical-align:middle;}',
      '#' + SHELL_ID + ' tbody tr:hover{background:#f7faff;}',
      '#' + SHELL_ID + ' tbody tr:last-child td{border-bottom:none;}',
      /* 사건명·사건번호: 넘치면 … 로 줄임(메모칸을 최대한 확보) */
      '#' + SHELL_ID + ' .gm-clip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#' + SHELL_ID + ' .gm-name{font-weight:700;color:#16263f;cursor:default;position:relative;',
        'border-bottom:1px dotted rgba(22,38,63,.4);}',
      '#' + SHELL_ID + ' .gm-code{font-family:\'IBM Plex Mono\',monospace;color:#243d5e;font-size:13px;',
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      /* 임박 기일 D-day 뱃지 + 행 강조(진행 패널) */
      '#' + SHELL_ID + ' .gm-due{display:inline-block;margin-left:8px;font-size:11px;font-weight:800;',
        'padding:2px 8px;border-radius:999px;vertical-align:middle;letter-spacing:.02em;}',
      '#' + SHELL_ID + ' .due-urgent{background:#fdecea;color:#b23a2e;}',
      '#' + SHELL_ID + ' .due-soon{background:#fff1e6;color:#c2620f;}',
      '#' + SHELL_ID + ' .due-near{background:#fdf6e3;color:#8a6d10;}',
      '#' + SHELL_ID + ' .due-far{background:#eef2f9;color:#5b6b86;}',
      '#' + SHELL_ID + ' tr.u-urgent td:first-child{box-shadow:inset 3px 0 0 #d64027;}',
      '#' + SHELL_ID + ' tr.u-soon td:first-child{box-shadow:inset 3px 0 0 #e0872e;}',
      '#' + SHELL_ID + ' tr.u-urgent:hover{background:#fef6f4;}',
      '#' + SHELL_ID + ' .gm-tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-right:6px;}',
      '#' + SHELL_ID + ' .tag-gongpan{background:#e7eefb;color:#1a4ea2;}',
      '#' + SHELL_ID + ' .tag-sgo{background:#fdecea;color:#b23a2e;}',
      '#' + SHELL_ID + ' .tag-cancel{background:#eef0f2;color:#6b7280;}',
      '#' + SHELL_ID + ' .gm-yes{color:#1a7f3c;font-weight:700;}',
      '#' + SHELL_ID + ' .gm-no{color:#9aa6b8;}',
      '#' + SHELL_ID + ' .gm-memo{color:#444;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#' + SHELL_ID + ' .gm-memocell{max-width:300px;}',
      /* 인라인 편집(메모·항소·입금액) */
      '#' + SHELL_ID + ' .gm-inline{display:inline-block;min-height:19px;min-width:48px;padding:5px 8px;margin:-5px -6px;',
        'border-radius:8px;cursor:text;outline:none;color:#333;white-space:pre-wrap;word-break:break-word;transition:background .1s;}',
      '#' + SHELL_ID + ' .gm-inline:empty::before{content:attr(data-ph);color:#b3bccb;}',
      '#' + SHELL_ID + ' .gm-inline:hover{background:#eef3fb;}',
      '#' + SHELL_ID + ' .gm-inline:focus{background:#fff;box-shadow:0 0 0 1.5px #16263f;}',
      /* 인라인 날짜(보수입금일) */
      '#' + SHELL_ID + ' .gm-inline-date{height:34px;border:1.5px solid rgba(22,38,63,.18);border-radius:8px;padding:0 8px;',
        'font:inherit;font-size:13px;color:#243d5e;background:#fff;outline:none;cursor:pointer;}',
      '#' + SHELL_ID + ' .gm-inline-date:focus{border-color:#16263f;box-shadow:0 0 0 2px rgba(22,38,63,.12);}',
      /* 인라인 토글(보수청구) */
      '#' + SHELL_ID + ' .gm-toggle{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:28px;',
        'padding:0 12px;border-radius:999px;border:1.5px solid rgba(22,38,63,.18);background:#fff;cursor:pointer;',
        'font-weight:700;font-size:13px;color:#9aa6b8;font-family:inherit;transition:.12s;}',
      '#' + SHELL_ID + ' .gm-toggle:hover{border-color:#16263f;}',
      '#' + SHELL_ID + ' .gm-toggle.on{background:#e8f5ec;border-color:#1a7f3c;color:#1a7f3c;}',
      '#' + SHELL_ID + ' .gm-empty{padding:60px 20px;text-align:center;color:#8a97ab;font-size:14px;}',
      '#' + SHELL_ID + ' .gm-loading{padding:60px 20px;text-align:center;color:#8a97ab;font-size:14px;}',
      /* 수감번호/연락처 툴팁 */
      '#' + SHELL_ID + ' .gm-tip{position:fixed;z-index:1200;background:#16263f;color:#fff;font-size:12.5px;',
        'padding:8px 12px;border-radius:10px;box-shadow:0 12px 30px rgba(12,25,45,.4);pointer-events:none;',
        'max-width:260px;line-height:1.5;display:none;}',
      '#' + SHELL_ID + ' .gm-tip b{color:#EAF1F9;}',
      '#' + SHELL_ID + ' .gm-tip .gm-tip-lbl{color:#9fb4d6;font-size:10.5px;letter-spacing:.04em;display:block;margin-bottom:2px;}',
      /* 앱바 버튼 */
      '#' + SHELL_ID + ' .gm-add{border:none;background:linear-gradient(155deg,#22344f,#16263f);color:#fff;font-weight:600;',
        'font-size:13.5px;height:38px;padding:0 16px;border-radius:999px;cursor:pointer;font-family:inherit;}',
      '#' + SHELL_ID + ' .gm-add:hover{background:linear-gradient(155deg,#2a3e5c,#1b2e4b);}',
      '#' + SHELL_ID + ' .gm-legacy{border:1px solid rgba(22,38,63,.2);background:#fff;color:#5b6b86;font-weight:600;',
        'font-size:12.5px;height:38px;padding:0 12px;border-radius:999px;cursor:pointer;font-family:inherit;}',
      '#' + SHELL_ID + ' .gm-legacy:hover{background:#eef2f9;}',
      /* 추가 모달 */
      '#gsmgr-add{display:none;position:fixed;inset:0;z-index:1300;background:rgba(12,19,34,.5);',
        'align-items:center;justify-content:center;padding:20px;font-family:var(--font,sans-serif);}',
      '#gsmgr-add.on{display:flex;}',
      '#gsmgr-add .ga-box{width:100%;max-width:440px;max-height:88vh;overflow:auto;background:#fff;',
        'border-radius:20px;box-shadow:0 40px 90px -30px rgba(12,25,45,.55);padding:22px 22px 20px;}',
      '#gsmgr-add .ga-h{font-family:\'Noto Serif KR\',serif;font-size:19px;font-weight:600;color:#16263f;margin-bottom:4px;}',
      '#gsmgr-add .ga-sub{font-size:12.5px;color:#5b6b86;margin-bottom:14px;}',
      '#gsmgr-add .ga-search{position:relative;}',
      '#gsmgr-add input,#gsmgr-add .ga-seg{width:100%;box-sizing:border-box;}',
      '#gsmgr-add .ga-input{height:46px;border:1.5px solid rgba(22,38,63,.2);border-radius:12px;padding:0 14px;',
        'font-size:15px;font-family:inherit;outline:none;background:#fff;color:#1a1a1a;}',
      '#gsmgr-add .ga-input:focus{border-color:#16263f;box-shadow:0 0 0 3px rgba(22,38,63,.12);}',
      '#gsmgr-add .ga-results{margin-top:8px;border:1px solid rgba(22,38,63,.12);border-radius:12px;overflow:hidden;}',
      '#gsmgr-add .ga-item{padding:11px 14px;cursor:pointer;border-bottom:1px solid rgba(22,38,63,.07);}',
      '#gsmgr-add .ga-item:last-child{border-bottom:none;}',
      '#gsmgr-add .ga-item:hover{background:#f4f7fb;}',
      '#gsmgr-add .ga-item .ga-nm{font-weight:700;color:#16263f;}',
      '#gsmgr-add .ga-item .ga-meta{font-size:12px;color:#5b6b86;margin-top:2px;}',
      '#gsmgr-add .ga-empty{padding:12px 14px;font-size:13px;color:#8a97ab;}',
      '#gsmgr-add .ga-manual{margin-top:10px;text-align:center;}',
      '#gsmgr-add .ga-manual button{border:1px dashed rgba(22,38,63,.3);background:#fff;color:#41537a;',
        'font-weight:600;font-size:13px;padding:10px 14px;border-radius:12px;cursor:pointer;width:100%;font-family:inherit;}',
      '#gsmgr-add .ga-field{margin-top:12px;}',
      '#gsmgr-add .ga-lbl{font-size:12.5px;font-weight:600;color:#41537a;margin-bottom:5px;display:block;}',
      '#gsmgr-add .ga-row{display:flex;gap:8px;}',
      '#gsmgr-add .ga-seg{display:flex;gap:6px;}',
      '#gsmgr-add .ga-seg button{flex:1;height:40px;border:1.5px solid rgba(22,38,63,.18);background:#fff;',
        'color:#41537a;font-weight:600;font-size:13px;border-radius:10px;cursor:pointer;font-family:inherit;}',
      '#gsmgr-add .ga-seg button.on{background:#16263f;border-color:#16263f;color:#fff;}',
      '#gsmgr-add .ga-warn{margin-top:12px;background:#fdf0ee;border:1px solid #f2c9c2;color:#a5352a;',
        'font-size:12.5px;padding:9px 12px;border-radius:10px;}',
      '#gsmgr-add .ga-btns{display:flex;gap:8px;margin-top:18px;}',
      '#gsmgr-add .ga-cancel{flex:0 0 auto;padding:0 18px;height:46px;border:1px solid rgba(22,38,63,.18);',
        'background:#fff;color:#41537a;font-weight:600;border-radius:12px;cursor:pointer;font-family:inherit;}',
      '#gsmgr-add .ga-save{flex:1;height:46px;border:none;background:linear-gradient(155deg,#22344f,#16263f);',
        'color:#fff;font-weight:700;font-size:15px;border-radius:12px;cursor:pointer;font-family:inherit;}',
      '#gsmgr-add .ga-save:disabled{opacity:.5;cursor:default;}',
      '#gsmgr-add .ga-loading{font-size:12px;color:#8a97ab;padding:8px 2px;}',
      '#gsmgr-add .ga-del{flex:0 0 auto;padding:0 16px;height:46px;border:1.5px solid #d9b3ad;',
        'background:#fff;color:#b23a2e;font-weight:600;border-radius:12px;cursor:pointer;font-family:inherit;}',
      '#gsmgr-add .ga-del:hover{background:#fdf0ee;}',
      '#gsmgr-add .ga-check{display:flex;align-items:center;gap:9px;font-size:14px;color:#1a1a1a;',
        'padding:11px 12px;border:1.5px solid rgba(22,38,63,.14);border-radius:12px;cursor:pointer;user-select:none;}',
      '#gsmgr-add .ga-check input{width:18px;height:18px;accent-color:#16263f;margin:0;cursor:pointer;}',
      '#' + SHELL_ID + ' .gm-row{cursor:pointer;}',
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
        '<button class="gm-add" onclick="gsmgrOpenAdd()">＋ 사건 추가</button>' +
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
  function load(cb) {
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb) { state.error = 'nosb'; render(); return; }
    sb.from('gukseon_cases').select('id,data').then(function (res) {
      if (res && res.error) { state.error = 'err'; state.loaded = true; render(); return; }
      state.error = '';
      state.cases = (res.data || []).map(normalize);
      state.loaded = true;
      render();
      if (typeof cb === 'function') cb();
    }, function () { state.error = 'err'; state.loaded = true; render(); });
  }

  /* ── 로웨어(cases) 기일 자동 반영 ──
     화면 열 때, 저장된 사건번호로 cases 를 다시 조회해 next_date(공판기일)/next_contents(종류)를
     기준으로 기일을 최신화한다. 로웨어 값이 가장 정확하므로 국선 화면의 기존 기일을 덮어쓴다.
     (단, 로웨어에 다음 기일이 비어 있으면 지난 기일을 지우지 않도록 그냥 둔다) */
  function syncFromLoware() {
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb || !state.cases.length) return;
    var codes = state.cases.map(function (c) { return c.caseNumber; }).filter(Boolean);
    if (!codes.length) return;
    sb.from('cases').select('l_code,next_date,next_contents').in('l_code', codes).then(function (res) {
      if (!res || res.error || !res.data) return;
      var map = {};
      res.data.forEach(function (r) { map[normCode(r.l_code)] = r; });
      var changed = [];
      state.cases.forEach(function (c) {
        var r = map[normCode(c.caseNumber)];
        if (!r || !r.next_date) return;                 // 로웨어에 다음 기일 없음 → 유지
        var nd = String(r.next_date).slice(0, 10);
        var isSgo = /선고/.test(r.next_contents || '');
        var ht = isSgo ? '선고' : '공판';
        var sameDate = ymd(c.hearingDate) === ymd(nd);
        var sameType = c.hearingType === ht;
        var sameVerdict = !isSgo || ymd(c.verdictDate) === ymd(nd);
        if (sameDate && sameType && sameVerdict) return; // 변경 없음
        var raw = Object.assign({}, c._raw || {}); raw.id = c.id;
        raw.hearingType = ht; raw.hearingDate = nd;
        c.hearingType = ht; c.hearingDate = nd;
        if (isSgo && nd) { raw.verdictDate = nd; c.verdictDate = nd; } // 선고기일은 세팅(공판일 땐 기존 선고기일 유지)
        c._raw = raw;
        changed.push({ id: c.id, data: raw, updated_at: new Date().toISOString() });
      });
      if (changed.length) {
        render();
        changed.forEach(function (u) { sb.from('gukseon_cases').upsert(u).then(function () {}, function () {}); });
      }
    }, function () {});
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
      colgroup(state.tab) + thead(state.tab) +
      '<tbody>' + rows.map(function (c) { return trow(state.tab, c); }).join('') + '</tbody></table></div>';
  }

  // 열 너비 — 메모칸을 가장 넓게, 사건명은 좁게(엑셀에서 메모가 가장 중요)
  function colgroup(tab) {
    var w;
    if (tab === 'active') w = ['11%', '15%', '17%', '18%', '39%'];       // 피고인·사건번호·사건명·기일·메모
    else if (tab === 'closed') w = ['13%', '18%', '25%', '17%', '15%', '12%'];
    else w = ['15%', '20%', '19%', '13%', '19%', '14%'];
    return '<colgroup>' + w.map(function (x) { return '<col style="width:' + x + '">'; }).join('') + '</colgroup>';
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
      var lv = dueLevel(c);
      var ucls = (lv === 'urgent' || lv === 'soon') ? ' u-' + lv : '';
      return '<tr data-id="' + esc(c.id) + '" class="gm-row' + ucls + '">' +
        '<td>' + nameCell(c) + '</td>' +
        '<td class="gm-code">' + esc(c.caseNumber) + '</td>' +
        '<td class="gm-clip" title="' + esc(c.caseName) + '">' + esc(c.caseName) + '</td>' +
        '<td>' + hearingTag(c) + dueBadge(c) + '</td>' +
        '<td class="gm-memocell"><div class="gm-inline" contenteditable="true" data-id="' + esc(c.id) + '" data-field="todo" data-ph="메모 입력…">' + esc(c.todo) + '</div></td>' +
      '</tr>';
    }
    if (tab === 'closed') {
      return '<tr data-id="' + esc(c.id) + '" class="gm-row">' +
        '<td>' + nameCell(c) + '</td>' +
        '<td class="gm-code">' + esc(c.caseNumber) + '</td>' +
        '<td class="gm-clip" title="' + esc(c.caseName) + '">' + esc(c.caseName) + '</td>' +
        '<td>' + fmtDate(caseDate(c)) + '</td>' +
        '<td><span class="gm-inline" contenteditable="true" data-id="' + esc(c.id) + '" data-field="appeal" data-ph="항소 입력…">' + esc(c.appeal) + '</span></td>' +
        '<td>' + claimToggle(c) + '</td>' +
      '</tr>';
    }
    // fee
    return '<tr data-id="' + esc(c.id) + '" class="gm-row">' +
      '<td>' + nameCell(c) + '</td>' +
      '<td class="gm-code">' + esc(c.caseNumber) + '</td>' +
      '<td>' + fmtDate(caseDate(c)) + '</td>' +
      '<td>' + claimToggle(c) + '</td>' +
      '<td><input type="date" class="gm-inline-date" data-id="' + esc(c.id) + '" data-field="depositDate" value="' + esc(ymdDash(c.depositDate)) + '"></td>' +
      '<td><span class="gm-inline" contenteditable="true" data-id="' + esc(c.id) + '" data-field="depositAmount" data-ph="입금액…">' + esc(c.depositAmount) + '</span></td>' +
    '</tr>';
  }
  function claimToggle(c) {
    return '<button type="button" class="gm-toggle' + (c.claimed ? ' on' : '') + '" data-id="' + esc(c.id) +
      '" onclick="gsmgrToggleClaim(this)">' + (c.claimed ? 'O' : '—') + '</button>';
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
    // 클릭: 인라인 편집 요소는 통과, 피고인은 툴팁, 그 외 행은 편집 패널
    shell.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.gm-inline,.gm-inline-date,.gm-toggle')) return; // 인라인 편집 요소
      var t = e.target.closest && e.target.closest('.gm-name');
      if (t) { // 피고인 클릭 = 연락처/수감번호 툴팁만 (편집 안 열림)
        var r = t.getBoundingClientRect(); tipFor(t, r.left + r.width / 2, r.top); setTimeout(hideTip, 2200);
        return;
      }
      hideTip();
      var row = e.target.closest && e.target.closest('.gm-row');
      if (row && row.getAttribute('data-id')) gsmgrEdit(row.getAttribute('data-id'));
    });
    // 인라인(텍스트·메모): 포커스 잃을 때 저장, Enter 로 확정
    shell.addEventListener('focusout', function (e) {
      var m = e.target.closest && e.target.closest('.gm-inline');
      if (m) saveField(m.getAttribute('data-id'), m.getAttribute('data-field'), inlineText(m));
    });
    shell.addEventListener('keydown', function (e) {
      var m = e.target.closest && e.target.closest('.gm-inline');
      if (m && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); m.blur(); }
    });
    // 날짜(보수입금일): 값 바뀌면 즉시 저장
    shell.addEventListener('change', function (e) {
      var d = e.target.closest && e.target.closest('.gm-inline-date');
      if (d) saveField(d.getAttribute('data-id'), d.getAttribute('data-field'), d.value || '');
    });
  }
  // 인라인 요소 텍스트 정규화(개행/특수공백 정리)
  function inlineText(el) { return String(el.innerText || el.textContent || '').replace(/[\u00a0\u2007\u202f]/g, ' ').trim(); }
  // 인라인 공통 저장: 지정 필드 하나만 덮어쓰고 나머지(feeForm·항소·보수 등) 전부 보존
  function saveField(id, field, value) {
    if (!id || !field) return;
    var c = state.cases.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var nv = (field === 'claimed' || field === 'appealStamped') ? !!value : value;
    if (String(c[field] == null ? '' : c[field]) === String(nv == null ? '' : nv)) return; // 변경 없음
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb) { render(); return; }
    var raw = Object.assign({}, c._raw || {}); raw.id = c.id; raw[field] = nv;
    c[field] = nv; c._raw = raw; // 낙관적 반영
    sb.from('gukseon_cases').upsert({ id: c.id, data: raw, updated_at: new Date().toISOString() })
      .then(function (res) { if (res && res.error) { load(); } }, function () { load(); });
  }
  // 보수청구 토글(종결/보수 패널) — 체크하면 보수 패널로 이동, 해제하면 빠짐
  window.gsmgrToggleClaim = function (el) {
    var id = el.getAttribute('data-id');
    var c = state.cases.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    saveField(id, 'claimed', !c.claimed);
    render();
  };

  /* ══════════════════════════════════════════════════════════════
     [Phase 2] 사건 추가: 검색(cases) → 자동채움(+court-lookup 선고일) → 저장(upsert)
     ══════════════════════════════════════════════════════════════ */
  var addForm = null;          // 폼 단계 데이터
  var addSearchTimer = null;

  function cleanCaseName(n) { return String(n == null ? '' : n).replace(/^\s*\[[^\]]*\]\s*/, ''); }
  function normCode(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }

  function feeFormDefault(court) {
    return { r1: false, r2: false, r3: false, r4: false, r5: false, r6: false, r12: false, r13: false,
      visit_t: '', visit_o: '', person_t: '', person_o: '', attend_t: '', attend_o: '', witness_t: '', witness_o: '',
      outcourt: '', exp_visit: '', copy: '', interp_chk: false, interp_amt: '', travel_chk: false, travel_amt: '',
      etc: '', writeDate: '', attorney: '', rrn: '', court: court || '', courtDiv: '', stamped: false };
  }
  function newId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  }
  function makeCaseData(f) {
    var id = newId();
    return {
      id: id, defendant: f.defendant || '', contact: f.contact || '',
      caseNumber: f.caseNumber || '', caseName: f.caseName || '',
      hearingType: f.hearingType || '공판', hearingDate: f.hearingDate || '',
      todo: f.todo || '', claimed: false, feeForm: feeFormDefault(f.court),
      verdictDate: f.verdictDate || '', depositDate: '', depositAmount: '',
      appeal: '', appealStamped: false
    };
  }

  /* court-lookup 엣지 함수: 사건번호 → { court_dept(재판부), judgment_date(선고일) } */
  function courtLookup(caseNo, lNum, cb) {
    var base = (window.SUPABASE_URL || 'https://nyjyemjsperpakrrgzcc.supabase.co');
    var key = (window.SUPABASE_KEY || 'sb_publishable_QKl9MIt2_MflYnpN41VRvg_cNIAbYhU');
    fetch(base + '/functions/v1/court-lookup', {
      method: 'POST', headers: { 'content-type': 'application/json', 'apikey': key },
      body: JSON.stringify({ schKey: String(caseNo || ''), schVal: String(lNum || '') })
    }).then(function (r) { return r.json(); }).then(function (d) { cb(d || {}); }, function () { cb({}); });
  }

  function injectAddModal() {
    if (document.getElementById('gsmgr-add')) return;
    var el = document.createElement('div');
    el.id = 'gsmgr-add';
    el.addEventListener('click', function (e) { if (e.target === el) closeAdd(); });
    el.innerHTML = '<div class="ga-box" id="ga-box"></div>';
    document.body.appendChild(el);
  }

  window.gsmgrOpenAdd = function () {
    injectAddModal();
    addForm = null;
    document.getElementById('gsmgr-add').classList.add('on');
    renderAddSearch();
    setTimeout(function () { var i = document.getElementById('ga-q'); if (i) i.focus(); }, 60);
  };
  window.closeAdd = function () { var m = document.getElementById('gsmgr-add'); if (m) m.classList.remove('on'); };

  /* ── 1단계: 검색 (입력창은 한 번만 생성 → 타이핑 중 포커스/커서 안 튐. 결과만 갱신) ── */
  function renderAddSearch() {
    var box = document.getElementById('ga-box');
    if (!box) return;
    box.innerHTML =
      '<div class="ga-h">사건 추가</div>' +
      '<div class="ga-sub">의뢰인 이름 또는 사건번호로 검색하세요.</div>' +
      '<div class="ga-search"><input id="ga-q" class="ga-input" placeholder="의뢰인 또는 사건번호" autocomplete="off"></div>' +
      '<div id="ga-reslist"></div>' +
      '<div class="ga-manual"><button onclick="gsmgrManual()">＋ 창고에 없음 · 직접 입력</button></div>' +
      '<div class="ga-btns"><button class="ga-cancel" style="flex:1" onclick="closeAdd()">닫기</button></div>';
    var input = document.getElementById('ga-q');
    input.addEventListener('input', function () {
      var v = input.value.trim();
      clearTimeout(addSearchTimer);
      if (v.length < 2) { setResults(''); return; }
      setResults('<div class="ga-results"><div class="ga-loading" style="padding:12px 14px">사건 찾는 중…</div></div>');
      addSearchTimer = setTimeout(function () { doSearch(v); }, 250);
    });
  }
  function setResults(html) { var r = document.getElementById('ga-reslist'); if (r) r.innerHTML = html; }
  function renderResults(rows) {
    if (!rows || !rows.length) { setResults('<div class="ga-results"><div class="ga-empty">검색 결과가 없습니다. 창고에 없으면 직접 입력하세요.</div></div>'); return; }
    window._gsmgrRows = rows;
    setResults('<div class="ga-results">' + rows.map(function (r, i) {
      var nm = esc(r.l_client || '(이름 없음)');
      var meta = [esc(r.l_code || ''), esc(cleanCaseName(r.l_name) || '')].filter(Boolean).join(' · ');
      return '<div class="ga-item" onclick="gsmgrPick(' + i + ')"><div class="ga-nm">' + nm + '</div><div class="ga-meta">' + meta + '</div></div>';
    }).join('') + '</div>');
  }
  function doSearch(q) {
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb) { renderResults([]); return; }
    var cq = q.replace(/[,%()]/g, '').trim();
    sb.from('cases').select('l_num,l_code,l_name,l_client,court,next_date,next_contents')
      .or('l_client.ilike.%' + cq + '%,l_code.ilike.%' + cq + '%').limit(8)
      .then(function (res) {
        var cur = document.getElementById('ga-q');
        if (!cur || cur.value.trim() !== q) return; // 입력이 바뀌면 무시
        renderResults((res && res.data) ? res.data : []);
      }, function () { renderResults([]); });
  }

  window.gsmgrPick = function (i) {
    var r = (window._gsmgrRows || [])[i]; if (!r) return;
    // 다음 기일 = cases.next_date (공판기일). next_contents 로 종류(선고/공판) 판별
    var isSgo = /선고/.test(r.next_contents || '');
    var nd = r.next_date ? String(r.next_date).slice(0, 10) : '';
    var f = { defendant: r.l_client || '', caseNumber: r.l_code || '', caseName: cleanCaseName(r.l_name),
      court: r.court || '', hearingType: isSgo ? '선고' : '공판', hearingDate: nd,
      verdictDate: (isSgo && nd) ? nd : '', contact: '', todo: '', lNum: r.l_num || '' };
    renderAddForm(f, true);
    // 로웨어 선고일/재판부 보조 조회(과거 판결선고일 등)
    courtLookup(f.caseNumber, f.lNum, function (d) {
      if (!addForm) return;
      if (d.judgment_date && !addForm.verdictDate) { addForm.verdictDate = String(d.judgment_date).slice(0, 10); }
      if (d.court_dept && !addForm.court) { addForm.court = d.court_dept; }
      renderAddForm(addForm, false);
    });
  };
  window.gsmgrManual = function () {
    renderAddForm({ defendant: '', caseNumber: '', caseName: '', court: '', hearingType: '공판', hearingDate: '', verdictDate: '', contact: '', todo: '', lNum: '' }, true);
  };

  /* ── 2단계: 폼(자동채움 결과 + 나머지 입력) ── */
  function dupCase(codeNorm) {
    if (!codeNorm) return false;
    return state.cases.some(function (c) { return normCode(c.caseNumber) === codeNorm; });
  }
  function renderAddForm(f, focusFirst) {
    addForm = f;
    var box = document.getElementById('ga-box');
    if (!box) return;
    var dup = dupCase(normCode(f.caseNumber));
    box.innerHTML =
      '<div class="ga-h">사건 정보 확인</div>' +
      '<div class="ga-sub">자동으로 채워진 값을 확인하고 기일·수감번호·메모를 입력하세요.</div>' +
      field('피고인', '<input id="gf-defendant" class="ga-input" value="' + esc(f.defendant) + '">') +
      field('사건번호', '<input id="gf-caseNumber" class="ga-input" value="' + esc(f.caseNumber) + '" oninput="gsmgrDup()">') +
      field('사건명', '<input id="gf-caseName" class="ga-input" value="' + esc(f.caseName) + '">') +
      field('재판부', '<input id="gf-court" class="ga-input" value="' + esc(f.court) + '">') +
      '<div class="ga-field"><span class="ga-lbl">기일</span>' +
        '<div class="ga-seg" id="gf-htype">' +
          seg('공판', f.hearingType) + seg('선고', f.hearingType) + seg('선정취소', f.hearingType) +
        '</div>' +
        '<div style="height:8px"></div>' +
        '<input id="gf-hearingDate" class="ga-input" type="date" value="' + esc(f.hearingDate) + '">' +
      '</div>' +
      field('선고기일 (자동/선택)', '<input id="gf-verdictDate" class="ga-input" type="date" value="' + esc(f.verdictDate) + '">') +
      field('연락처 · 수감번호', '<input id="gf-contact" class="ga-input" placeholder="예: 0421(인천구치소) 또는 010-…" value="' + esc(f.contact) + '">') +
      field('메모 (해야 할 것)', '<input id="gf-todo" class="ga-input" value="' + esc(f.todo) + '">') +
      '<div class="ga-warn" id="gf-warn" style="' + (dup ? '' : 'display:none') + '">이미 같은 사건번호의 사건이 목록에 있습니다. 그래도 추가하려면 저장을 누르세요.</div>' +
      '<div class="ga-btns"><button class="ga-cancel" onclick="gsmgrOpenAdd()">‹ 검색</button>' +
        '<button class="ga-save" id="gf-save" onclick="gsmgrAddSave()">저장</button></div>';
    if (focusFirst) setTimeout(function () { var i = document.getElementById('gf-defendant'); if (i) i.focus(); }, 40);
  }
  function field(label, inner) { return '<div class="ga-field"><span class="ga-lbl">' + label + '</span>' + inner + '</div>'; }
  function seg(t, cur) { return '<button type="button" class="' + (cur === t ? 'on' : '') + '" onclick="gsmgrSeg(this,\'' + t + '\')">' + t + '</button>'; }
  window.gsmgrSeg = function (btn, t) {
    if (addForm) addForm.hearingType = t;
    var wrap = btn.parentNode; if (wrap) wrap.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === btn); });
  };
  window.gsmgrDup = function () {
    var code = (document.getElementById('gf-caseNumber') || {}).value || '';
    var w = document.getElementById('gf-warn'); if (w) w.style.display = dupCase(normCode(code)) ? '' : 'none';
  };

  window.gsmgrAddSave = function () {
    var g = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
    var f = {
      defendant: g('gf-defendant').trim(), caseNumber: g('gf-caseNumber').trim(), caseName: g('gf-caseName').trim(),
      court: g('gf-court').trim(), hearingType: (addForm && addForm.hearingType) || '공판',
      hearingDate: g('gf-hearingDate'), verdictDate: g('gf-verdictDate'),
      contact: g('gf-contact').trim(), todo: g('gf-todo').trim()
    };
    if (!f.defendant && !f.caseNumber) { alert('피고인 또는 사건번호를 입력하세요.'); return; }
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb) { alert('데이터 연결 준비 중입니다. 잠시 후 다시 시도하세요.'); return; }
    var data = makeCaseData(f);
    var btn = document.getElementById('gf-save'); if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    sb.from('gukseon_cases').upsert({ id: data.id, data: data, updated_at: new Date().toISOString() })
      .then(function (res) {
        if (res && res.error) { if (btn) { btn.disabled = false; btn.textContent = '저장'; } alert('저장 실패: ' + (res.error.message || '권한/연결 확인')); return; }
        // 낙관적 반영(실시간이 곧 덮어씀)
        state.cases.push(normalize({ id: data.id, data: data }));
        render();
        closeAdd();
      }, function () { if (btn) { btn.disabled = false; btn.textContent = '저장'; } alert('저장 중 오류가 발생했습니다.'); });
  };

  /* ══════════════════════════════════════════════════════════════
     [Phase 3] 행 클릭 → 상세 패널 편집/삭제 (기존 필드 전부 보존)
     ══════════════════════════════════════════════════════════════ */
  var editState = null;

  window.gsmgrEdit = function (id) {
    var c = state.cases.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    injectAddModal();
    editState = c;
    addForm = { hearingType: c.hearingType || '공판' };
    document.getElementById('gsmgr-add').classList.add('on');
    renderEditForm(c);
  };

  function courtOf(c) { return (c._raw && c._raw.feeForm && c._raw.feeForm.court) || ''; }

  function renderEditForm(c) {
    var box = document.getElementById('ga-box');
    if (!box) return;
    box.innerHTML =
      '<div class="ga-h">사건 편집</div>' +
      '<div class="ga-sub">' + (esc(c.defendant) || '—') + ' · ' + (esc(c.caseNumber) || '') + '</div>' +
      field('피고인', '<input id="gf-defendant" class="ga-input" value="' + esc(c.defendant) + '">') +
      field('사건번호', '<input id="gf-caseNumber" class="ga-input" value="' + esc(c.caseNumber) + '">') +
      field('사건명', '<input id="gf-caseName" class="ga-input" value="' + esc(c.caseName) + '">') +
      '<div class="ga-field"><span class="ga-lbl">기일</span>' +
        '<div class="ga-seg" id="gf-htype">' + seg('공판', c.hearingType) + seg('선고', c.hearingType) + seg('선정취소', c.hearingType) + '</div>' +
        '<div style="height:8px"></div>' +
        '<input id="gf-hearingDate" class="ga-input" type="date" value="' + esc(c.hearingDate) + '">' +
      '</div>' +
      field('선고기일', '<input id="gf-verdictDate" class="ga-input" type="date" value="' + esc(c.verdictDate) + '">') +
      field('연락처 · 수감번호', '<input id="gf-contact" class="ga-input" value="' + esc(c.contact) + '">') +
      '<div class="ga-btns">' +
        '<button class="ga-del" onclick="gsmgrDelete()">삭제</button>' +
        '<button class="ga-save" id="gf-save" onclick="gsmgrEditSave()">저장</button>' +
      '</div>';
  }

  window.gsmgrEditSave = function () {
    var c = editState; if (!c) return;
    var g = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb) { alert('데이터 연결 준비 중입니다.'); return; }
    // 기존 데이터(메모·항소·보수·feeForm 등) 전부 보존하고 편집 대상 6개만 덮어씀
    var raw = Object.assign({}, c._raw || {});
    raw.id = c.id;
    raw.defendant = g('gf-defendant').trim();
    raw.caseNumber = g('gf-caseNumber').trim();
    raw.caseName = g('gf-caseName').trim();
    raw.hearingType = (addForm && addForm.hearingType) || c.hearingType || '공판';
    raw.hearingDate = g('gf-hearingDate');
    raw.verdictDate = g('gf-verdictDate');
    raw.contact = g('gf-contact').trim();
    var btn = document.getElementById('gf-save'); if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    sb.from('gukseon_cases').upsert({ id: c.id, data: raw, updated_at: new Date().toISOString() })
      .then(function (res) {
        if (res && res.error) { if (btn) { btn.disabled = false; btn.textContent = '저장'; } alert('저장 실패: ' + (res.error.message || '권한/연결 확인')); return; }
        // 낙관적 반영
        for (var i = 0; i < state.cases.length; i++) { if (state.cases[i].id === c.id) { state.cases[i] = normalize({ id: c.id, data: raw }); break; } }
        render();
        closeAdd();
      }, function () { if (btn) { btn.disabled = false; btn.textContent = '저장'; } alert('저장 중 오류가 발생했습니다.'); });
  };

  window.gsmgrDelete = function () {
    var c = editState; if (!c) return;
    if (!window.confirm('이 사건을 삭제할까요?\n' + (c.defendant || '') + ' ' + (c.caseNumber || ''))) return;
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb) { alert('데이터 연결 준비 중입니다.'); return; }
    sb.from('gukseon_cases').delete().in('id', [c.id]).then(function (res) {
      if (res && res.error) { alert('삭제 실패: ' + (res.error.message || '권한/연결 확인')); return; }
      state.cases = state.cases.filter(function (x) { return x.id !== c.id; });
      render();
      closeAdd();
    }, function () { alert('삭제 중 오류가 발생했습니다.'); });
  };

  /* ── 외부 API ── */
  window.gsmgrTab = function (k) { state.tab = k; render(); };

  window.goCaseManager = function () {
    ensureUI();
    document.getElementById(SHELL_ID).classList.add('active');
    document.body.style.overflow = 'hidden';
    bindTip();
    if (!state.loaded) render(); // 로딩 표시
    load(syncFromLoware);        // 로드 후 로웨어 기일 자동 반영
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
