import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { signUpPair, startServer } from './helpers.ts';

let base: string;
let close: () => Promise<void>;

before(async () => {
  const server = await startServer();
  base = server.base;
  close = server.close;
});

after(async () => {
  await close();
});

describe('날짜와 달력 밀도', () => {
  it('여러 날 항목은 걸친 모든 날에 잡힌다', async () => {
    const { hyein } = await signUpPair(base);

    await hyein.request('POST', '/api/todos', {
      title: '부산 출장',
      lane: 'personal',
      date: '2026-08-12',
      endDate: '2026-08-14',
    });

    const load = await hyein.request(
      'GET',
      '/api/todos/load?from=2026-08-01&to=2026-08-31&today=2026-08-06',
    );
    const days = load.body.days as { date: string; mine: number }[];
    const covered = days.filter((d) => d.mine > 0).map((d) => d.date);
    assert.deepEqual(covered, ['2026-08-12', '2026-08-13', '2026-08-14']);

    // 구간 조회에서도 가운데 날짜로 조회하면 잡혀야 한다.
    const middle = await hyein.request('GET', '/api/todos?from=2026-08-13&to=2026-08-13');
    assert.equal(middle.body.todos.length, 1);
  });

  it('전부 끝낸 날은 allDone 으로 표시된다', async () => {
    const { hyein } = await signUpPair(base);
    const a = await hyein.request('POST', '/api/todos', {
      title: '하나',
      date: '2026-09-01',
    });
    const b = await hyein.request('POST', '/api/todos', {
      title: '둘',
      date: '2026-09-01',
    });

    let load = await hyein.request('GET', '/api/todos/load?from=2026-09-01&to=2026-09-01');
    assert.equal(load.body.days[0].allDone, false);

    await hyein.request('POST', `/api/todos/${a.body.todo.id}/toggle`);
    await hyein.request('POST', `/api/todos/${b.body.todo.id}/toggle`);

    load = await hyein.request('GET', '/api/todos/load?from=2026-09-01&to=2026-09-01');
    assert.equal(load.body.days[0].allDone, true);
  });

  it('끝나는 날짜가 시작보다 빠르면 거절한다', async () => {
    const { hyein } = await signUpPair(base);
    const res = await hyein.request('POST', '/api/todos', {
      title: '거꾸로',
      date: '2026-08-10',
      endDate: '2026-08-01',
    });
    assert.equal(res.status, 400);
  });
});

describe('언젠가 서랍', () => {
  it('날짜를 안 주면 언젠가로 들어간다', async () => {
    const { hyein } = await signUpPair(base);
    await hyein.request('POST', '/api/todos', { title: '언젠가 읽을 책' });

    const someday = await hyein.request('GET', '/api/todos/someday');
    assert.equal(someday.body.todos.length, 1);
    assert.equal(someday.body.todos[0].date, null);

    const dated = await hyein.request('GET', '/api/todos?from=2020-01-01&to=2030-12-31');
    assert.equal(dated.body.todos.length, 0, '언젠가 항목은 날짜 조회에 섞이지 않는다');
  });
});

describe('이월', () => {
  it('밀린 내 항목만 오늘로 옮기고 원래 날짜를 남긴다', async () => {
    const { hyein, minwoo } = await signUpPair(base);

    await hyein.request('POST', '/api/todos', { title: '내 밀린 일', date: '2026-08-05' });
    await minwoo.request('POST', '/api/todos', { title: '민우 밀린 일', date: '2026-08-05' });
    const doneOne = await hyein.request('POST', '/api/todos', {
      title: '끝낸 일',
      date: '2026-08-05',
    });
    await hyein.request('POST', `/api/todos/${doneOne.body.todo.id}/toggle`);

    const overdue = await hyein.request(
      'GET',
      '/api/todos/load?from=2026-08-01&to=2026-08-31&today=2026-08-06',
    );
    assert.equal(overdue.body.overdue, 1, '끝낸 일과 상대 일은 세지 않는다');

    const moved = await hyein.request('POST', '/api/todos/carry-forward', {
      today: '2026-08-06',
    });
    assert.equal(moved.body.moved, 1);

    const today = await hyein.request('GET', '/api/todos?from=2026-08-06&to=2026-08-06');
    assert.equal(today.body.todos.length, 1);
    assert.equal(today.body.todos[0].carriedFrom, '2026-08-05');

    // 민우 것은 그대로 8/5 에 남아 있다.
    // (혜인이 끝낸 항목도 8/5 에 남으므로 민우 화면에는 두 건이 보인다.)
    const minwooStill = await minwoo.request('GET', '/api/todos?from=2026-08-05&to=2026-08-05');
    const minwooOwn = minwooStill.body.todos.filter((t: { bucket: string }) => t.bucket === 'mine');
    assert.equal(minwooOwn.length, 1, '민우 항목은 이월되지 않는다');
    assert.equal(minwooOwn[0].title, '민우 밀린 일');
    assert.equal(minwooOwn[0].carriedFrom, null);
  });
});

describe('하위 체크', () => {
  it('추가하고 체크할 수 있다', async () => {
    const { hyein } = await signUpPair(base);
    const parent = await hyein.request('POST', '/api/todos', {
      title: '제주 여행 준비',
      date: '2026-08-06',
    });
    const id = parent.body.todo.id;

    const added = await hyein.request('POST', `/api/todos/${id}/subtasks`, {
      title: '렌터카 예약',
    });
    assert.equal(added.body.todo.subtasks.length, 1);

    const subId = added.body.todo.subtasks[0].id;
    const checked = await hyein.request('PATCH', `/api/todos/subtasks/${subId}`, { done: true });
    assert.equal(checked.body.todo.subtasks[0].done, true);
  });
});

describe('공간 초대', () => {
  it('세 번째 사람은 들어올 수 없다', async () => {
    const { inviteCode } = await signUpPair(base);
    const res = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `third-${Math.random().toString(36).slice(2)}@example.com`,
        name: '제3자',
        password: 'password123',
        inviteCode,
      }),
    });
    assert.equal(res.status, 409);
  });

  it('잘못된 초대 코드는 계정을 만들지 않는다', async () => {
    const email = `ghost-${Math.random().toString(36).slice(2)}@example.com`;
    const first = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: '유령', password: 'password123', inviteCode: 'XXXX-XXXX' }),
    });
    assert.equal(first.status, 404);

    // 같은 이메일로 다시 시도하면 "이미 가입됨"이 아니라 정상 가입돼야 한다.
    const second = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: '유령', password: 'password123' }),
    });
    assert.equal(second.status, 201);
  });
});
