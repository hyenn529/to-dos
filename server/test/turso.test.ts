import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { startFakeTurso } from './fake-turso.ts';
import { makeClient } from './helpers.ts';

/**
 * 배포에서 실제로 도는 경로(Turso 백엔드)로 같은 검사를 돌린다.
 *
 * 로컬 SQLite 와 Turso 는 문법이 거의 같지만 완전히 같지는 않다 —
 * 한 번에 한 문장만 받는다든지, 트랜잭션을 batch 로 보내야 한다든지.
 * 그 차이 때문에 "로컬은 되는데 올리면 안 되는" 일이 생기므로 여기서 미리 잡는다.
 */

let fake: { url: string; close(): Promise<void> };
let server: Server;
let base: string;

before(async () => {
  fake = await startFakeTurso();

  // db 모듈은 첫 import 때 어느 백엔드를 쓸지 정하므로, 그 전에 환경을 세워야 한다.
  process.env.TURSO_DATABASE_URL = fake.url;
  process.env.TURSO_AUTH_TOKEN = 'fake-token';
  process.env.HARU_SECRET ??= 'test-secret-must-be-long-enough';

  const { createApp } = await import('../src/index.ts');
  server = createApp({ serveWeb: false }).listen(0);
  await new Promise((done) => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await fake.close();
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
});

describe('Turso 백엔드', () => {
  it('마이그레이션이 돌고 서버가 뜬다', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, backend: 'turso' });
  });

  it('가입·초대·할 일 흐름이 그대로 동작한다', async () => {
    const hyein = makeClient(base);
    const created = await hyein.request('POST', '/api/auth/signup', {
      email: 'hyein@turso.test',
      name: '혜인',
      password: 'password123',
    });
    assert.equal(created.status, 201);

    const minwoo = makeClient(base);
    const joined = await minwoo.request('POST', '/api/auth/signup', {
      email: 'minwoo@turso.test',
      name: '민우',
      password: 'password123',
      inviteCode: created.body.space.inviteCode,
    });
    assert.equal(joined.status, 201);

    // 업무는 사람마다 따로 — 상대 업무는 partnerWork 로 온다
    await hyein.request('POST', '/api/todos', {
      title: '분기 리포트',
      lane: 'work',
      date: '2026-08-06',
    });
    const seenByMinwoo = await minwoo.request('GET', '/api/todos?from=2026-08-06&to=2026-08-06');
    assert.equal(seenByMinwoo.body.todos.length, 1);
    assert.equal(seenByMinwoo.body.todos[0].bucket, 'partnerWork');
    assert.equal(seenByMinwoo.body.todos[0].canEdit, false);

    // 상대 항목은 읽기 전용
    const theirs = await minwoo.request('POST', '/api/todos', {
      title: '야근',
      lane: 'personal',
      date: '2026-08-06',
    });
    const blocked = await hyein.request('POST', `/api/todos/${theirs.body.todo.id}/toggle`);
    assert.equal(blocked.status, 403);

    // "같이" 는 둘 다 체크
    const shared = await minwoo.request('POST', '/api/todos', {
      title: '공항 데려다주기',
      lane: 'personal',
      date: '2026-08-12',
      together: true,
    });
    const toggled = await hyein.request('POST', `/api/todos/${shared.body.todo.id}/toggle`);
    assert.equal(toggled.status, 200);
    assert.equal(toggled.body.todo.done, true);
  });

  it('batch 로 도는 이월이 동작한다', async () => {
    const client = makeClient(base);
    await client.request('POST', '/api/auth/signup', {
      email: 'carry@turso.test',
      name: '이월',
      password: 'password123',
    });

    await client.request('POST', '/api/todos', { title: '밀린 일 1', date: '2026-08-01' });
    await client.request('POST', '/api/todos', { title: '밀린 일 2', date: '2026-08-02' });

    const moved = await client.request('POST', '/api/todos/carry-forward', {
      today: '2026-08-06',
    });
    assert.equal(moved.body.moved, 2, '여러 문장을 한 트랜잭션으로 보내는 경로');

    const today = await client.request('GET', '/api/todos?from=2026-08-06&to=2026-08-06');
    assert.equal(today.body.todos.length, 2);
    assert.equal(today.body.todos[0].carriedFrom, '2026-08-01');
  });

  it('변경 번호가 쓰기마다 올라간다', async () => {
    const client = makeClient(base);
    await client.request('POST', '/api/auth/signup', {
      email: 'version@turso.test',
      name: '버전',
      password: 'password123',
    });

    const before = await client.request('GET', '/api/todos/version');
    await client.request('POST', '/api/todos', { title: '무언가', date: '2026-08-06' });
    const after = await client.request('GET', '/api/todos/version');

    assert.ok(
      after.body.version > before.body.version,
      '화면은 이 숫자만 보고 다시 부를지 정한다',
    );
  });

  it('여러 날 항목과 달력 밀도가 맞는다', async () => {
    const client = makeClient(base);
    await client.request('POST', '/api/auth/signup', {
      email: 'span@turso.test',
      name: '기간',
      password: 'password123',
    });

    await client.request('POST', '/api/todos', {
      title: '부산 출장',
      date: '2026-08-12',
      endDate: '2026-08-14',
    });

    const load = await client.request(
      'GET',
      '/api/todos/load?from=2026-08-01&to=2026-08-31&today=2026-08-06',
    );
    const covered = (load.body.days as { date: string; mine: number }[])
      .filter((day) => day.mine > 0)
      .map((day) => day.date);
    assert.deepEqual(covered, ['2026-08-12', '2026-08-13', '2026-08-14']);
  });
});
