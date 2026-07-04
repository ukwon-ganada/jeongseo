/* 법무법인 정서 - 서비스 워커
   목적: ① PWA 설치 요건(fetch 핸들러) 충족  ② 오프라인에서도 앱 열기
   전략: 같은 출처 파일만 캐시(네트워크 우선). 외부 API/CDN은 건드리지 않음. */
const CACHE = 'jeongseo-v111';
const ASSETS = ['./', './index.html', './styles.css', './dojang.html', './manifest.json', './favicon.png', './logo-sidebar.png', './icon-192.png', './icon-512.png', './watermark.png', './firm-stamp.png', './gyeongyu.js', './autofill.js', './yeollam.js', './home.js', './criminal.jpg', './civil.jpg', './family.jpg', './fonts/PretendardVariable.woff2'];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); })
      .then(function(){ return self.skipWaiting(); })
      .catch(function(){ /* 일부 파일 캐싱 실패해도 설치는 진행 */ })
  );
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
