import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from './api.ts';
import * as d from './dates.ts';
import type { Bucket, DayLoad, Me, Todo, ViewMode } from './types.ts';

type State = {
  me: Me | null;
  ready: boolean;
  view: ViewMode;
  /** 화면이 보고 있는 날짜 */
  selected: string;
  /** 달력이 펼쳐 놓은 달 */
  month: string;
  todos: Todo[];
  someday: Todo[];
  load: Map<string, DayLoad>;
  overdue: number;
  error: string | null;
};

type Actions = {
  setView(view: ViewMode): void;
  selectDate(date: string): void;
  stepMonth(delta: number): void;
  goToday(): void;
  refresh(): Promise<void>;
  signIn(me: Me): void;
  signOut(): Promise<void>;
  /** 갈래 이름 — 보는 사람 기준 */
  bucketName(bucket: Bucket): string;
  notify(message: string | null): void;
};

const StoreContext = createContext<(State & Actions) | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<ViewMode>('day');
  const [selected, setSelected] = useState(d.today());
  const [month, setMonth] = useState(d.startOfMonth(d.today()));
  const [todos, setTodos] = useState<Todo[]>([]);
  const [someday, setSomeday] = useState<Todo[]>([]);
  const [load, setLoad] = useState<Map<string, DayLoad>>(new Map());
  const [overdue, setOverdue] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // 화면이 지금 필요로 하는 날짜 구간
  const range = useMemo(() => {
    if (view === 'week') {
      const week = d.weekOf(selected);
      return { from: week[0]!, to: week[6]! };
    }
    return { from: selected, to: selected };
  }, [view, selected]);

  const monthRange = useMemo(() => {
    const grid = d.monthGrid(month);
    return { from: grid[0]!, to: grid[41]! };
  }, [month]);

  const refresh = useCallback(async () => {
    if (!me) return;
    try {
      const [ranged, loaded, drawer] = await Promise.all([
        api.range(range.from, range.to),
        api.load(monthRange.from, monthRange.to, d.today()),
        view === 'someday' ? api.someday() : Promise.resolve({ todos: [] as Todo[] }),
      ]);
      setTodos(ranged.todos);
      setLoad(new Map(loaded.days.map((day) => [day.date, day])));
      setOverdue(loaded.overdue);
      if (view === 'someday') setSomeday(drawer.todos);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        return;
      }
      setError(err instanceof Error ? err.message : '불러오지 못했습니다.');
    }
  }, [me, range.from, range.to, monthRange.from, monthRange.to, view]);

  // 첫 진입에 로그인 상태 확인
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((value) => alive && setMe(value))
      .catch(() => undefined)
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 상대가 무언가 바꾸면 화면이 스스로 최신으로 맞춘다.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!me) return;
    const source = new EventSource('/api/events');
    const onChange = () => void refreshRef.current();
    source.addEventListener('change', onChange);
    return () => {
      source.removeEventListener('change', onChange);
      source.close();
    };
  }, [me]);

  // 탭으로 돌아왔을 때도 한 번 맞춘다 (모바일에서 SSE 가 끊겨 있을 수 있다).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const selectDate = useCallback((date: string) => {
    setSelected(date);
    setMonth(d.startOfMonth(date));
  }, []);

  const stepMonth = useCallback((delta: number) => {
    setMonth((current) => d.addMonths(current, delta));
  }, []);

  const goToday = useCallback(() => {
    const now = d.today();
    setSelected(now);
    setMonth(d.startOfMonth(now));
  }, []);

  const signIn = useCallback((value: Me) => {
    setMe(value);
    setReady(true);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setMe(null);
    setTodos([]);
    setSomeday([]);
    setLoad(new Map());
  }, []);

  const bucketName = useCallback(
    (bucket: Bucket) => {
      if (bucket === 'work') return '업무';
      if (bucket === 'mine') return me?.user.name ?? '나';
      return me?.partner?.name ?? '상대';
    },
    [me],
  );

  const value = useMemo(
    () => ({
      me,
      ready,
      view,
      selected,
      month,
      todos,
      someday,
      load,
      overdue,
      error,
      setView,
      selectDate,
      stepMonth,
      goToday,
      refresh,
      signIn,
      signOut,
      bucketName,
      notify: setError,
    }),
    [
      me,
      ready,
      view,
      selected,
      month,
      todos,
      someday,
      load,
      overdue,
      error,
      selectDate,
      stepMonth,
      goToday,
      refresh,
      signIn,
      signOut,
      bucketName,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('StoreProvider 안에서만 쓸 수 있습니다.');
  return value;
}

/** 한 날짜의 할 일을 갈래별로 나눈다. 순서는 언제나 나 → 상대 → 업무. */
export function groupByBucket(todos: Todo[]): Record<Bucket, Todo[]> {
  const out: Record<Bucket, Todo[]> = { mine: [], partner: [], work: [] };
  for (const todo of todos) out[todo.bucket].push(todo);
  for (const list of Object.values(out)) {
    list.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.position - b.position || a.id - b.id;
    });
  }
  return out;
}

export const BUCKET_ORDER: Bucket[] = ['mine', 'partner', 'work'];
