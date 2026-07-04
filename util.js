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
