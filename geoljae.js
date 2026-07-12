/* 법무법인 정서 — 결재함 (geoljae.js)
   ───────────────────────────────────────────────────────────────
   목적: 어쏘 변호사가 "어떤 사건의 · 어떤 서면을 · 언제까지 확인해야 하는지"를 올리면,
         서고은 파트너가 마감 임박순으로 모아 보고 확인한 것은 체크로 치운다.
   본질: 서면 원문 열람도, 결재 도장 같은 격식도 없다. "무엇을 언제까지 확인할지" 아는 체크 시스템.

   화면 2개 (index.html의 screen 컨테이너에 그려 넣는다):
     · 결재 요청 (어쏘)  screen-gyeoljae-req  → openReq()
     · 결재함   (서고은) screen-gyeoljae      → open()

   데이터: 정서 Supabase(getSB)의 reviews 테이블(id/data/updated_at) 1건=1행.
           국선관리(gsmgr.js)와 동일한 load + Realtime 구독 + 낙관적 잠금 저장.

   재사용: autofill.js(initAutofillFor·data-af) · util.js(JU) · gukseon.js 직원 명단 키.
   로그인: 지금은 공용 계정 → 요청자를 명단에서 선택. 추후 개인 로그인 도입 시
           getRequester() 한 곳만 세션 사용자로 바꾸면 된다.
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var STYLE_ID = 'gj-style';
  var REQ_KEY  = 'gj_requesters';            // 결재 요청자 명단(전용 키, 추가분 기억)
  var LAST_KEY = 'gj_last_staff';            // 마지막으로 고른 '본인' 기억
  var REQ_SEED = ['박종덕', '서석원', '이예나', '한우철'];

  var state = { reviews: [], loaded: false, error: '', tab: 'pending', staff: 'all', sort: 'due' };
  var channel = null;
  var reloadTimer = null;

  /* ── 공용 도우미 ── */
  function esc(v) { return (window.JU && JU.esc) ? JU.esc(v) : String(v == null ? '' : v); }
  function todayISO() {
    if (window.JU && JU.todayISO) return JU.todayISO();
    var t = new Date();
    return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
  }
  function sbc() { return (typeof getSB === 'function') ? getSB() : null; }
  function loadRequesters() {
    try { var r = localStorage.getItem(REQ_KEY); var a = r ? JSON.parse(r) : null; if (a && a.length) return a; } catch (e) {}
    return REQ_SEED.slice();
  }
  function addRequester(name) {
    name = (name || '').trim(); if (!name) return loadRequesters();
    var list = loadRequesters();
    if (list.indexOf(name) < 0) { list.push(name); try { localStorage.setItem(REQ_KEY, JSON.stringify(list)); } catch (e) {} }
    return list;
  }
  function lastStaff() { try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; } }
  function rememberStaff(n) { try { localStorage.setItem(LAST_KEY, n); } catch (e) {} }
  // 추후 개인 로그인 도입 시 여기만 세션 사용자로 교체하면 전체가 그대로 동작한다.
  function getRequester() {
    var el = document.querySelector('#gj-who .gj-who-chip.on');
    return el ? el.getAttribute('data-name') : '';
  }

  /* ── 날짜 ── */
  function dparse(s) { var m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function ymd(s) { var m = String(s || '').match(/(\d{4})[-.\/]?(\d{1,2})[-.\/]?(\d{1,2})/); return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : ''; }
  function daysTo(iso) { var d = dparse(iso); if (!d) return null; return Math.round((d - dparse(todayISO())) / 86400000); }
  function ddayLabel(n) { if (n == null) return '기한 미정'; if (n < 0) return 'D+' + (-n) + ' 초과'; if (n === 0) return '오늘'; return 'D-' + n; }
  function ddClass(n) { if (n == null) return 'd-none'; if (n < 0) return 'd-over'; if (n <= 2) return 'd-soon'; return 'd-ok'; }
  function shortWhen(iso) {
    var m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) { var d = ymd(iso); return d ? d.slice(5) : ''; }
    return m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5];
  }

  /* ── 스타일 (한 번만 주입) ── */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '.gj-wrap{max-width:760px;margin:0 auto;padding:14px 14px 90px;}',
      /* 요약 타일 */
      '.gj-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:4px 0 14px;}',
      '.gj-tile{background:var(--card,#fff);border:1px solid var(--border,#e8e8e8);border-radius:14px;padding:12px 14px;position:relative;overflow:hidden;}',
      '.gj-tile .k{font-size:11.5px;color:var(--muted,#8b93a2);font-weight:600;}',
      '.gj-tile .v{font-size:26px;font-weight:800;letter-spacing:-.02em;margin-top:3px;font-variant-numeric:tabular-nums;}',
      '.gj-tile .v small{font-size:13px;font-weight:600;color:var(--muted,#8b93a2);margin-left:2px;}',
      '.gj-tile .rail{position:absolute;left:0;top:0;bottom:0;width:3px;background:#c6ae74;opacity:.55;}',
      '.gj-tile.alert{border-color:#e2b6b0;background:#fdf5f4;}.gj-tile.alert .v{color:#c0392b;}.gj-tile.alert .rail{background:#c0392b;opacity:1;}',
      '.gj-tile.warn .v{color:#b67514;}.gj-tile.warn .rail{background:#b67514;opacity:.9;}',
      /* 요청자 칩 */
      '.gj-chips{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:11px;}',
      '.gj-chip{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;border:1px solid var(--border,#e8e8e8);background:var(--card,#fff);cursor:pointer;font-size:13px;font-weight:600;color:var(--ink-soft,#44566f);}',
      '.gj-chip.on{background:#16263f;color:#fff;border-color:#16263f;}',
      '.gj-chip .ct{font-size:11.5px;font-weight:700;min-width:16px;height:17px;padding:0 5px;border-radius:9px;display:inline-grid;place-items:center;background:#eef0f3;color:#44566f;font-variant-numeric:tabular-nums;}',
      '.gj-chip.on .ct{background:rgba(255,255,255,.22);color:#fff;}',
      /* 서브바 */
      '.gj-subbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;}',
      '.gj-tabs{display:inline-flex;background:var(--card2,#f6f5f1);border:1px solid var(--border,#e8e8e8);border-radius:11px;padding:3px;gap:2px;}',
      '.gj-tab{border:none;background:transparent;padding:6px 14px;border-radius:8px;font:inherit;font-size:13px;font-weight:700;color:var(--muted,#8b93a2);cursor:pointer;}',
      '.gj-tab.on{background:var(--card,#fff);color:#16263f;box-shadow:0 1px 3px rgba(22,38,63,.12);}',
      '.gj-sort{border:none;background:transparent;font:inherit;font-size:13px;font-weight:600;color:var(--muted,#8b93a2);cursor:pointer;display:inline-flex;align-items:center;gap:5px;}',
      '.gj-sort:hover{color:#16263f;}',
      /* 행 */
      '.gj-list{display:flex;flex-direction:column;gap:9px;}',
      '.gj-row{background:var(--card,#fff);border:1px solid var(--border,#e8e8e8);border-radius:14px;display:flex;gap:12px;align-items:center;padding:13px 15px;position:relative;overflow:hidden;box-shadow:0 1px 2px rgba(22,38,63,.04);}',
      '.gj-row .st{position:absolute;left:0;top:0;bottom:0;width:4px;background:#c6ae74;}',
      '.gj-row.d-over .st{background:#c0392b;}.gj-row.d-soon .st{background:#b67514;}.gj-row.d-none .st{background:#cbd2db;}',
      '.gj-main{min-width:0;flex:1;}',
      '.gj-l1{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.gj-type{font-size:10.5px;font-weight:800;letter-spacing:.03em;color:#a8863f;border:1px solid #e6dcc2;background:#faf6ea;padding:2px 7px;border-radius:6px;}',
      '.gj-lead{font-size:16.5px;font-weight:800;letter-spacing:-.02em;color:var(--ink,#16263f);}',
      '.gj-dot{width:3px;height:3px;border-radius:50%;background:#c6ae74;flex:none;}',
      '.gj-title{font-size:14px;font-weight:600;letter-spacing:-.01em;color:var(--ink-soft,#5a6675);}',
      '.gj-row.done .gj-lead{text-decoration:line-through;text-decoration-color:#9aa6b8;}',
      '.gj-l2{font-size:12px;color:var(--muted,#8b93a2);margin-top:5px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;}',
      '.gj-l2 .rq{color:#3f5170;font-weight:700;}',
      '.gj-l2 .sep{width:3px;height:3px;border-radius:50%;background:#cbd2db;}',
      '.gj-right{display:flex;flex-direction:column;align-items:flex-end;gap:9px;flex:none;}',
      '.gj-dday{font-size:12px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap;font-variant-numeric:tabular-nums;background:#f2f3f5;color:#44566f;}',
      '.d-over .gj-dday{background:#f7e4e1;color:#c0392b;}.d-soon .gj-dday{background:#f6ecd7;color:#b67514;}',
      '.gj-check{width:30px;height:30px;border-radius:9px;border:1.6px solid var(--border,#dfe3e8);background:var(--card,#fff);cursor:pointer;display:grid;place-items:center;color:transparent;}',
      '.gj-check:hover{border-color:#a8863f;}',
      '.gj-check svg{width:16px;height:16px;}',
      '.gj-acts{display:flex;gap:7px;align-items:center;}',
      '.gj-del{width:30px;height:30px;border-radius:9px;border:1.6px solid var(--border,#dfe3e8);background:var(--card,#fff);color:#9aa6b8;cursor:pointer;display:grid;place-items:center;}',
      '.gj-del:hover{border-color:#c0392b;color:#c0392b;}',
      '.gj-del svg{width:15px;height:15px;}',
      '.gj-row.done{opacity:.6;}',
      '.gj-row.done .gj-title{text-decoration:line-through;text-decoration-color:#9aa6b8;}',
      '.gj-row.done .gj-check{background:#3e7c59;border-color:#3e7c59;color:#fff;}',
      /* 비어있음 */
      '.gj-empty{text-align:center;padding:48px 18px;color:var(--muted,#8b93a2);border:1px dashed var(--border,#e0e0e0);border-radius:14px;background:var(--card2,#faf9f6);}',
      '.gj-empty b{color:var(--ink,#16263f);}',
      /* 요청 폼 보조 */
      '.gj-hint{font-size:12px;color:var(--muted,#8b93a2);margin:-2px 0 8px;}',
      '.gj-req-badge{font-size:11px;font-weight:700;color:#a8863f;}',
      /* 요청자 선택 칩 */
      '.gj-who{display:flex;flex-wrap:wrap;gap:8px;}',
      '.gj-who-chip{padding:9px 16px;border-radius:999px;border:1.5px solid var(--border,#dfe3e8);background:var(--card,#fff);color:var(--ink-soft,#44566f);font:inherit;font-size:14px;font-weight:600;cursor:pointer;}',
      '.gj-who-chip:hover{border-color:#a8863f;}',
      '.gj-who-chip.on{background:#16263f;border-color:#16263f;color:#fff;}',
      '.gj-who-add{padding:9px 15px;border-radius:999px;border:1.5px dashed var(--border,#cfd6df);background:transparent;color:var(--muted,#8b93a2);font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;}',
      '.gj-who-add:hover{border-color:#a8863f;color:#a8863f;}',
      /* 다크 */
      '@media (prefers-color-scheme:dark){',
      '.gj-tile,.gj-row,.gj-chip,.gj-check,.gj-del,.gj-who-chip{background:#162232;border-color:#233145;}',
      '.gj-del{color:#6e7d92;}.gj-who-chip{color:#aab7c9;}.gj-who-chip.on{background:#33507e;border-color:#33507e;color:#fff;}',
      '.gj-tile .v,.gj-lead{color:#eaf0f8;}.gj-title{color:#9fb0c6;}.gj-chip{color:#aab7c9;}.gj-chip .ct{background:#223146;color:#aab7c9;}',
      '.gj-tabs{background:#131e2c;border-color:#233145;}.gj-tab.on{background:#162232;color:#eaf0f8;}',
      '.gj-type{background:#20304a;border-color:#3a4f70;color:#cbab63;}',
      '.gj-tile.alert{background:#2a1a1a;border-color:#5a2e2e;}.gj-tile.alert .v{color:#e36457;}',
      '.gj-empty{background:#131e2c;border-color:#233145;}.gj-empty b{color:#eaf0f8;}',
      '.gj-dday{background:#1d2a3b;color:#aab7c9;}.d-over .gj-dday{background:#3a2320;color:#e36457;}.d-soon .gj-dday{background:#33290f;color:#d69a3b;}',
      '}'
    ].join('');
    var s = document.createElement('style'); s.id = STYLE_ID; s.textContent = css;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════
     데이터 (Supabase reviews)
     ══════════════════════════════════════════════════════════════ */
  function normalize(row) {
    var d = (row && row.data) || {};
    return {
      id: row.id, requester: d.requester || '', caseNo: d.caseNo || '', caseName: d.caseName || '', clientName: d.clientName || '',
      caseId: d.caseId || '', docType: d.docType || '', docTitle: d.docTitle || '',
      dueDate: d.dueDate || '', status: d.status || 'pending', createdAt: d.createdAt || '',
      doneAt: d.doneAt || '', _raw: d, _updatedAt: (row && row.updated_at) || null
    };
  }
  function load(cb) {
    var sb = sbc();
    if (!sb) { state.error = 'nosb'; render(); return; }
    sb.from('reviews').select('id,data,updated_at').then(function (res) {
      if (res && res.error) { state.error = 'err'; state.loaded = true; render(); return; }
      state.error = '';
      state.reviews = (res.data || []).map(normalize);
      state.loaded = true;
      render();
      setBadge(pendingList().length);   // 결재 pill 배지도 함께 갱신
      if (typeof cb === 'function') cb();
    }, function () { state.error = 'err'; state.loaded = true; render(); });
  }

  /* ── 홈 「결재」 pill 대기 건수 배지 (국선 setPillBadge 방식) ── */
  function setBadge(n) {
    var el = document.getElementById('hp-badge-gyeoljae');
    if (!el) return;
    if (n > 0) { el.textContent = n > 99 ? '99+' : n; el.hidden = false; }
    else { el.hidden = true; }
    if (typeof window.hpSyncMenuDot === 'function') window.hpSyncMenuDot();
  }
  // 결재함을 열지 않아도(홈 복귀·부팅) 대기 건수만 가볍게 세어 배지 갱신
  function updateBadge() {
    var sb = sbc(); if (!sb || typeof sb.from !== 'function') return;   // 초기화 중 부분 클라이언트 방어
    sb.from('reviews').select('id,data').then(function (res) {
      if (res && res.error) return;
      var n = (res.data || []).filter(function (r) {
        var d = (r && r.data) || {}; return (d.status || 'pending') !== 'done';
      }).length;
      setBadge(n);
    }, function () {});
  }
  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(function () { load(); }, 250); }
  function subscribe() {
    var sb = sbc(); if (!sb || channel) return;
    try {
      channel = sb.channel('gj-reviews')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, function () { scheduleReload(); })
        .subscribe();
    } catch (e) { /* realtime 미지원이어도 수동 로드로 동작 */ }
  }

  /* ══════════════════════════════════════════════════════════════
     (A) 결재 요청 화면 — 어쏘
     ══════════════════════════════════════════════════════════════ */
  function openReq() { injectStyle(); renderReqForm(); }
  function renderReqForm() {
    var body = document.getElementById('gj-req-body');
    var foot = document.getElementById('gj-req-foot');
    if (!body) return;

    body.innerHTML =
      '<div class="fs-section">요청자</div>' +
      '<div class="gj-hint">본인 이름을 선택하세요. 없으면 ＋추가로 등록할 수 있어요.</div>' +
      '<div class="fs-field"><div class="gj-who" id="gj-who"></div></div>' +

      '<div class="fs-section">사건</div>' +
      '<div class="gj-hint">의뢰인명 또는 사건번호로 검색하면 사건번호·사건명이 채워집니다.</div>' +
      '<div class="fs-field"><label class="fs-label">사건번호</label><input type="text" class="fs-input" id="gj-casenum" data-af="l_code" placeholder="2026가합1234"></div>' +
      '<div class="fs-field"><label class="fs-label">사건명</label><input type="text" class="fs-input" id="gj-casename" data-af="l_name" placeholder="대여금 청구"></div>' +
      '<div class="fs-field"><label class="fs-label">의뢰인</label><input type="text" class="fs-input" id="gj-client" data-af="l_client" placeholder="홍길동"></div>' +

      '<div class="fs-section">서면</div>' +
      '<div class="fs-field"><label class="fs-label">제목</label><input type="text" class="fs-input" id="gj-doctitle" placeholder="예: 원고 제3준비서면"></div>' +

      '<div class="fs-section">확인 기한</div>' +
      '<div class="gj-hint">서고은 변호사가 언제까지 확인해야 하는지 정해 주세요.</div>' +
      '<div class="fs-field"><label class="fs-label">확인 기한</label><input type="date" class="fs-input" id="gj-duedate"></div>';

    if (foot) {
      foot.innerHTML =
        '<button class="fs-btn ghost" id="gj-req-cancel">취소</button>' +
        '<button class="fs-btn primary" id="gj-req-submit">결재 요청 올리기</button>';
      foot.querySelector('#gj-req-cancel').onclick = function () { showScreen('screen-home'); };
      foot.querySelector('#gj-req-submit').onclick = submitReq;
    }

    // 요청자 칩(버튼) — 클릭 선택 + ＋추가. 마지막으로 고른 이름을 기본 선택.
    var who = document.getElementById('gj-who');
    function renderWho(selected) {
      var list = loadRequesters();
      var html = list.map(function (n) {
        return '<button type="button" class="gj-who-chip' + (n === selected ? ' on' : '') + '" data-name="' + esc(n) + '">' + esc(n) + '</button>';
      }).join('');
      html += '<button type="button" class="gj-who-add" id="gj-who-add">＋ 추가</button>';
      who.innerHTML = html;
      Array.prototype.forEach.call(who.querySelectorAll('.gj-who-chip'), function (c) {
        c.onclick = function () {
          Array.prototype.forEach.call(who.querySelectorAll('.gj-who-chip'), function (x) { x.classList.remove('on'); });
          c.classList.add('on');
        };
      });
      document.getElementById('gj-who-add').onclick = function () {
        var name = prompt('추가할 요청자 이름을 입력하세요.');
        if (name === null) return;
        name = name.trim(); if (!name) return;
        addRequester(name);
        renderWho(name);   // 방금 추가한 이름을 선택 상태로 다시 그림
      };
    }
    renderWho(lastStaff());

    // 사건 자동완성 부착(검색카드가 사건번호 칸 위에 생김)
    if (window.initAutofillFor) initAutofillFor('gj-casenum');
  }

  function submitReq() {
    var requester = getRequester();
    var caseNo = (document.getElementById('gj-casenum').value || '').trim();
    var caseName = (document.getElementById('gj-casename').value || '').trim();
    var clientName = (document.getElementById('gj-client').value || '').trim();
    var docTitle = (document.getElementById('gj-doctitle').value || '').trim();
    var dueDate = (document.getElementById('gj-duedate').value || '').trim();

    if (!requester) { alert('요청자(본인 이름)를 선택해 주세요.'); return; }
    if (!docTitle) { alert('서면 제목을 입력해 주세요.'); return; }

    var btn = document.getElementById('gj-req-submit');
    if (btn) { btn.disabled = true; btn.textContent = '올리는 중…'; }

    var sb = sbc();
    if (!sb) { alert('연결을 확인해 주세요.'); if (btn) { btn.disabled = false; btn.textContent = '결재 요청 올리기'; } return; }

    var now = new Date().toISOString();
    var id = 'r_' + now.replace(/\D/g, '') + '_' + Math.floor(Math.random() * 1e6);
    var data = {
      requester: requester, caseNo: caseNo, caseName: caseName, clientName: clientName,
      caseId: '', docTitle: docTitle,
      dueDate: dueDate, status: 'pending', createdAt: now, doneAt: null
    };
    sb.from('reviews').upsert({ id: id, data: data, updated_at: now }).then(function (res) {
      if (res && res.error) { alert('저장 중 오류가 발생했습니다.'); if (btn) { btn.disabled = false; btn.textContent = '결재 요청 올리기'; } return; }
      rememberStaff(requester);
      if (typeof showToast === 'function') showToast('결재 요청을 올렸습니다.');
      showScreen('screen-home');
    }, function () {
      alert('저장 중 오류가 발생했습니다.');
      if (btn) { btn.disabled = false; btn.textContent = '결재 요청 올리기'; }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     (B) 결재함 화면 — 서고은
     ══════════════════════════════════════════════════════════════ */
  function open() {
    injectStyle();
    if (!state.loaded) render();   // 로딩 표시
    load();
    subscribe();
  }
  function pendingList() { return state.reviews.filter(function (r) { return r.status !== 'done'; }); }

  function render() {
    var box = document.getElementById('gj-inbox');
    if (!box) return;
    if (!state.loaded) { box.innerHTML = '<div class="gj-empty">불러오는 중…</div>'; return; }
    if (state.error) { box.innerHTML = '<div class="gj-empty"><b>목록을 불러오지 못했습니다.</b><br>로그인 상태를 확인해 주세요.</div>'; return; }

    var p = pendingList();
    var over = p.filter(function (r) { var n = daysTo(r.dueDate); return n != null && n < 0; }).length;
    var today = p.filter(function (r) { return daysTo(r.dueDate) === 0; }).length;

    // 요약 타일
    var html = '<div class="gj-stats">' +
      tile('확인 대기', p.length, '건', '') +
      tile('기한 초과', over, '건', over > 0 ? 'alert' : '') +
      tile('오늘 마감', today, '건', today > 0 ? 'warn' : '') + '</div>';

    // 요청자 칩
    var names = [];
    p.forEach(function (r) { if (r.requester && names.indexOf(r.requester) < 0) names.push(r.requester); });
    names.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    html += '<div class="gj-chips"><button class="gj-chip' + (state.staff === 'all' ? ' on' : '') + '" data-staff="all">전체<span class="ct">' + p.length + '</span></button>';
    names.forEach(function (n) {
      var c = p.filter(function (r) { return r.requester === n; }).length;
      html += '<button class="gj-chip' + (state.staff === n ? ' on' : '') + '" data-staff="' + esc(n) + '">' + esc(n) + '<span class="ct">' + c + '</span></button>';
    });
    html += '</div>';

    // 서브바
    html += '<div class="gj-subbar"><div class="gj-tabs">' +
      '<button class="gj-tab' + (state.tab === 'pending' ? ' on' : '') + '" data-tab="pending">확인 대기</button>' +
      '<button class="gj-tab' + (state.tab === 'done' ? ' on' : '') + '" data-tab="done">확인 완료</button></div>' +
      '<button class="gj-sort" id="gj-sortbtn">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><path d="M3 6h11M3 12h8M3 18h5"/><path d="M18 8v10m0 0l-3-3m3 3l3-3"/></svg>' +
        (state.sort === 'due' ? '마감 임박순' : '요청자별') + '</button></div>';

    // 목록
    var rows = state.reviews.filter(function (r) {
      var isDone = r.status === 'done';
      if (state.tab === 'pending' && isDone) return false;
      if (state.tab === 'done' && !isDone) return false;
      if (state.staff !== 'all' && r.requester !== state.staff) return false;
      return true;
    });
    if (state.sort === 'due') rows.sort(byDue);
    else rows.sort(function (a, b) { return a.requester.localeCompare(b.requester, 'ko') || byDue(a, b); });

    if (!rows.length) {
      html += '<div class="gj-empty"><b>' +
        (state.tab === 'pending' ? '확인할 서면이 없습니다.' : '확인 완료한 서면이 아직 없습니다.') + '</b><br>' +
        (state.tab === 'pending' ? '올라온 요청을 모두 확인하셨습니다.' : '확인 체크한 서면이 여기에 쌓입니다.') + '</div>';
    } else {
      html += '<div class="gj-list">' + rows.map(rowHtml).join('') + '</div>';
    }

    box.innerHTML = html;
    wire(box);
  }

  function byDue(a, b) {
    var na = daysTo(a.dueDate), nb = daysTo(b.dueDate);
    if (na == null) na = 1e9; if (nb == null) nb = 1e9;
    return na - nb;
  }
  function tile(k, v, unit, cls) {
    return '<div class="gj-tile ' + cls + '"><span class="rail"></span><div class="k">' + k + '</div>' +
      '<div class="v">' + v + '<small>' + unit + '</small></div></div>';
  }
  function rowHtml(r) {
    var n = daysTo(r.dueDate);
    var done = r.status === 'done';
    var cls = ddClass(n) + (done ? ' done' : '');
    var meta = ['<span class="rq">' + esc(r.requester || '요청자?') + '</span>'];
    if (r.caseNo) meta.push('<span class="mi">' + esc(r.caseNo) + '</span>');
    if (r.caseName) meta.push('<span class="mi">' + esc(r.caseName) + '</span>');
    if (r.createdAt) meta.push('<span class="mi">올림 ' + esc(shortWhen(r.createdAt)) + '</span>');
    var metaHtml = meta.join('<span class="sep"></span>');
    var lead = r.clientName ? '<span class="gj-lead">' + esc(r.clientName) + '</span><span class="gj-dot"></span>' : '';
    var title = esc(r.docTitle || r.docType || '(제목 없음)');
    return '<div class="gj-row ' + cls + '" data-id="' + esc(r.id) + '">' +
      '<span class="st"></span>' +
      '<div class="gj-main"><div class="gj-l1">' + lead + '<span class="gj-title">' + title + '</span></div>' +
        '<div class="gj-l2">' + metaHtml + '</div></div>' +
      '<div class="gj-right"><span class="gj-dday">' + ddayLabel(n) + '</span>' +
        '<div class="gj-acts">' +
          '<button class="gj-check" title="' + (done ? '대기로 되돌리기' : '확인함') + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></button>' +
          '<button class="gj-del" title="삭제">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg></button>' +
        '</div>' +
      '</div></div>';
  }

  function wire(box) {
    Array.prototype.forEach.call(box.querySelectorAll('.gj-chip'), function (b) {
      b.onclick = function () { state.staff = b.getAttribute('data-staff'); render(); };
    });
    Array.prototype.forEach.call(box.querySelectorAll('.gj-tab'), function (b) {
      b.onclick = function () { state.tab = b.getAttribute('data-tab'); render(); };
    });
    var sb = box.querySelector('#gj-sortbtn');
    if (sb) sb.onclick = function () { state.sort = (state.sort === 'due') ? 'staff' : 'due'; render(); };
    Array.prototype.forEach.call(box.querySelectorAll('.gj-row'), function (el) {
      var id = el.getAttribute('data-id');
      var chk = el.querySelector('.gj-check');
      if (chk) chk.onclick = function () { toggleDone(id, el.classList.contains('done')); };
      var del = el.querySelector('.gj-del');
      if (del) del.onclick = function () { removeReview(id); };
    });
  }

  /* ── 삭제: 대기·완료 어디서든 (되돌릴 수 없어 확인 대화상자) ── */
  function removeReview(id) {
    var r = find(id); if (!r) return;
    var label = r.docTitle || r.docType || '이 요청';
    if (!confirm('“' + label + '”을(를) 삭제할까요?\n되돌릴 수 없습니다.')) return;
    // 낙관적 로컬 제거 → 즉시 UI
    state.reviews = state.reviews.filter(function (x) { return x.id !== id; });
    render();
    setBadge(pendingList().length);

    var sb = sbc(); if (!sb) return;
    sb.from('reviews').delete().eq('id', id).then(function (res) {
      if (res && res.error) { load(); return; }   // 실패 시 서버 상태로 복구
      if (typeof showToast === 'function') showToast('삭제했습니다.');
    }, function () { load(); });
  }

  /* ── 확인 체크: pending ↔ done (낙관적 잠금 저장) ── */
  function toggleDone(id, isDone) {
    var r = find(id); if (!r) return;
    var newStatus = isDone ? 'pending' : 'done';
    var now = new Date().toISOString();
    // 로컬 낙관적 반영 → 즉시 UI
    r.status = newStatus; r.doneAt = (newStatus === 'done') ? now : null;
    r._raw.status = newStatus; r._raw.doneAt = r.doneAt;
    render();

    var sb = sbc(); if (!sb) return;
    var payload = { data: r._raw, updated_at: now };
    var q = sb.from('reviews').update(payload).eq('id', id);
    if (r._updatedAt != null) q = q.eq('updated_at', r._updatedAt);  // 낙관적 잠금
    q.then(function (res) {
      if (res && res.error) { load(); return; }
      r._updatedAt = now;
      if (typeof showToast === 'function') showToast(newStatus === 'done' ? '확인함으로 표시했습니다.' : '다시 대기로 옮겼습니다.');
    }, function () { load(); });
  }
  function find(id) { for (var i = 0; i < state.reviews.length; i++) if (state.reviews[i].id === id) return state.reviews[i]; return null; }

  /* ── 외부 노출 ── */
  window.gyeoljae = { open: open, openReq: openReq, updateBadge: updateBadge };
  window.gyeoljaeUpdateBadge = updateBadge;   // showScreen 홈 복귀 훅에서 호출

  /* ── 부팅: 첫 홈 진입에 배지 숫자 표시 (세션 준비까지 몇 번 재시도) ── */
  (function bootBadge() {
    var tries = 0;
    (function attempt() {
      if (sbc()) { updateBadge(); return; }
      if (++tries > 20) return;   // ~4초까지 대기
      setTimeout(attempt, 200);
    })();
  })();
})();
