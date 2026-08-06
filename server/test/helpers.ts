import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.HARU_DB_PATH ??= ':memory:';
process.env.HARU_SECRET ??= 'test-secret-must-be-long-enough';

const { createApp } = await import('../src/index.ts');

export type Client = {
  base: string;
  cookie: string;
  request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
};

export async function startServer(): Promise<{ base: string; close(): Promise<void> }> {
  const server: Server = createApp().listen(0);
  await new Promise((done) => server.once('listening', done));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

export function makeClient(base: string): Client {
  const client: Client = {
    base,
    cookie: '',
    async request(method, path, body) {
      const res = await fetch(base + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(client.cookie ? { cookie: client.cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      for (const raw of setCookie) {
        const pair = raw.split(';')[0]!;
        if (pair.startsWith('haru_session=')) client.cookie = pair;
      }
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  };
  return client;
}

/** 혜인과 민우를 만들어 한 공간에 넣는다. 실제 사용 흐름과 같은 순서다. */
export async function signUpPair(base: string) {
  const hyein = makeClient(base);
  const suffix = Math.random().toString(36).slice(2, 8);

  const created = await hyein.request('POST', '/api/auth/signup', {
    email: `hyein-${suffix}@example.com`,
    name: '혜인',
    password: 'password123',
  });

  const inviteCode = created.body.space.inviteCode as string;

  const minwoo = makeClient(base);
  await minwoo.request('POST', '/api/auth/signup', {
    email: `minwoo-${suffix}@example.com`,
    name: '민우',
    password: 'password123',
    inviteCode,
  });

  return { hyein, minwoo, inviteCode };
}
