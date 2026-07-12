/* 법무법인 정서 — 공용 유틸 (util.js)
   여러 모듈이 각자 복사해 쓰던 작은 도우미를 한 곳에 모은다(단일 출처).
   전역 window.JU 로 노출. 다른 스크립트보다 먼저 로드한다.

   ※ 로그인 게이트(auth.js)와 앱 핵심(index.html)은 안전을 위해 자체 헬퍼를 유지하고,
     이 파일에는 주변 모듈(yeollam·gyeongyu)이 공유하는 것만 둔다. */
(function () {
  'use strict';

  window.JU = {
    // HTML 이스케이프 (& < > " → 엔티티)
    esc: function (v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    // 오늘 날짜 → 'YYYY-MM-DD'
    todayISO: function () {
      var t = new Date();
      return t.getFullYear() + '-' +
        ('0' + (t.getMonth() + 1)).slice(-2) + '-' +
        ('0' + t.getDate()).slice(-2);
    }
  };
})();

/* ── AI 작성 중 표시(프리즘 흐르는 테두리) ─────────────────────────────
   AI가 값을 채우는 입력칸(textarea)에 "지금 AI가 이 칸을 쓰는 중"임을
   직관적으로 보여준다. 대상 칸을 .ai-field 래퍼로 감싸(최초 1회) 프리즘
   테두리 링 + '✦ AI 작성 중' 뱃지를 얹고, 생성 중엔 읽기전용으로 잠근다.
   완료(aiFieldDone)엔 값 반영 + 부드러운 페이드인. 스타일은 styles.css.
   여러 서면(항소·상고 / 기일연기·보정 / 참고자료)이 공유하는 단일 출처. */
(function () {
  'use strict';
  function ensureWrap(ta) {
    var p = ta.parentNode;
    if (p && p.classList && p.classList.contains('ai-field')) return p;
    if (!p) return null;
    var wrap = document.createElement('div');
    wrap.className = 'ai-field';
    p.insertBefore(wrap, ta);
    wrap.appendChild(ta);
    var badge = document.createElement('span');
    badge.className = 'ai-field-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML = '<svg class="ai-field-spark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 2l1.7 6.1a3 3 0 0 0 2.2 2.2L22 12l-6.1 1.7a3 3 0 0 0-2.2 2.2L12 22l-1.7-6.1a3 3 0 0 0-2.2-2.2L2 12l6.1-1.7a3 3 0 0 0 2.2-2.2z"/></svg>AI 작성 중';
    wrap.appendChild(badge);
    return wrap;
  }
  function wrapOf(ta) {
    var p = ta && ta.parentNode;
    return (p && p.classList && p.classList.contains('ai-field')) ? p : null;
  }
  // 생성 시작 — 링/뱃지 켜고 읽기전용 잠금. msg는 빈 칸일 때 보일 안내 문구.
  window.aiFieldStart = function (id, msg) {
    var ta = document.getElementById(id); if (!ta) return;
    var wrap = ensureWrap(ta); if (!wrap) return;
    ta.readOnly = true;
    if (msg != null) {
      if (ta.getAttribute('data-aiph') == null) ta.setAttribute('data-aiph', ta.getAttribute('placeholder') || '');
      ta.setAttribute('placeholder', msg);
    }
    ta.classList.remove('ai-fadein');
    wrap.classList.add('is-writing');
  };
  // 완료 — 값 반영 + 페이드인. 잠금 해제, 안내 문구 원복.
  window.aiFieldDone = function (id, text) {
    var ta = document.getElementById(id); if (!ta) return;
    var wrap = wrapOf(ta);
    ta.readOnly = false;
    var ph = ta.getAttribute('data-aiph');
    if (ph != null) { ta.setAttribute('placeholder', ph); ta.removeAttribute('data-aiph'); }
    if (wrap) wrap.classList.remove('is-writing');
    if (text != null) ta.value = text;
    ta.classList.remove('ai-fadein');
    // 리플로우 강제 후 애니메이션 재시작
    void ta.offsetWidth;
    ta.classList.add('ai-fadein');
    setTimeout(function () { ta.classList.remove('ai-fadein'); }, 650);
  };
  // 실패/취소 — 값은 건드리지 않고 잠금·표시만 해제.
  window.aiFieldStop = function (id) {
    var ta = document.getElementById(id); if (!ta) return;
    var wrap = wrapOf(ta);
    ta.readOnly = false;
    var ph = ta.getAttribute('data-aiph');
    if (ph != null) { ta.setAttribute('placeholder', ph); ta.removeAttribute('data-aiph'); }
    if (wrap) wrap.classList.remove('is-writing');
  };
})();
