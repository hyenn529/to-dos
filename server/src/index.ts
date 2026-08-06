import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { backend } from './db.ts';
import { authRouter } from './routes/auth.ts';
import { spaceRouter } from './routes/space.ts';
import { todosRouter } from './routes/todos.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, '../../web/dist');

/**
 * `serveWeb` 는 한 프로세스로 웹까지 서빙할 때만 켠다.
 * Vercel 에서는 정적 파일을 플랫폼이 직접 내보내므로 API 만 담당한다.
 */
export function createApp({ serveWeb = true } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, backend });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/space', spaceRouter);
  app.use('/api/todos', todosRouter);

  if (serveWeb && existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders(res, filePath) {
          // 해시가 붙은 자산은 오래 캐시하고, 나머지는 항상 확인한다.
          if (filePath.includes(`${'assets'}/`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );

    // SPA 폴백. /api 로 시작하는 주소는 여기까지 오면 진짜 없는 것이다.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `${req.method} ${req.path} 를 찾을 수 없습니다.` });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[haru]', err);
    res.status(500).json({ error: '서버에서 문제가 생겼습니다.' });
  });

  return app;
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? '0.0.0.0';
  createApp().listen(port, host, () => {
    console.log(`[haru] http://localhost:${port} — 데이터는 ${backend} 에 저장됩니다.`);
    if (!existsSync(webDist)) {
      console.log('[haru] web/dist 가 없어 API 만 제공합니다. `npm run build` 후 다시 시작하세요.');
    }
  });
}
