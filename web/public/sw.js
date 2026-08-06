/*
 * 아주 작은 서비스워커.
 *
 * 목적은 하나다 — 홈 화면에서 열었을 때 네트워크가 없어도 앱 껍데기가 뜨는 것.
 * 할 일 데이터는 절대 캐시하지 않는다. 둘이 같이 쓰는 앱에서 오래된 목록을 보여 주는 건
 * 안 보여 주는 것보다 나쁘다.
 */

const SHELL = 'haru-shell-v1';
const SHELL_FILES = ['/', '/index.html', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API 는 손대지 않는다. 오프라인이면 화면이 오류를 그대로 보여주는 편이 정직하다.
  if (url.pathname.startsWith('/api/')) return;

  // 문서 요청은 네트워크 우선, 실패하면 캐시된 껍데기.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // 해시가 붙은 자산은 한 번 받으면 바뀌지 않으므로 캐시에서 먼저 준다.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && url.pathname.startsWith('/assets/')) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
