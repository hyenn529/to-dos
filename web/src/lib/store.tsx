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
import type { Bucket, DayLoad, Me, Person, Todo, ViewMode } from './types.ts';

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
  /** 갈래 이름 — 보는 사람 기준. "혜인" / "혜인 업무" */
  bucketName(bucket: Bucket): string;
  /** 사람 이름만 */
  personName(person: Person): string;
  notify(message: string | null): void;
};

const StoreContext = createContext<(State & Actions) | null>(null);

/**
 * 변경 확인 주기. 둘이 쓰는 앱이라 8초면 체감상 즉시에 가깝다.
 * 화면을 보고 있을 때만 도므로 실제 요청 수는 이보다 훨씬 적다.
 */
const POLL_MS = 8_000;

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

  /** 마지막으로 반영한 공간의 변경 번호. 폴링이 이 값과 비교한다. */
  const seenVersion = useRef(-1);

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
      seenVersion.current = loaded.version;
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

  // 색은 사람에게 고정된다 — 자리(a/b)를 문서에 붙여 두면 팔레트가 알아서 맞춰진다.
  useEffect(() => {
    const root = document.documentElement;
    if (me) root.setAttribute('data-seat', me.seat);
    else root.removeAttribute('data-seat');
  }, [me]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  /**
   * 상대가 무언가 바꾸면 화면이 스스로 최신으로 맞춘다.
   *
   * 서버리스에서는 연결을 열어둘 수 없어 주기적으로 물어보는 방식을 쓴다. 대신
   *   ① 화면을 보고 있지 않으면 아예 묻지 않고 (다른 앱 보는 동안 요청 0),
   *   ② 물어보는 건 숫자 하나뿐이라 (`{"version":37}`) 바뀌었을 때만 실제로 불러온다.
   * 덕분에 하루 종일 켜둬도 요청 수가 얼마 되지 않는다.
   */
  useEffect(() => {
    if (!me) return;

    let timer: number | undefined;
    let stopped = false;

    const tick = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const { version } = await api.version();
        if (version !== seenVersion.current) await refreshRef.current();
      } catch {
        // 잠깐 끊긴 것뿐일 수 있다. 다음 차례에 다시 시도한다.
      }
    };

    const start = () => {
      window.clearInterval(timer);
      if (document.visibilityState !== 'visible') return;
      void tick();
      timer = window.setInterval(() => void tick(), POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else window.clearInterval(timer);
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [me]);

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

  const personName = useCallback(
    (person: Person) =>
      person === 'mine' ? (me?.user.name ?? '나') : (me?.partner?.name ?? '상대'),
    [me],
  );

  /** "혜인" / "혜인 업무" — 사람 이름 뒤에 업무만 덧붙인다. */
  const bucketName = useCallback(
    (bucket: Bucket) => {
      const person = personName(bucket === 'mine' || bucket === 'mineWork' ? 'mine' : 'partner');
      return bucket.endsWith('Work') ? `${person} 업무` : person;
    },
    [personName],
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
      personName,
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
      personName,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('StoreProvider 안에서만 쓸 수 있습니다.');
  return value;
}

/** 한 날짜의 할 일을 갈래별로 나눈다. 끝낸 것은 아래로. */
export function groupByBucket(todos: Todo[]): Record<Bucket, Todo[]> {
  const out: Record<Bucket, Todo[]> = { mine: [], mineWork: [], partner: [], partnerWork: [] };
  for (const todo of todos) {
    out[todo.bucket].push(todo);

    // 「같이」는 두 사람 모두의 일이다. 한 칸에만 두면 상대 칸이 비어서
    // "저 사람은 이걸 안 하나" 처럼 보인다. 상대 칸에도 비쳐 보이게 둔다.
    // 비친 쪽은 손대는 곳이 아니므로 점으로만 나온다 — 한 화면에 체크는 하나뿐이다.
    if (todo.together && todo.bucket === 'mine') {
      out.partner.push({ ...todo, bucket: 'partner', canCheck: false, canEdit: false });
    }
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.position - b.position || a.id - b.id;
    });
  }
  return out;
}

/** 어디서나 이 순서 — 내 것 먼저, 각자 개인 다음 업무. */
export const BUCKET_ORDER: Bucket[] = ['mine', 'mineWork', 'partner', 'partnerWork'];

export const PERSON_ORDER: Person[] = ['mine', 'partner'];

/** 사람 한 명이 가진 갈래 두 개 */
export function bucketsOf(person: Person): Bucket[] {
  return person === 'mine' ? ['mine', 'mineWork'] : ['partner', 'partnerWork'];
}

export function personOf(bucket: Bucket): Person {
  return bucket === 'mine' || bucket === 'mineWork' ? 'mine' : 'partner';
}
