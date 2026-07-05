/* 법무법인 정서 - 서비스 워커
   목적: ① PWA 설치 요건(fetch 핸들러) 충족  ② 오프라인에서도 앱 열기
   전략: 같은 출처 파일만 캐시(네트워크 우선). 외부 API/CDN은 건드리지 않음. */
const CACHE = 'jeongseo-v132';
// 실제 존재하는 파일만. (없는 파일이 하나라도 섞이면 예전 방식(addAll)은 통째로 실패했음)
const ASSETS = ['./', './index.html', './styles.css', './dojang.html', './manifest.json', './favicon.png', './logo-sidebar.png', './icon-192.png', './icon-512.png', './watermark.png', './firm-stamp.png', './util.js', './gyeongyu.js', './autofill.js', './yeollam.js', './geomchal.js', './home.js', './auth.js', './criminal.jpg', './civil.jpg', './family.jpg', './fonts/NotoSansKR-400.woff2', './fonts/NotoSansKR-500.woff2'];

self.addEventListener('install', function(e){
  // 파일 하나가 실패해도 나머지는 캐시되도록 개별 처리(allSettled) + 항상 즉시 교체
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.allSettled(ASSETS.map(function(a){ return c.add(a); }));
    }).then(function(){ return self.skipWaiting(); })
     .catch(function(){ return self.skipWaiting(); })
  );
});

// index.html이 보내는 교체 신호를 받아 대기 중 새 워커를 즉시 활성화
self.addEventListener('message', function(e){
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; })
                             .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;                 // 저장/전송 같은 POST는 그대로 통과
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // 카카오·Supabase·CDN 등 외부는 손대지 않음
  // 네트워크 우선, 실패하면 캐시(오프라인) → 마지막엔 메인 화면
  e.respondWith(
    fetch(req).then(function(res){
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
      return res;
    }).catch(function(){
      return caches.match(req).then(function(r){ return r || caches.match('./index.html'); });
    })
  );
});
