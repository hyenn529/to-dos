import { db } from './db.ts';
import type { Bucket, DayLoad, Subtask, Todo } from './types.ts';

type TodoRow = {
  id: number;
  space_id: number;
  owner_id: number;
  lane: 'personal' | 'work';
  title: string;
  note: string | null;
  date: string | null;
  end_date: string | null;
  position: number;
  together: number;
  done: number;
  done_at: string | null;
  done_by: number | null;
  carried_from: string | null;
  created_at: string;
  updated_at: string;
};

type SubtaskRow = {
  id: number;
  todo_id: number;
  title: string;
  done: number;
  position: number;
};

/**
 * 보는 사람 기준으로 어느 칸에 놓일지 계산한다.
 *
 * 두 축이 만나 네 칸이 된다 — 누구 것인가(나/상대) × 어떤 일인가(개인/업무).
 * 상대의 업무도 보이지만, 볼 수만 있고 체크하거나 고치지는 못한다.
 */
export function bucketFor(row: TodoRow, viewerId: number): Bucket {
  const isMine = row.owner_id === viewerId;
  if (row.lane === 'work') return isMine ? 'mineWork' : 'partnerWork';
  return isMine ? 'mine' : 'partner';
}

async function subtasksFor(todoIds: number[]): Promise<Map<number, Subtask[]>> {
  const out = new Map<number, Subtask[]>();
  if (todoIds.length === 0) return out;

  const placeholders = todoIds.map(() => '?').join(',');
  const rows = await db.all<SubtaskRow>(
    `SELECT id, todo_id, title, done, position
       FROM subtasks
      WHERE todo_id IN (${placeholders})
      ORDER BY position, id`,
    todoIds,
  );

  for (const row of rows) {
    const list = out.get(row.todo_id) ?? [];
    list.push({
      id: row.id,
      todoId: row.todo_id,
      title: row.title,
      done: row.done === 1,
      position: row.position,
    });
    out.set(row.todo_id, list);
  }
  return out;
}

function toTodo(row: TodoRow, viewerId: number, subtasks: Subtask[]): Todo {
  const bucket = bucketFor(row, viewerId);
  const isOwner = row.owner_id === viewerId;
  const together = row.together === 1;

  return {
    id: row.id,
    spaceId: row.space_id,
    ownerId: row.owner_id,
    lane: row.lane,
    bucket,
    title: row.title,
    note: row.note,
    date: row.date,
    endDate: row.end_date,
    position: row.position,
    together,
    done: row.done === 1,
    doneAt: row.done_at,
    doneBy: row.done_by,
    carriedFrom: row.carried_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    subtasks,
    // 체크는 자기 것만. 단 "같이" 항목은 둘 다 누를 수 있다.
    canCheck: isOwner || together,
    // 고치고 지우는 건 언제나 주인만.
    canEdit: isOwner,
    // 상대 갈래는 내 "남은 개수"에 들어가지 않는다.
    countable: isOwner,
  };
}

async function hydrate(rows: TodoRow[], viewerId: number): Promise<Todo[]> {
  const subtaskMap = await subtasksFor(rows.map((r) => r.id));
  return rows.map((row) => toTodo(row, viewerId, subtaskMap.get(row.id) ?? []));
}

const SELECT_TODO = `
  SELECT id, space_id, owner_id, lane, title, note, date, end_date, position,
         together, done, done_at, done_by, carried_from, created_at, updated_at
    FROM todos`;

/** 날짜 구간의 할 일. from/to 는 'YYYY-MM-DD', 양끝 포함. */
export async function listByRange(
  spaceId: number,
  viewerId: number,
  from: string,
  to: string,
): Promise<Todo[]> {
  const rows = await db.all<TodoRow>(
    `${SELECT_TODO}
      WHERE space_id = ?
        AND date IS NOT NULL
        AND date <= ?
        AND COALESCE(end_date, date) >= ?
      ORDER BY position, id`,
    [spaceId, to, from],
  );
  return hydrate(rows, viewerId);
}

