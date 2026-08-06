import { Router } from 'express';
import { requireAuth } from '../auth.ts';
import { bumpVersion, readVersion } from '../events.ts';
import * as repo from '../todos.ts';

export const todosRouter = Router();

todosRouter.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const text = String(value);
  return DATE_RE.test(text) ? text : undefined;
}

/**
 * 변경 번호만 돌려준다.
 * 화면은 이것만 자주 물어보고, 숫자가 바뀌었을 때만 실제 목록을 다시 부른다.
 */
todosRouter.get('/version', async (req, res) => {
  res.json({ version: await readVersion(req.space!.id) });
});

/** 날짜 구간 조회. `?from=YYYY-MM-DD&to=YYYY-MM-DD` */
todosRouter.get('/', async (req, res) => {
  const from = readDate(req.query.from);
  const to = readDate(req.query.to);
  if (!from || !to) {
    res.status(400).json({ error: 'from, to 를 YYYY-MM-DD 로 주세요.' });
    return;
  }
  res.json({ todos: await repo.listByRange(req.space!.id, req.user!.id, from, to) });
});

/** 날짜 없는 "언젠가" 서랍. */
todosRouter.get('/someday', async (req, res) => {
  res.json({ todos: await repo.listSomeday(req.space!.id, req.user!.id) });
});

/** 달력 막대용 한 달치 밀도 + 밀린 개수 + 현재 변경 번호. */
todosRouter.get('/load', async (req, res) => {
  const from = readDate(req.query.from);
  const to = readDate(req.query.to);
  const today = readDate(req.query.today);
  if (!from || !to) {
    res.status(400).json({ error: 'from, to 를 YYYY-MM-DD 로 주세요.' });
    return;
  }
  res.json({
    days: await repo.monthLoad(req.space!.id, req.user!.id, from, to),
    overdue: today ? await repo.countOverdue(req.space!.id, req.user!.id, today) : 0,
    version: await readVersion(req.space!.id),
  });
});

todosRouter.post('/', async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (title.length === 0) {
    res.status(400).json({ error: '할 일 제목을 적어 주세요.' });
    return;
  }

  const lane = req.body?.lane === 'work' ? 'work' : 'personal';
  // 새로 만들 때 날짜를 아예 안 주면 "언젠가" 서랍으로 간다.
  // readDate 는 값이 없으면 undefined(=건드리지 않음)를 주므로 여기서 null 로 바꾼다.
  const date = req.body?.date === undefined ? null : readDate(req.body.date);
  const endDate = req.body?.endDate === undefined ? null : readDate(req.body.endDate);
  if (date === undefined || endDate === undefined) {
    res.status(400).json({ error: '날짜는 YYYY-MM-DD 형식이어야 합니다.' });
    return;
  }
  if (date === null && endDate !== null) {
    res.status(400).json({ error: '끝나는 날짜만 정할 수는 없습니다.' });
    return;
  }
  if (date !== null && endDate !== null && endDate < date) {
    res.status(400).json({ error: '끝나는 날짜가 시작보다 빠릅니다.' });
    return;
  }

  // 자기 갈래에만 적을 수 있다. lane 과 owner 를 항상 로그인한 사람으로 고정하므로
  // 남의 칸에 끼워 넣는 요청 자체가 성립하지 않는다.
  const id = await repo.create({
    spaceId: req.space!.id,
    ownerId: req.user!.id,
    lane,
    title,
    note: req.body?.note ? String(req.body.note) : null,
    date,
    endDate,
    together: Boolean(req.body?.together),
  });

  await bumpVersion(req.space!.id, 'todo:created');
  res.status(201).json({ todo: await repo.getForViewer(id, req.user!.id) });
});

/** 고치기 — 주인만. */
todosRouter.patch('/:id', async (req, res) => {
  const row = await repo.getById(Number(req.params.id));
  if (!row || row.space_id !== req.space!.id) {
    res.status(404).json({ error: '할 일을 찾을 수 없습니다.' });
    return;
  }
  if (row.owner_id !== req.user!.id) {
    res.status(403).json({ error: '상대의 할 일은 고칠 수 없어요.' });
    return;
  }

  const date = readDate(req.body?.date);
  const endDate = readDate(req.body?.endDate);
  if (date === undefined && req.body?.date !== undefined) {
    res.status(400).json({ error: '날짜는 YYYY-MM-DD 형식이어야 합니다.' });
    return;
  }
  if (endDate === undefined && req.body?.endDate !== undefined) {
    res.status(400).json({ error: '날짜는 YYYY-MM-DD 형식이어야 합니다.' });
    return;
  }

  await repo.patch(row.id, {
    title: req.body?.title !== undefined ? String(req.body.title).trim() : undefined,
    note:
      req.body?.note !== undefined ? (req.body.note ? String(req.body.note) : null) : undefined,
    date: req.body?.date !== undefined ? date : undefined,
    endDate: req.body?.endDate !== undefined ? endDate : undefined,
    together: req.body?.together !== undefined ? Boolean(req.body.together) : undefined,
  });

  await bumpVersion(req.space!.id, 'todo:updated');
  res.json({ todo: await repo.getForViewer(row.id, req.user!.id) });
});

