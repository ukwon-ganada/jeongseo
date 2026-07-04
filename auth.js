/* 법무법인 정서 — 직원 로그인 (auth.js)
   ───────────────────────────────────────────────────────────────
   목적: 앱의 일반 기능(계약서 목록·저장·자동완성 등)을 로그인한 직원만 쓰게 막는다.
         DB는 RLS로 이미 잠겨 있으므로(익명 접근 거부), 이 화면은 그 잠금을 여는 열쇠다.
   방식: Supabase Auth (이메일+비밀번호). 공용 계정 1개를 전 직원이 공유.
         세션은 브라우저에 저장되어 한번 로그인하면 계속 유지된다(수동 로그아웃 전까지).

   진입:
     · 일반 접속        → 세션 없으면 로그인 화면을 덮어씌운다.
     · 서명 링크(?sign=) → 외부 의뢰인용이므로 로그인 화면을 띄우지 않는다(그대로 통과).

   의존: index.html 전역 getSB() (Supabase 클라이언트) — 같은 클라이언트를 써서 세션을 공유한다.
   노출: window.jsAuth.hasSession() / showLogin() / logout()
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var STYLE_ID = 'auth-style';
  var OVERLAY_ID = 'authScreen';
  var LAST_EMAIL_KEY = 'js_last_email';   // 다음 방문 때 이메일 자동 채움용
  var _hasSession = false;

  // 서명 링크로 들어온 경우엔 로그인 관여 안 함
  function isSignMode() {
    return /[?&]sign=/.test(location.search);
  }

  /* ── Supabase 클라이언트 확보 (라이브러리가 늦게 로드될 수 있어 잠깐 재시도) ── */
  function getClient(cb) {
    var tries = 0;
    (function attempt() {
      var sb = (typeof getSB === 'function') ? getSB() : null;
      if (sb) { cb(sb); return; }
      if (++tries > 25) { cb(null); return; }   // ~5초까지 대기
      setTimeout(attempt, 200);
    })();
  }

  /* ── 스타일 주입 ── */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '#' + OVERLAY_ID + '{position:fixed;inset:0;z-index:10000;background:#fff;display:none;'
      + 'flex-direction:column;align-items:center;justify-content:center;padding:24px;'
      + "font-family:var(--font,-apple-system,'Malgun Gothic',sans-serif);}"
      + '#' + OVERLAY_ID + '.show{display:flex;}'
      + '.au-box{width:100%;max-width:320px;text-align:center;}'
      + '.au-brand{font-size:24px;font-weight:700;letter-spacing:-0.01em;margin-bottom:6px;color:#1a1a1a;}'
      + '.au-sub{font-size:13px;color:#aaa;margin-bottom:28px;}'
      + '.au-input{width:100%;height:52px;border:1px solid #bbb;border-radius:14px;padding:0 18px;'
      + 'font-size:15px;font-family:inherit;outline:none;background:#f9f9f9;margin-bottom:10px;'
      + '-webkit-appearance:none;box-sizing:border-box;}'
      + '.au-input:focus{border-color:#1a1a1a;background:#fff;}'
      + '.au-err{font-size:12px;color:#c0392b;margin:4px 0 2px;min-height:16px;}'
      + '.au-btn{width:100%;height:52px;margin-top:6px;background:#1a1a1a;color:#fff;border:none;'
      + 'border-radius:14px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;}'
      + '.au-btn:disabled{opacity:.55;cursor:default;}'
      + '.au-remember{display:flex;align-items:center;justify-content:center;gap:7px;'
      + 'font-size:13px;color:#666;margin:6px 0 2px;cursor:pointer;user-select:none;}'
      + '.au-remember input{width:16px;height:16px;accent-color:#1a1a1a;margin:0;cursor:pointer;}'
      + '.au-foot{font-size:11px;color:#cfd3d9;margin-top:22px;line-height:1.5;}';
    var s = document.createElement('style');
    s.id = STYLE_ID; s.textContent = css;
    document.head.appendChild(s);
  }

  /* ── 로그인 화면 DOM 주입 ──
     · 진짜 <form> 이라 브라우저 비밀번호 관리자가 저장/자동채움을 제안한다.
     · 이메일은 기억해 두었다가 다음 방문 때 자동으로 채운다. */
  function injectOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    injectStyle();
    var lastEmail = '';
    try { lastEmail = localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch (e) {}
    var remembered = lastEmail !== '';

    var el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.innerHTML =
      '<form class="au-box" id="au-form" autocomplete="on" action="#">'
      + '<div class="au-brand">법무법인 정서</div>'
      + '<div class="au-sub">직원 로그인</div>'
      + '<input type="email" name="email" class="au-input" id="au-email" placeholder="이메일" '
      + 'autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(lastEmail) + '">'
      + '<input type="password" name="password" class="au-input" id="au-pw" placeholder="비밀번호" '
      + 'autocomplete="current-password">'
      + '<label class="au-remember"><input type="checkbox" id="au-remember"' + (remembered ? ' checked' : '') + '>'
      + '로그인 정보 기억하기</label>'
      + '<div class="au-err" id="au-err"></div>'
      + '<button type="submit" class="au-btn" id="au-btn">로그인</button>'
      + '<div class="au-foot">법무법인 정서 내부용 · 승인된 직원만 이용<br>'
      + '한 번 로그인하면 로그아웃 전까지 자동으로 로그인됩니다.</div>'
      + '</form>';
    document.body.appendChild(el);

    // 첫 방문(기억된 이메일 없음)엔 기본 체크
    var rem = el.querySelector('#au-remember');
    if (rem && !remembered) rem.checked = true;

    el.querySelector('#au-form').addEventListener('submit', function (e) {
      e.preventDefault();
      doLogin();
    });
  }

  // 값 안전 삽입(이메일에 따옴표 등이 들어와도 속성이 깨지지 않게)
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setErr(msg) {
    var e = document.getElementById('au-err');
    if (e) e.textContent = msg || '';
  }

  function showOverlay() {
    injectOverlay();
    var el = document.getElementById(OVERLAY_ID);
    if (el) {
      el.classList.add('show');
      // 이메일이 이미 채워져 있으면 비밀번호로 바로 포커스
      var em = document.getElementById('au-email');
      var pw = document.getElementById('au-pw');
      setTimeout(function () {
        if (em && !em.value) { em.focus(); }
        else if (pw) { pw.focus(); }
      }, 80);
    }
  }
  function hideOverlay() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.classList.remove('show');
  }

  /* ── 로그인 실행 ── */
  function doLogin() {
    var email = (document.getElementById('au-email') || {}).value || '';
    var pw = (document.getElementById('au-pw') || {}).value || '';
    email = email.trim();
    if (!email || !pw) { setErr('이메일과 비밀번호를 입력해 주세요.'); return; }
    var btn = document.getElementById('au-btn');
    if (btn) { btn.disabled = true; btn.textContent = '로그인 중…'; }
    setErr('');
    getClient(function (sb) {
      if (!sb) {
        setErr('연결 준비 중입니다. 잠시 후 다시 시도해 주세요.');
        if (btn) { btn.disabled = false; btn.textContent = '로그인'; }
        return;
      }
      sb.auth.signInWithPassword({ email: email, password: pw }).then(function (res) {
        if (btn) { btn.disabled = false; btn.textContent = '로그인'; }
        if (res && res.error) {
          setErr('이메일 또는 비밀번호가 올바르지 않습니다.');
          var p = document.getElementById('au-pw'); if (p) p.value = '';
          return;
        }
        _hasSession = true;
        // "로그인 정보 기억하기" 체크 시 이메일을 저장(다음 방문 자동 채움).
        // 비밀번호 자체는 저장하지 않고, 브라우저 비밀번호 관리자와 세션 유지가 자동 로그인을 담당.
        var remember = (document.getElementById('au-remember') || {}).checked;
        try {
          if (remember) localStorage.setItem(LAST_EMAIL_KEY, email);
          else localStorage.removeItem(LAST_EMAIL_KEY);
        } catch (e) {}
        var p2 = document.getElementById('au-pw'); if (p2) p2.value = '';
        hideOverlay();
      }, function () {
        if (btn) { btn.disabled = false; btn.textContent = '로그인'; }
        setErr('로그인 중 오류가 발생했습니다. 다시 시도해 주세요.');
      });
    });
  }

  /* ── 부팅: 세션 확인 후 필요하면 로그인 화면을 띄운다 ── */
  function boot() {
    if (isSignMode()) return;             // 외부 서명 링크는 통과
    injectStyle();
    getClient(function (sb) {
      if (!sb) { showOverlay(); return; } // 연결 안 되면 일단 로그인 요구
      sb.auth.getSession().then(function (res) {
        var session = res && res.data && res.data.session;
        _hasSession = !!session;
        if (_hasSession) { hideOverlay(); }
        else { showOverlay(); }
        // 다른 탭에서 로그아웃/만료되면 반영
        sb.auth.onAuthStateChange(function (_evt, s) {
          _hasSession = !!s;
          if (!_hasSession && !isSignMode()) showOverlay(); else hideOverlay();
        });
      }, function () { showOverlay(); });
    });
  }

  /* ── 외부 노출 API ── */
  window.jsAuth = {
    hasSession: function () { return _hasSession; },
    showLogin: function () { if (!isSignMode()) showOverlay(); },
    logout: function () {
      getClient(function (sb) {
        if (sb) { try { sb.auth.signOut(); } catch (e) {} }
        _hasSession = false;
        if (!isSignMode()) showOverlay();
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
