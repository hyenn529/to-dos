import type { Response } from 'express';

/**
 * 아주 작은 SSE 허브.
 *
 * 둘이 쓰는 앱이라 연결 수가 손에 꼽히므로 메모리에 들고 있어도 충분하다.
 * 한쪽이 무언가 바꾸면 같은 공간의 다른 연결에 "다시 불러와" 신호만 보낸다 —
 * 변경 내용을 실어 보내지 않으므로 권한 계산이 새어 나갈 일이 없다.
 */

type Client = {
  spaceId: number;
  userId: number;
  res: Response;
};

const clients = new Set<Client>();

export function addClient(spaceId: number, userId: number, res: Response): () => void {
  const client: Client = { spaceId, userId, res };
  clients.add(client);
  return () => clients.delete(client);
}

export type ChangeReason =
  | 'todo:created'
  | 'todo:updated'
  | 'todo:deleted'
  | 'todo:toggled'
  | 'todo:reordered'
  | 'space:joined';

/**
 * 같은 공간의 모든 연결에 알린다.
 * @param exceptUserId 변경을 일으킨 본인. 이미 응답으로 최신 상태를 받았으므로 건너뛴다.
 */
export function broadcast(
  spaceId: number,
  reason: ChangeReason,
  exceptUserId?: number,
): void {
  const payload = JSON.stringify({ reason, at: Date.now() });
  for (const client of clients) {
    if (client.spaceId !== spaceId) continue;
    if (exceptUserId !== undefined && client.userId === exceptUserId) continue;
    try {
      client.res.write(`event: change\ndata: ${payload}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

/** 프록시가 유휴 연결을 끊지 않도록 주기적으로 주석 줄을 보낸다. */
export function startHeartbeat(intervalMs = 25_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    for (const client of clients) {
      try {
        client.res.write(': ping\n\n');
      } catch {
        clients.delete(client);
      }
    }
  }, intervalMs);
  timer.unref();
  return timer;
}
