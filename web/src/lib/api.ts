import type { DayLoad, Me, Todo } from './types.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, payload?.error ?? '요청을 처리하지 못했습니다.');
  }
  return payload as T;
}

export const api = {
  // ---- 계정
  me: () => request<Me>('GET', '/api/auth/me'),
  login: (email: string, password: string) =>
    request<Me>('POST', '/api/auth/login', { email, password }),
  signup: (input: { email: string; name: string; password: string; inviteCode?: string }) =>
    request<Me>('POST', '/api/auth/signup', input),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  regenerateInvite: () =>
    request<{ inviteCode: string }>('POST', '/api/space/invite/regenerate'),
  joinSpace: (inviteCode: string) =>
    request<{ movedTodos: number }>('POST', '/api/space/join', { inviteCode }),

  // ---- 할 일
  range: (from: string, to: string) =>
    request<{ todos: Todo[] }>('GET', `/api/todos?from=${from}&to=${to}`),
  someday: () => request<{ todos: Todo[] }>('GET', '/api/todos/someday'),
  load: (from: string, to: string, today: string) =>
    request<{ days: DayLoad[]; overdue: number; version: number }>(
      'GET',
      `/api/todos/load?from=${from}&to=${to}&today=${today}`,
    ),
  /** 변경 번호만. 폴링이 이것만 물어보므로 응답이 아주 작다. */
  version: () => request<{ version: number }>('GET', '/api/todos/version'),
  create: (input: {
    title: string;
    lane: 'personal' | 'work';
    date: string | null;
    endDate?: string | null;
    together?: boolean;
  }) => request<{ todo: Todo }>('POST', '/api/todos', input),
  update: (
    id: number,
    input: Partial<{
      title: string;
      note: string | null;
      date: string | null;
      endDate: string | null;
      together: boolean;
    }>,
  ) => request<{ todo: Todo }>('PATCH', `/api/todos/${id}`, input),
  toggle: (id: number, done?: boolean) =>
    request<{ todo: Todo }>('POST', `/api/todos/${id}/toggle`, done === undefined ? {} : { done }),
  remove: (id: number) => request<{ ok: true }>('DELETE', `/api/todos/${id}`),
  reorder: (ids: number[]) => request<{ ok: true }>('POST', '/api/todos/reorder', { ids }),
  carryForward: (today: string) =>
    request<{ moved: number }>('POST', '/api/todos/carry-forward', { today }),

  // ---- 하위 체크
  addSubtask: (todoId: number, title: string) =>
    request<{ todo: Todo }>('POST', `/api/todos/${todoId}/subtasks`, { title }),
  toggleSubtask: (subId: number, done: boolean) =>
    request<{ todo: Todo }>('PATCH', `/api/todos/subtasks/${subId}`, { done }),
  removeSubtask: (subId: number) =>
    request<{ todo: Todo }>('DELETE', `/api/todos/subtasks/${subId}`),
};
