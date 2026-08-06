/**
 * Vercel 서버리스 진입점.
 *
 * Vercel 은 `api/` 아래 파일 하나를 함수 하나로 만든다. `vercel.json` 이
 * `/api/*` 를 전부 이 파일로 보내므로, Express 앱이 그대로 라우팅을 이어받는다.
 *
 * 정적 파일(웹 화면)은 여기서 다루지 않는다 — Vercel 이 `web/dist` 를 직접 내보내는 편이
 * 빠르고 캐시도 잘 된다. 그래서 `serveWeb: false` 로 API 만 담당한다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/index.ts';

const app = createApp({ serveWeb: false });

/**
 * 원래 경로를 되살린다.
 *
 * rewrite 를 거친 요청이 `/api/todos/version` 그대로 올 수도 있고, 목적지인
 * `/api/index` 로 바뀌어 올 수도 있다. 후자면 Express 가 경로를 못 찾아 전부 404 가 된다.
 * 그래서 `vercel.json` 에서 원래 경로를 `__path` 로 함께 실어 보내고, 여기서
 * **필요할 때만** 복원한다. 어느 쪽으로 오든 똑같이 동작한다.
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://haru.local');
  const forwarded = url.searchParams.get('__path');

  if (forwarded !== null) {
    url.searchParams.delete('__path');
    const lost = url.pathname === '/api' || url.pathname === '/api/index';
    if (lost) url.pathname = `/api/${forwarded}`;
    req.url = url.pathname + (url.search === '?' ? '' : url.search);
  }

  return app(req, res);
}
