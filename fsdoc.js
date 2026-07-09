/* ────────────────────────────────────────────────────────────────
   서면 작성 모듈 공용 헬퍼 (FSDoc)
   국선증액(gukseon)·판결등본(pankyul)·법원열람(yeollam)·검찰열람(geomchal)
   4개 모듈에 글자 그대로 중복돼 있던 순수 유틸만 한곳으로 모음.
   ※ 동작 100% 보존용 — 셸/라이프사이클/문서 CSS 등 모듈 고유 로직은 포함하지 않음.
   ※ 각 모듈은 함수 '내부'에서만 FSDoc 를 참조(지연 참조)한다.
      (yeollam·geomchal 의 node 테스트 export 경로에선 window 가 없으므로
       모듈 로드 시점에 FSDoc 를 건드리면 안 됨)
   ──────────────────────────────────────────────────────────────── */
(function () {
  var FSDoc = {};

  /* 같은 id 의 <style> 을 한 번만 주입 (injectStyle 공통) */
  FSDoc.injectOnce = function (styleId, css) {
    if (document.getElementById(styleId)) return;
    var s = document.createElement('style');
    s.id = styleId;
    s.textContent = css;
    document.head.appendChild(s);
  };

  /* 문자열 배열 명단(변호사/사무원) — localStorage 기억 + 시드 폴백.
     load(): 저장본이 있으면 그대로, 없으면 시드 복사본.
     save(name): 중복 아니면 추가 저장. */
  FSDoc.roster = function (storageKey, seed) {
    seed = seed || [];
    function load() {
      try {
        var raw = localStorage.getItem(storageKey);
        var arr = raw ? JSON.parse(raw) : null;
        if (arr && arr.length) return arr;
      } catch (e) {}
      return seed.slice();
    }
    function save(name) {
      name = (name || '').trim();
      if (!name) return;
      var list = load();
      if (list.indexOf(name) < 0) {
        list.push(name);
        try { localStorage.setItem(storageKey, JSON.stringify(list)); } catch (e) {}
      }
    }
    return { load: load, save: save };
  };

  /* ISO(yyyy-mm-dd) → "yyyy년 m월 d일" (yeollam·geomchal 공통) */
  FSDoc.fmtKDate = function (iso) {
    var m = ('' + (iso || '')).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return '';
    return m[1] + '년 ' + parseInt(m[2], 10) + '월 ' + parseInt(m[3], 10) + '일';
  };

  if (typeof window !== 'undefined') window.FSDoc = FSDoc;
})();
