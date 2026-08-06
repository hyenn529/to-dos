import { db } from './db.ts';

/**
 * 변경 감지.
 *
 * 예전에는 연결을 열어두고 밀어주는 방식(SSE)이었는데, 서버리스에서는 프로세스가
 * 요청 사이에 살아 있지 않아 연결을 유지할 수 없다. 그래서 **공간마다 숫자 하나**를 두고
 * 쓰기가 일어날 때마다 올린다. 화면은 이 숫자만 물어보고, 바뀌었을 때만 전체를 다시 부른다.
 *
 * 응답이 `{"version":37}` 한 줄이라 자주 물어봐도 부담이 없고,
 * 변경 내용을 실어 보내지 않으므로 남에게 보이면 안 되는 항목이 새어 나갈 길도 없다.
 */

export type ChangeReason =
  | 'todo:created'
  | 'todo:updated'
  | 'todo:deleted'
  | 'todo:toggled'
  | 'todo:reordered'
  | 'space:joined';

/** 공간의 변경 번호를 1 올린다. 쓰기를 하는 모든 곳에서 부른다. */
export async function bumpVersion(spaceId: number, _reason: ChangeReason): Promise<void> {
  await db.run('UPDATE spaces SET version = version + 1 WHERE id = ?', [spaceId]);
}

export async function readVersion(spaceId: number): Promise<number> {
  const row = await db.get<{ version: number }>('SELECT version FROM spaces WHERE id = ?', [
    spaceId,
  ]);
  return row?.version ?? 0;
}
