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

describe('갈래와 권한', () => {
  it('업무는 사람마다 따로 있고, 상대 업무는 보기만 된다', async () => {
    const { hyein, minwoo } = await signUpPair(base);

    await hyein.request('POST', '/api/todos', {
      title: '분기 리포트',
      lane: 'work',
      date: '2026-08-06',
    });
    await minwoo.request('POST', '/api/todos', {
      title: '민우 회의 준비',
      lane: 'work',
      date: '2026-08-06',
    });

    // 각자에게는 자기 업무가 mineWork, 상대 업무가 partnerWork 로 온다.
    const seenByHyein = await hyein.request('GET', '/api/todos?from=2026-08-06&to=2026-08-06');
    const byBucket = Object.fromEntries(
      seenByHyein.body.todos.map((t: { bucket: string; title: string }) => [t.bucket, t.title]),
    );
    assert.equal(byBucket.mineWork, '분기 리포트');
    assert.equal(byBucket.partnerWork, '민우 회의 준비');

    const seenByMinwoo = await minwoo.request('GET', '/api/todos?from=2026-08-06&to=2026-08-06');
    const mirrored = Object.fromEntries(
      seenByMinwoo.body.todos.map((t: { bucket: string; title: string }) => [t.bucket, t.title]),
    );
    assert.equal(mirrored.mineWork, '민우 회의 준비', '보는 사람 기준으로 뒤집힌다');
    assert.equal(mirrored.partnerWork, '분기 리포트');

    // 상대 업무는 체크도 수정도 안 된다.
    const theirWork = seenByHyein.body.todos.find(
      (t: { bucket: string }) => t.bucket === 'partnerWork',
    );
    assert.equal(theirWork.canCheck, false);
    assert.equal(theirWork.canEdit, false);
    assert.equal(theirWork.countable, false);
    assert.equal((await hyein.request('POST', `/api/todos/${theirWork.id}/toggle`)).status, 403);
  });

  it('상대의 개인 일정은 보이지만 mine 이 아니라 partner 로 온다', async () => {
    const { hyein, minwoo } = await signUpPair(base);

    await minwoo.request('POST', '/api/todos', {
      title: '야근',
      lane: 'personal',
      date: '2026-08-07',
    });

    const seenByHyein = await hyein.request('GET', '/api/todos?from=2026-08-07&to=2026-08-07');
    const todo = seenByHyein.body.todos[0];
    assert.equal(todo.bucket, 'partner');
    assert.equal(todo.canCheck, false, '상대 항목은 체크할 수 없다');
    assert.equal(todo.canEdit, false, '상대 항목은 고칠 수 없다');
    assert.equal(todo.countable, false, '상대 항목은 내 남은 개수에 들어가지 않는다');

    const seenByMinwoo = await minwoo.request('GET', '/api/todos?from=2026-08-07&to=2026-08-07');
    assert.equal(seenByMinwoo.body.todos[0].bucket, 'mine');
    assert.equal(seenByMinwoo.body.todos[0].canCheck, true);
  });

  it('상대의 할 일은 체크·수정·삭제가 막힌다', async () => {
    const { hyein, minwoo } = await signUpPair(base);

    const created = await minwoo.request('POST', '/api/todos', {
      title: '민우 회식',
      lane: 'personal',
      date: '2026-08-08',
    });
    const id = created.body.todo.id;

    assert.equal((await hyein.request('POST', `/api/todos/${id}/toggle`)).status, 403);
    assert.equal((await hyein.request('PATCH', `/api/todos/${id}`, { title: '고침' })).status, 403);
    assert.equal((await hyein.request('DELETE', `/api/todos/${id}`)).status, 403);

    // 주인은 당연히 된다.
    assert.equal((await minwoo.request('POST', `/api/todos/${id}/toggle`)).status, 200);
  });

  it('"같이" 항목은 둘 다 체크할 수 있다', async () => {
    const { hyein, minwoo } = await signUpPair(base);

    const created = await minwoo.request('POST', '/api/todos', {
      title: '공항 데려다주기',
      lane: 'personal',
      date: '2026-08-12',
      together: true,
    });
    const id = created.body.todo.id;

    const seen = await hyein.request('GET', '/api/todos?from=2026-08-12&to=2026-08-12');
    assert.equal(seen.body.todos[0].canCheck, true, '같이 항목은 상대도 체크할 수 있다');
    assert.equal(seen.body.todos[0].canEdit, false, '그래도 고치는 건 주인만');

    const toggled = await hyein.request('POST', `/api/todos/${id}/toggle`);
    assert.equal(toggled.status, 200);
    assert.equal(toggled.body.todo.done, true);
  });

  it('자리는 공간을 만든 사람이 a, 들어온 사람이 b 로 고정된다', async () => {
    const { hyein, minwoo } = await signUpPair(base);

    assert.equal((await hyein.request('GET', '/api/auth/me')).body.seat, 'a');
    assert.equal((await minwoo.request('GET', '/api/auth/me')).body.seat, 'b');

    // 색은 이 값에 붙으므로, 다시 물어봐도 흔들리면 안 된다.
    assert.equal((await minwoo.request('GET', '/api/auth/me')).body.seat, 'b');
  });

  it('"같이" 항목은 양쪽 모두 자기 칸에 놓인다', async () => {
    const { hyein, minwoo } = await signUpPair(base);

    await minwoo.request('POST', '/api/todos', {
      title: '장보기',
      lane: 'personal',
      date: '2026-08-14',
      together: true,
    });
    await minwoo.request('POST', '/api/todos', {
      title: '민우 혼자 할 일',
      lane: 'personal',
      date: '2026-08-14',
    });

    const seen = await hyein.request('GET', '/api/todos?from=2026-08-14&to=2026-08-14');
    const shared = seen.body.todos.find((t: { title: string }) => t.title === '장보기');
    const alone = seen.body.todos.find((t: { title: string }) => t.title === '민우 혼자 할 일');

    assert.equal(shared.bucket, 'mine', '같이 항목은 상대가 적었어도 내 칸에');
    assert.equal(shared.countable, true, '내 칸에 있으니 내 남은 개수에도 센다');
    assert.equal(alone.bucket, 'partner', '같이가 아니면 그대로 상대 칸에');

    // 주인 화면에서도 자기 칸 그대로다.
    const mine = await minwoo.request('GET', '/api/todos?from=2026-08-14&to=2026-08-14');
    assert.equal(
      mine.body.todos.find((t: { title: string }) => t.title === '장보기').bucket,
      'mine',
    );

    // 달력 막대도 같은 기준으로 센다.
    const load = await hyein.request(
      'GET',
      '/api/todos/load?from=2026-08-14&to=2026-08-14&today=2026-08-14',
    );
    assert.equal(load.body.days[0].mine, 1, '같이 항목이 내 막대에 들어간다');
    assert.equal(load.body.days[0].partner, 1, '상대 혼자 할 일은 상대 막대에');
  });

  it('lane 과 owner 는 서버가 정하므로 남의 칸에 끼워 넣을 수 없다', async () => {
    const { hyein, minwoo } = await signUpPair(base);
    const meMinwoo = await minwoo.request('GET', '/api/auth/me');

    // owner_id 를 실어 보내도 무시된다.
    await hyein.request('POST', '/api/todos', {
      title: '몰래 넣기',
      lane: 'personal',
      date: '2026-08-09',
      ownerId: meMinwoo.body.user.id,
    });

    const seenByMinwoo = await minwoo.request('GET', '/api/todos?from=2026-08-09&to=2026-08-09');
    assert.equal(seenByMinwoo.body.todos[0].bucket, 'partner');
    assert.equal(seenByMinwoo.body.todos[0].canEdit, false);
  });

  it('내 항목만 순서를 바꿀 수 있다', async () => {
    const { hyein, minwoo } = await signUpPair(base);
    const theirs = await minwoo.request('POST', '/api/todos', {
      title: '민우 일정',
      lane: 'personal',
      date: '2026-08-10',
    });

    const res = await hyein.request('POST', '/api/todos/reorder', {
      ids: [theirs.body.todo.id],
    });
    assert.equal(res.status, 403);
  });
});

describe('로그인하지 않은 요청', () => {
  it('전부 401 로 막힌다', async () => {
    const res = await fetch(`${base}/api/todos?from=2026-08-01&to=2026-08-31`);
    assert.equal(res.status, 401);
  });
});
