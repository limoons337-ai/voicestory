// VoxRPG 서비스워커.
// 핵심 수정(v2): 네비게이션(index.html)은 '네트워크 우선'.
//   재배포로 자산 해시(index-XXXX.js)가 바뀌어도 항상 최신 index.html을 받아
//   해시 불일치(옛 index가 없어진 옛 JS를 부름 → text/html 반환 → 백지)를 방지.
//   해시가 박힌 /assets/* 는 내용주소(불변)라 캐시 우선이 안전.
const CACHE = 'voxrpg-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return; // API는 SW 개입 안 함
  if (req.method !== 'GET') return;
  if (url.pathname === '/sw.js') return; // SW 스크립트는 브라우저가 직접 관리

  // 네비게이션(문서 요청) = 네트워크 우선 → 항상 최신 index.html.
  const isNav = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // 최신 index를 오프라인 대비로 '/'에 저장
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || caches.match(req)))
    );
    return;
  }

  // 그 외 정적 자산(해시 박힌 불변 파일 등) = 캐시 우선, 없으면 네트워크(성공분만 캐시).
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/avatars/'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
