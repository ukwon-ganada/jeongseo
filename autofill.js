/* 법무법인 정서 - 사건 자동완성 (autofill.js)
   목적: 서면 폼 맨 위의 "의뢰인 또는 사건번호" 검색카드에 입력하면
         Supabase 창고(cases)에서 사건을 찾아 나머지 칸을 자동으로 채운다.
   대상: 항소장 / 형사 선임계 / 민가사 선임계 (검색카드 방식으로 일원화)
   원칙: 기존 index.html 폼 구조를 건드리지 않는 독립 모듈.
         진입점: initAppealAutofill / initSeonimAutofill / initMingasaAutofill,
                 새 서면용 범용 진입점 initAutofillFor(anchorId) — data-af 표준(파일 하단 참고).
   메모: 지금은 로그인 없이 동작(테스트용 RLS 임시 해제 전제).
         추후 로그인 붙일 때 getSB() 세션만 살아있으면 그대로 동작함. */
(function(){
  'use strict';

  var STYLE_ID = 'af-style';
  var MIN_NAME = 2;   // 이름은 2글자부터 검색
  var MIN_CODE = 2;   // 사건번호 숫자는 2글자부터 검색
  var LIMIT = 10;     // 후보 최대 개수
  var deptCache = {}; // 재판부·선고일 캐시: l_num -> {court_dept, judgment_date}

  // 사건명 앞의 [전자] 표시 제거
  function cleanCaseName(name){
    return String(name || '').replace(/\[전자\]\s*/g, '').trim();
  }
  // 날짜를 date 입력칸 형식(YYYY-MM-DD)으로 정규화
  function normalizeDate(s){
    var m = String(s || '').match(/(\d{4})[-.\/]?(\d{1,2})[-.\/]?(\d{1,2})/);
    if (!m) return '';
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }

  /* ── 스타일 주입 (한 번만) ── */
  function injectStyle(){
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.af-drop{position:absolute;top:100%;left:0;right:0;z-index:10050;'
      + 'background:#fff;border:1px solid var(--border,#e8e8e8);border-top:none;'
      + 'border-radius:0 0 12px 12px;max-height:260px;overflow-y:auto;'
      + 'box-shadow:0 8px 24px rgba(0,0,0,0.10);font-family:inherit;}'
      + '.af-drop.hide{display:none;}'
      + '.af-item{padding:11px 14px;cursor:pointer;border-bottom:1px solid #f2f2f2;'
      + 'display:flex;flex-direction:column;gap:2px;}'
      + '.af-item:last-child{border-bottom:none;}'
      + '.af-item:hover,.af-item.on{background:#f7f7f7;}'
      + '.af-code{font-size:14px;font-weight:600;color:#1a1a1a;letter-spacing:-0.01em;}'
      + '.af-sub{font-size:12px;color:#999;}'
      + '.af-empty{padding:13px 14px;font-size:13px;color:#bbb;}'
      + '.af-loading{padding:13px 14px;font-size:13px;color:#bbb;}'
      // ── 상단 검색카드 (검정 반전) ──
      + '.af-card{margin:0 0 6px;}'
      + '.af-searchbox{position:relative;display:flex;align-items:center;gap:8px;'
      + 'background:#1a1a1a;border:1.5px solid #1a1a1a;border-radius:9px;padding:10px 12px;}'
      + '.af-searchbox svg{width:17px;height:17px;color:#fff;flex:none;}'
      + '.af-search-input{flex:1;min-width:0;border:none;outline:none;background:transparent;'
      + 'color:#fff;font-size:13px;font-family:inherit;padding:0;-webkit-appearance:none;}'
      + '.af-search-input::placeholder{color:rgba(255,255,255,0.55);}';
    var s = document.createElement('style');
    s.id = STYLE_ID; s.textContent = css;
    document.head.appendChild(s);
  }

  /* ── 디바운스: 타이핑이 멈춘 뒤에만 검색 ── */
  function debounce(fn, ms){
    var t = null;
    return function(){
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function(){ fn.apply(self, args); }, ms);
    };
  }

  /* ── input 아래에 붙는 드롭다운 요소 확보 ── */
  function getDrop(inputEl){
    var field = inputEl.closest('.fs-field') || inputEl.parentNode;
    field.style.position = 'relative';
    var drop = field.querySelector('.af-drop');
    if (!drop){
      drop = document.createElement('div');
      drop.className = 'af-drop hide';
      field.appendChild(drop);
    }
    return drop;
  }

  function hideDrop(inputEl){
    var field = inputEl.closest('.fs-field') || inputEl.parentNode;
    var drop = field && field.querySelector('.af-drop');
    if (drop) drop.classList.add('hide');
  }

  /* ── Supabase 검색 ──
     mode: 'name'  → 의뢰인(피고인) 이름으로
           'code'  → 사건번호로 (뒷자리 숫자 포함 매칭) */
  function search(mode, query, cb){
    var sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb){ cb('nosb', []); return; }
    var like = '%' + query + '%';
    var builder = sb.from('cases')
      .select('l_num,l_code,l_name,l_client,court,client_position,next_date,next_contents');
    if (mode === 'both'){
      // 의뢰인명(l_client) 또는 사건번호(l_code) 어느 쪽이든 매칭
      builder = builder.or('l_client.ilike.' + like + ',l_code.ilike.' + like);
    } else {
      var col = (mode === 'name') ? 'l_client' : 'l_code';
      builder = builder.ilike(col, like);
    }
    builder
      .limit(LIMIT)
      .then(function(res){
        if (res && res.error){ console.error('[autofill] 검색 오류:', res.error.message || res.error); cb('err', []); return; }
        cb(null, (res && res.data) ? res.data : []);
      }, function(e){ console.error('[autofill] 요청 실패:', e); cb('err', []); });
  }

  /* ── 후보 목록 그리기 ── */
  function renderList(inputEl, rows, filler){
    var drop = getDrop(inputEl);
    drop.innerHTML = '';
    if (!rows.length){
      drop.innerHTML = '<div class="af-empty">일치하는 사건이 없습니다</div>';
      drop.classList.remove('hide');
      return;
    }
    rows.forEach(function(r){
      var item = document.createElement('div');
      item.className = 'af-item';
      var code = [r.l_code, cleanCaseName(r.l_name)].filter(Boolean).join(' ') || '(사건번호 없음)';
      var sub = r.l_client || '';
      item.innerHTML = '<span class="af-code"></span><span class="af-sub"></span>';
      item.querySelector('.af-code').textContent = code;
      item.querySelector('.af-sub').textContent = sub;
      // mousedown: input blur 전에 먼저 실행되어 클릭 유실 방지
      item.addEventListener('mousedown', function(e){
        e.preventDefault();
        filler(r);
        drop.classList.add('hide');
      });
      drop.appendChild(item);
    });
    drop.classList.remove('hide');
  }

  /* ── 폼 칸 채우기 (항소장) ──
     매핑: 사건번호 ap-casenum ← l_code
           사건명   ap-casename ← l_name
           피고인   ap-defendant ← l_client
           제출법원 ap-court ← court */
  function setVal(id, v){
    var el = document.getElementById(id);
    if (el && v != null && v !== '') el.value = v;
  }
  function fillForm(r){
    setVal('ap-casenum', r.l_code);
    setVal('ap-casename', cleanCaseName(r.l_name));
    setVal('ap-defendant', r.l_client);
    setVal('ap-court', r.court);
    fillCourtDept(r);
  }

  // 재판부를 중계소에서 받아 제출법원 칸에 "법원 재판부"로 덧붙임
  function fillCourtDept(r){
    var courtEl = document.getElementById('ap-court');
    if (!courtEl || !r.l_num || !r.l_code) return;
    var baseCourt = r.court || '';
    // 이미 받아온 적 있으면 캐시 사용 (로그인 잠금 방지)
    if (deptCache[r.l_num] !== undefined){
      var c = deptCache[r.l_num];
      applyDept(courtEl, baseCourt, c.court_dept || '');
      applyJudgmentDate(c.judgment_date || '');
      return;
    }
    fetchCourtDept(r.l_code, r.l_num, function(res){
      deptCache[r.l_num] = res;
      applyDept(courtEl, baseCourt, res.court_dept || '');
      applyJudgmentDate(res.judgment_date || '');
    });
  }

  // 판결 선고일을 항소장 선고일 칸(ap-sentdate)에 채움
  function applyJudgmentDate(jdate){
    var el = document.getElementById('ap-sentdate');
    if (!el) return;
    var norm = normalizeDate(jdate);
    if (norm) el.value = norm;
  }

  // 사용자가 법원 칸을 직접 수정하지 않았을 때만 재판부를 덧붙임
  function applyDept(courtEl, baseCourt, dept){
    if (!dept) return;
    var cur = courtEl.value.trim();
    if (cur === baseCourt.trim() || cur === ''){
      courtEl.value = (baseCourt ? baseCourt + ' ' : '') + dept;
    }
  }

  // 중계소(Supabase Edge Function) 호출: schKey=사건번호, schVal=l_num
  function fetchCourtDept(schKey, schVal, cb){
    var url = (window.SUPABASE_URL || 'https://nyjyemjsperpakrrgzcc.supabase.co') + '/functions/v1/court-lookup';
    var key = window.SUPABASE_KEY || 'sb_publishable_QKl9MIt2_MflYnpN41VRvg_cNIAbYhU';
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'apikey': key },
      body: JSON.stringify({ schKey: String(schKey), schVal: String(schVal) })
    })
      .then(function(res){ return res.json(); })
      .then(function(d){ cb(d || {}); })
      .catch(function(e){ console.warn('[autofill] 재판부/선고일 조회 실패:', e); cb({}); });
  }

  /* ── input에 자동완성 붙이기 (중복 방지) ── */
  function attach(inputEl, mode, filler){
    if (!inputEl || inputEl.dataset.afAttached === '1') return;
    inputEl.dataset.afAttached = '1';

    var minLen = (mode === 'name') ? MIN_NAME : MIN_CODE;

    var run = debounce(function(){
      var q = inputEl.value.trim();
      if (q.length < minLen){ hideDrop(inputEl); return; }
      var drop = getDrop(inputEl);
      drop.innerHTML = '<div class="af-loading">사건 찾는 중…</div>';
      drop.classList.remove('hide');
      search(mode, q, function(errCode, rows){
        // 검색이 끝난 사이 입력이 바뀌었으면 무시
        if (inputEl.value.trim() !== q) return;
        if (errCode === 'nosb'){
          drop.innerHTML = '<div class="af-empty">데이터 연결 준비 중… 잠시 후 다시 시도</div>';
          drop.classList.remove('hide');
          return;
        }
        if (errCode === 'err'){
          drop.innerHTML = '<div class="af-empty">불러오지 못했습니다 (자물쇠 확인 필요)</div>';
          drop.classList.remove('hide');
          return;
        }
        renderList(inputEl, rows, filler);
      });
    }, 250);

    inputEl.addEventListener('input', run);
    inputEl.addEventListener('focus', function(){
      if (inputEl.value.trim().length >= minLen) run();
    });
    inputEl.addEventListener('blur', function(){
      setTimeout(function(){ hideDrop(inputEl); }, 150);
    });
  }

  /* ── 후보 선택 시: 폼을 채운 뒤, 검색칸에 "이름 사건번호 사건명"으로 표시 ── */
  function makeCardFiller(inputEl, filler){
    return function(r){
      filler(r);
      var parts = [r.l_client, r.l_code, cleanCaseName(r.l_name)].filter(Boolean);
      inputEl.value = parts.join(' ');
    };
  }

  /* ── 폼 맨 위에 검색카드 한 장을 얹는다 ──
     anchorEl: 그 폼 안에 확실히 있는 정적 요소(예: 사건번호 칸) → 이걸로 .fs-body를 찾음
     filler  : 그 서면 전용 채우기 함수(fillForm / fillSeonimForm / fillMingasaForm)
     중복 방지: 카드가 이미 있으면 새로 만들지 않고 검색칸만 비운다(폼 재오픈 대비). */
  function buildSearchCard(anchorEl, filler){
    if (!anchorEl) return;
    var fsBody = anchorEl.closest('.fs-body');
    if (!fsBody) return;

    var existing = fsBody.querySelector('.af-card');
    if (existing){
      var exInput = existing.querySelector('.af-search-input');
      if (exInput) exInput.value = '';
      return;
    }

    var card = document.createElement('div');
    card.className = 'af-card';
    card.innerHTML =
      '<div class="af-searchbox">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<circle cx="11" cy="11" r="7"></circle>'
      + '<line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'
      + '<input type="text" class="af-search-input" placeholder="의뢰인 또는 사건번호" '
      + 'autocomplete="off" spellcheck="false">'
      + '</div>';
    fsBody.insertBefore(card, fsBody.firstChild);

    var input = card.querySelector('.af-search-input');
    attach(input, 'both', makeCardFiller(input, filler));
  }

  /* ══════════════════════════════════════════════════════════════
     [data-af 표준] 새 서면용 범용 자동완성  ← 앞으로 새 서면은 이걸 쓴다
     ────────────────────────────────────────────────────────────
     ① 폼 입력칸에 서버(Supabase cases) 컬럼명을 이름표로 단다:
          <input class="fs-input" data-af="l_code">           사건번호
          <input class="fs-input" data-af="l_name">           사건명 ([전자] 자동 제거)
          <input class="fs-input" data-af="l_client">         의뢰인명
          <input class="fs-input" data-af="court">            법원 / 제출기관
          <input class="fs-input" data-af="client_position">  지위 (원고/피고/피고인 등)
     ※ 재판부·선고일(judgment_date)은 서버 조회(edge function)가 따로 필요해 이 기본 표준엔 없음.
       (혹시 검색 결과에 그 값이 들어오면 fillByDataAttr가 date 칸도 알아서 채운다)
     ② 폼이 열릴 때 진입점 한 줄만 부르면 끝:
          if(window.initAutofillFor) initAutofillFor('foo-casenum'); // 폼 안 아무 정적 칸 id
     ※ 기존 3서면(항소장·형사·민가사)은 각자 fill 함수를 계속 쓰므로 이 블록과 무관.
     ══════════════════════════════════════════════════════════════ */
  function fillByDataAttr(scope, row){
    if (!scope || !row) return;
    var nodes = scope.querySelectorAll('[data-af]');
    for (var i = 0; i < nodes.length; i++){
      var el = nodes[i];
      var key = el.getAttribute('data-af');
      var val = row[key];
      if (val == null || val === '') continue;
      if (key === 'l_name') val = cleanCaseName(val);        // 사건명 [전자] 제거
      if (key === 'judgment_date') val = normalizeDate(val); // 날짜 YYYY-MM-DD로
      if (!val) continue;
      el.value = val;
    }
  }

  /* 범용 진입점: anchorId는 폼 안의 정적 입력칸 id(이걸로 .fs-body를 찾는다)
     opts.courtDept: 재판부를 채울 칸 id (선택). data-af 표준 밖이라 여기서 서버 조회로 처리.
       → 사건 선택 시 fillByDataAttr 후, 같은 사건번호로 court-lookup을 불러 재판부만 채움.
     opts.sentDate: 선고일(judgment_date)을 채울 칸 id (선택). 같은 court-lookup 결과 재사용.
       기존 호출 initAutofillFor('id') 는 opts 없이 그대로 동작(영향 없음). */
  // 창고 행에서 선고일 직접 추출: 다음 기일 종류가 '선고'면 그 기일(next_date)이 선고일.
  // court-lookup(느린 조회)에 의존하지 않고 즉시·정확히 채운다(선고일 == next_date 확인됨).
  function judgmentFromRow(row){
    if (!row) return '';
    if (/선고/.test(row.next_contents || '') && row.next_date) return normalizeDate(row.next_date);
    return '';
  }

  window.initAutofillFor = function(anchorId, opts){
    injectStyle();
    var anchor = document.getElementById(anchorId);
    if (!anchor) return;
    var body = anchor.closest('.fs-body');
    if (!body) return;

    // 한 건의 사건 행으로 폼 전체를 채우는 공통 루틴(검색카드 선택 · 사건번호 직접입력 공용)
    function doFill(row){
      fillByDataAttr(body, row);
      // 선고일: 창고 값(next_date, 선고기일일 때)으로 즉시 채움 — 가장 빠르고 정확
      if (opts && opts.sentDate){
        var jd = judgmentFromRow(row);
        if (jd){ var s0 = document.getElementById(opts.sentDate); if (s0) s0.value = jd; }
      }
      // 재판부·선고일 실시간 조회(선택) — court-lookup 결과(캐시) 재사용 (창고에 선고일 없을 때 보강)
      if (opts && (opts.courtDept || opts.sentDate) && row.l_num && row.l_code){
        var applyLookup = function(res){
          if (opts.courtDept && res.court_dept){
            var dEl = document.getElementById(opts.courtDept);
            if (dEl) dEl.value = res.court_dept;
          }
          if (opts.sentDate && res.judgment_date){
            var sEl = document.getElementById(opts.sentDate);
            if (sEl && !sEl.value) sEl.value = normalizeDate(res.judgment_date); // 이미 창고값 있으면 유지
          }
        };
        if (deptCache[row.l_num] !== undefined){ applyLookup(deptCache[row.l_num]); }
        else { fetchCourtDept(row.l_code, row.l_num, function(res){ deptCache[row.l_num] = res; applyLookup(res); }); }
      }
    }

    buildSearchCard(anchor, doFill);

    // 사건번호를 직접 입력/붙여넣기하고 칸을 벗어나면(change) 창고에서 정확히 조회해 자동채움.
    // 검색카드로 채운 경우엔 값이 프로그램으로 설정돼 change 가 발생하지 않아 중복 조회 없음.
    if (anchor.dataset.afManual !== '1'){
      anchor.dataset.afManual = '1';
      anchor.addEventListener('change', function(){
        var code = (anchor.value || '').trim();
        if (!code) return;
        var sb = (typeof getSB === 'function') ? getSB() : null;
        if (!sb) return;
        sb.from('cases')
          .select('l_num,l_code,l_name,l_client,court,client_position,next_date,next_contents')
          .eq('l_code', code).limit(1)
          .then(function(res){
            var row = res && res.data && res.data[0];
            if (row) doFill(row);
          }, function(){});
      });
    }
  };

  /* ── 진입점: 항소장 폼 열릴 때 index.html의 goAppeal()에서 호출 ── */
  window.initAppealAutofill = function(){
    injectStyle();
    buildSearchCard(document.getElementById('ap-casenum'), fillForm); // 폼 맨 위 검색카드 한 곳으로 일원화
  };

  /* ── 선임계(형사) 폼 채우기 ──
     매핑: 사건번호 sj-casenum ← l_code
           사건명   sj-casename ← l_name ([전자] 제거)
           대표의뢰인 cl-list 첫 .cl-name ← l_client
           지위     sj-role 버튼 ← client_position
           제출기관 sj-agency ← court (법원·검찰·경찰 그대로) */
  function fillSeonimForm(r){
    setVal('sj-casenum', r.l_code);
    setVal('sj-casename', cleanCaseName(r.l_name));
    var clName = document.querySelector('#cl-list .cl-name');
    if (clName && r.l_client) clName.value = r.l_client;
    selectSeonimRole(r.client_position);
    setVal('sj-agency', r.court);
  }

  // 창고 지위가 피의자/피고인/고소인/피해자면 해당 버튼 자동 선택
  function selectSeonimRole(position){
    var chips = document.querySelectorAll('#sj-role .fs-chip');
    if (!chips.length) return;
    var matched = false;
    chips.forEach(function(c){
      var on = (c.dataset.role === position);
      c.classList.toggle('on', on);
      if (on) matched = true;
    });
    // 매칭 안 되면(민사 지위 등) 첫 번째(기본)로 되돌림
    if (!matched){
      chips.forEach(function(c, i){ c.classList.toggle('on', i === 0); });
    }
  }

  /* ── 진입점: 형사 선임계 폼 열릴 때 index.html의 goSeonim()에서 호출 ── */
  window.initSeonimAutofill = function(){
    injectStyle();
    buildSearchCard(document.getElementById('sj-casenum'), fillSeonimForm); // 폼 맨 위 검색카드 한 곳으로 일원화
  };

  /* ── 민가사 선임계 폼 채우기 ──
     매핑: 사건번호 mg-casenum ← l_code
           사건명   mg-casename ← l_name ([전자] 제거)
           대표의뢰인 mg-cl-list 첫 .cl-name ← l_client
           지위     mg-role 버튼 ← client_position (원고/피고)
           관할법원 mg-agency ← court
     참고: 상대방(mg-opp)은 창고에 없어 수동 입력 */
  function fillMingasaForm(r){
    setVal('mg-casenum', r.l_code);
    setVal('mg-casename', cleanCaseName(r.l_name));
    // 현재 카드가 법인이면 법인명 칸, 개인이면 개인명 칸에 채움
    var mgCard = document.querySelector('#mg-cl-list .mg-cl-card');
    if (mgCard && r.l_client){
      var isCorp = mgCard.dataset.kind === 'corp';
      var nameInput = mgCard.querySelector(isCorp ? '.mc-name' : '.mp-name');
      if (nameInput) nameInput.value = r.l_client;
    }
    selectMgRole(r.client_position);
    setVal('mg-agency', r.court);
  }

  // 창고 지위 → 당사자 유형(ptype) + 우리측 지위(앞=0/뒤=1) 매핑
  function mapMgPosition(position){
    if (!position) return null;
    var p = String(position);
    if (p.indexOf('피신청인') >= 0) return { ptype:'sincheong', idx:1 };
    if (p.indexOf('신청인')   >= 0) return { ptype:'sincheong', idx:0 };
    if (p.indexOf('채무자')   >= 0) return { ptype:'chaegwon',  idx:1 };
    if (p.indexOf('채권자')   >= 0) return { ptype:'chaegwon',  idx:0 };
    if (p.indexOf('피고') >= 0 && p.indexOf('피고인') < 0) return { ptype:'wongo', idx:1 };
    if (p.indexOf('원고')     >= 0) return { ptype:'wongo', idx:0 };
    return null; // 애매한 지위는 강두가 직접 선택
  }

  // 당사자 유형과 우리측 지위를 자동 선택 (매칭 안 되면 건드리지 않음)
  function selectMgRole(position){
    var m = mapMgPosition(position);
    if (!m) return;
    // 1) 당사자 유형 버튼
    var pchips = document.querySelectorAll('#mg-ptype .fs-chip');
    if (!pchips.length) return;
    pchips.forEach(function(c){ c.classList.toggle('on', c.dataset.ptype === m.ptype); });
    // 2) 우리측 지위(앞/뒤) 버튼
    var rchips = document.querySelectorAll('#mg-role .fs-chip');
    rchips.forEach(function(c, i){ c.classList.toggle('on', i === m.idx); });
    // 3) 라벨·상대방·제3자 섹션 갱신 (폼의 기존 함수 재사용)
    if (typeof mgUpdatePartyUI === 'function') mgUpdatePartyUI();
  }

  /* ── 진입점: 민가사 선임계 폼 열릴 때 index.html의 openMgForm()에서 호출 ── */
  window.initMingasaAutofill = function(){
    injectStyle();
    buildSearchCard(document.getElementById('mg-casenum'), fillMingasaForm); // 폼 맨 위 검색카드 한 곳으로 일원화
  };

})();