/** 날짜가 없는 "언젠가" 서랍. */
export async function listSomeday(spaceId: number, viewerId: number): Promise<Todo[]> {
  const rows = await db.all<TodoRow>(
    `${SELECT_TODO} WHERE space_id = ? AND date IS NULL ORDER BY position, id`,
    [spaceId],
  );
  return hydrate(rows, viewerId);
}

export async function getById(id: number): Promise<TodoRow | null> {
  const row = await db.get<TodoRow>(`${SELECT_TODO} WHERE id = ?`, [id]);
  return row ?? null;
}

export async function getForViewer(id: number, viewerId: number): Promise<Todo | null> {
  const row = await getById(id);
  if (!row) return null;
  const subtasks = (await subtasksFor([id])).get(id) ?? [];
  return toTodo(row, viewerId, subtasks);
}

/**
 * 달력에 그릴 한 달치 밀도.
 * 여러 날에 걸친 항목은 걸쳐 있는 모든 날에 1씩 센다.
 */
export async function monthLoad(
  spaceId: number,
  viewerId: number,
  from: string,
  to: string,
): Promise<DayLoad[]> {
  const rows = await db.all<TodoRow>(
    `${SELECT_TODO}
      WHERE space_id = ?
        AND date IS NOT NULL
        AND date <= ?
        AND COALESCE(end_date, date) >= ?`,
    [spaceId, to, from],
  );

  const byDate = new Map<string, DayLoad & { total: number; doneCount: number }>();

  const touch = (date: string) => {
    let entry = byDate.get(date);
    if (!entry) {
      entry = {
        date,
        mine: 0,
        mineWork: 0,
        partner: 0,
        partnerWork: 0,
        allDone: false,
        total: 0,
        doneCount: 0,
      };
      byDate.set(date, entry);
    }
    return entry;
  };

  for (const row of rows) {
    const bucket = bucketFor(row, viewerId);

    for (const date of eachDate(row.date!, row.end_date, from, to)) {
      const entry = touch(date);
      entry[bucket] += 1;
      entry.total += 1;
      if (row.done === 1) entry.doneCount += 1;
    }
  }

  return [...byDate.values()]
    .map(({ total, doneCount, ...rest }) => ({
      ...rest,
      allDone: total > 0 && doneCount === total,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** start~end 를 하루씩 훑되 [clampFrom, clampTo] 밖은 버린다. */
function eachDate(
  start: string,
  end: string | null,
  clampFrom: string,
  clampTo: string,
): string[] {
  if (!end || end <= start) return start >= clampFrom && start <= clampTo ? [start] : [];

  const out: string[] = [];
  let cursor = start;
  // 한 항목이 1년을 넘게 걸치는 일은 없다고 보고 안전 상한을 둔다.
  for (let guard = 0; guard < 400 && cursor <= end; guard++) {
    if (cursor >= clampFrom && cursor <= clampTo) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- 쓰기

export type CreateInput = {
  spaceId: number;
  ownerId: number;
  lane: 'personal' | 'work';
  title: string;
  note?: string | null;
  date?: string | null;
  endDate?: string | null;
  together?: boolean;
};

export async function create(input: CreateInput): Promise<number> {
  const position = await nextPosition(input.spaceId, input.date ?? null);
  const result = await db.run(
    `INSERT INTO todos (space_id, owner_id, lane, title, note, date, end_date,
                        position, together)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.spaceId,
      input.ownerId,
      input.lane,
      input.title,
      input.note ?? null,
      input.date ?? null,
      input.endDate ?? null,
      position,
      input.together ? 1 : 0,
    ],
  );
  return result.lastInsertRowid;
}

async function nextPosition(spaceId: number, date: string | null): Promise<number> {
  const row = await db.get<{ maxPos: number | null }>(
    date === null
      ? 'SELECT MAX(position) AS maxPos FROM todos WHERE space_id = ? AND date IS NULL'
      : 'SELECT MAX(position) AS maxPos FROM todos WHERE space_id = ? AND date = ?',
    date === null ? [spaceId] : [spaceId, date],
  );
  return (row?.maxPos ?? 0) + 1;
}

export type PatchInput = {
  title?: string;
  note?: string | null;
  date?: string | null;
  endDate?: string | null;
  together?: boolean;
};

export async function patch(id: number, input: PatchInput): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.title !== undefined) {
    sets.push('title = ?');
    values.push(input.title);
  }
  if (input.note !== undefined) {
    sets.push('note = ?');
    values.push(input.note);
  }
  if (input.date !== undefined) {
    sets.push('date = ?');
    values.push(input.date);
  }
  if (input.endDate !== undefined) {
    sets.push('end_date = ?');
    values.push(input.endDate);
  }
  if (input.together !== undefined) {
    sets.push('together = ?');
    values.push(input.together ? 1 : 0);
  }
  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  values.push(id);
  await db.run(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function setDone(id: number, done: boolean, byUserId: number): Promise<void> {
  await db.run(
    `UPDATE todos
        SET done = ?, done_at = ?, done_by = ?, updated_at = datetime('now')
      WHERE id = ?`,
    [done ? 1 : 0, done ? new Date().toISOString() : null, done ? byUserId : null, id],
  );
}

export async function remove(id: number): Promise<void> {
  await db.run('DELETE FROM todos WHERE id = ?', [id]);
}

/** 같은 날 안에서의 순서를 통째로 다시 매긴다. */
export async function reorder(spaceId: number, orderedIds: number[]): Promise<void> {
  await db.batch(
    orderedIds.map((id, index) => ({
      sql: 'UPDATE todos SET position = ? WHERE id = ? AND space_id = ?',
      params: [index + 1, id, spaceId],
    })),
  );
}

/**
 * 어제까지 못 끝낸 내 항목을 오늘로 옮긴다.
 * 상대 갈래는 건드리지 않고, 원래 날짜를 carried_from 에 남겨 "어제에서" 배지를 띄운다.
 */
export async function carryForward(
  spaceId: number,
  ownerId: number,
  today: string,
): Promise<number> {
  const rows = await db.all<{ id: number; date: string }>(
    `SELECT id, date FROM todos
      WHERE space_id = ? AND owner_id = ? AND done = 0
        AND date IS NOT NULL AND COALESCE(end_date, date) < ?`,
    [spaceId, ownerId, today],
  );
  if (rows.length === 0) return 0;

  await db.batch(
    rows.map((row) => ({
      sql: `UPDATE todos
               SET date = ?, carried_from = COALESCE(carried_from, ?),
                   updated_at = datetime('now')
             WHERE id = ?`,
      params: [today, row.date, row.id],
    })),
  );
  return rows.length;
}

/** 오늘 이전에 남아 있는 내 항목 수 — "어제 못 한 일이 n개 있어요" 줄에 쓴다. */
export async function countOverdue(
  spaceId: number,
  ownerId: number,
  today: string,
): Promise<number> {
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM todos
      WHERE space_id = ? AND owner_id = ? AND done = 0
        AND date IS NOT NULL AND COALESCE(end_date, date) < ?`,
    [spaceId, ownerId, today],
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------- 하위 체크

export async function addSubtask(todoId: number, title: string): Promise<number> {
  const row = await db.get<{ maxPos: number | null }>(
    'SELECT MAX(position) AS maxPos FROM subtasks WHERE todo_id = ?',
    [todoId],
  );
  const result = await db.run(
    'INSERT INTO subtasks (todo_id, title, position) VALUES (?, ?, ?)',
    [todoId, title, (row?.maxPos ?? 0) + 1],
  );
  return result.lastInsertRowid;
}

export async function patchSubtask(
  id: number,
  input: { title?: string; done?: boolean },
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (input.title !== undefined) {
    sets.push('title = ?');
    values.push(input.title);
  }
  if (input.done !== undefined) {
    sets.push('done = ?');
    values.push(input.done ? 1 : 0);
  }
  if (sets.length === 0) return;
  values.push(id);
  await db.run(`UPDATE subtasks SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function removeSubtask(id: number): Promise<void> {
  await db.run('DELETE FROM subtasks WHERE id = ?', [id]);
}

export async function findSubtaskParent(id: number): Promise<number | null> {
  const row = await db.get<{ todo_id: number }>('SELECT todo_id FROM subtasks WHERE id = ?', [id]);
  return row?.todo_id ?? null;
}
