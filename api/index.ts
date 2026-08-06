/**
 * Vercel 서버리스 진입점.
 *
 * Vercel 은 `api/` 아래 파일 하나를 함수 하나로 만든다. `vercel.json` 이
 * `/api/*` 를 전부 이 파일로 보내므로, Express 앱이 그대로 라우팅을 이어받는다.
 *
 * 정적 파일(웹 화면)은 여기서 다루지 않는다 — Vercel 이 `web/dist` 를 직접 내보내는 편이
 * 빠르고 캐시도 잘 된다. 그래서 `serveWeb: false` 로 API 만 담당한다.
 */
import { createApp } from '../server/src/index.ts';

export default createApp({ serveWeb: false });