/**
 * 완료 토글 — 주인, 또는 "같이" 항목이면 같은 공간의 둘 다.
 * 상대 갈래의 보통 항목은 여기서 막힌다.
 */
todosRouter.post('/:id/toggle', async (req, res) => {
  const row = await repo.getById(Number(req.params.id));
  if (!row || row.space_id !== req.space!.id) {
    res.status(404).json({ error: '할 일을 찾을 수 없습니다.' });
    return;
  }

  const isOwner = row.owner_id === req.user!.id;
  if (!isOwner && row.together !== 1) {
    res.status(403).json({ error: '상대의 할 일은 체크할 수 없어요.' });
    return;
  }

  const next = req.body?.done === undefined ? row.done !== 1 : Boolean(req.body.done);
  await repo.setDone(row.id, next, req.user!.id);

  await bumpVersion(req.space!.id, 'todo:toggled');
  res.json({ todo: await repo.getForViewer(row.id, req.user!.id) });
});

/** 지우기 — 주인만. */
todosRouter.delete('/:id', async (req, res) => {
  const row = await repo.getById(Number(req.params.id));
  if (!row || row.space_id !== req.space!.id) {
    res.status(404).json({ error: '할 일을 찾을 수 없습니다.' });
    return;
  }
  if (row.owner_id !== req.user!.id) {
    res.status(403).json({ error: '상대의 할 일은 지울 수 없어요.' });
    return;
  }

  await repo.remove(row.id);
  await bumpVersion(req.space!.id, 'todo:deleted');
  res.json({ ok: true });
});

/** 같은 날 안에서 순서 다시 매기기 — 내 항목만 넘길 수 있다. */
todosRouter.post('/reorder', async (req, res) => {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  if (ids.some((id) => !Number.isInteger(id))) {
    res.status(400).json({ error: 'ids 는 정수 배열이어야 합니다.' });
    return;
  }

  for (const id of ids) {
    const row = await repo.getById(id);
    if (!row || row.space_id !== req.space!.id || row.owner_id !== req.user!.id) {
      res.status(403).json({ error: '내 할 일만 순서를 바꿀 수 있어요.' });
      return;
    }
  }

  await repo.reorder(req.space!.id, ids);
  await bumpVersion(req.space!.id, 'todo:reordered');
  res.json({ ok: true });
});

/** 밀린 내 항목을 오늘로. */
todosRouter.post('/carry-forward', async (req, res) => {
  const today = readDate(req.body?.today);
  if (!today) {
    res.status(400).json({ error: 'today 를 YYYY-MM-DD 로 주세요.' });
    return;
  }
  const moved = await repo.carryForward(req.space!.id, req.user!.id, today);
  await bumpVersion(req.space!.id, 'todo:updated');
  res.json({ moved });
});

// ---------------------------------------------------------------- 하위 체크

todosRouter.post('/:id/subtasks', async (req, res) => {
  const row = await repo.getById(Number(req.params.id));
  if (!row || row.space_id !== req.space!.id) {
    res.status(404).json({ error: '할 일을 찾을 수 없습니다.' });
    return;
  }
  if (row.owner_id !== req.user!.id) {
    res.status(403).json({ error: '상대의 할 일은 고칠 수 없어요.' });
    return;
  }
  const title = String(req.body?.title ?? '').trim();
  if (!title) {
    res.status(400).json({ error: '내용을 적어 주세요.' });
    return;
  }

  await repo.addSubtask(row.id, title);
  await bumpVersion(req.space!.id, 'todo:updated');
  res.status(201).json({ todo: await repo.getForViewer(row.id, req.user!.id) });
});

todosRouter.patch('/subtasks/:subId', async (req, res) => {
  const parentId = await repo.findSubtaskParent(Number(req.params.subId));
  const parent = parentId === null ? null : await repo.getById(parentId);
  if (!parent || parent.space_id !== req.space!.id) {
    res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    return;
  }
  if (parent.owner_id !== req.user!.id && parent.together !== 1) {
    res.status(403).json({ error: '상대의 할 일은 체크할 수 없어요.' });
    return;
  }

  await repo.patchSubtask(Number(req.params.subId), {
    title: req.body?.title !== undefined ? String(req.body.title) : undefined,
    done: req.body?.done !== undefined ? Boolean(req.body.done) : undefined,
  });
  await bumpVersion(req.space!.id, 'todo:updated');
  res.json({ todo: await repo.getForViewer(parent.id, req.user!.id) });
});

todosRouter.delete('/subtasks/:subId', async (req, res) => {
  const parentId = await repo.findSubtaskParent(Number(req.params.subId));
  const parent = parentId === null ? null : await repo.getById(parentId);
  if (!parent || parent.space_id !== req.space!.id) {
    res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    return;
  }
  if (parent.owner_id !== req.user!.id) {
    res.status(403).json({ error: '상대의 할 일은 고칠 수 없어요.' });
    return;
  }

  await repo.removeSubtask(Number(req.params.subId));
  await bumpVersion(req.space!.id, 'todo:updated');
  res.json({ todo: await repo.getForViewer(parent.id, req.user!.id) });
});
