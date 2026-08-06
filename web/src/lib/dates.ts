/**
 * 날짜는 전부 'YYYY-MM-DD' 문자열로 다룬다.
 * 서버는 이 문자열을 그대로 저장하므로 시간대 때문에 하루가 밀리는 일이 없다.
 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toKey(new Date());
}

export function addDays(key: string, days: number): string {
  const date = fromKey(key);
  date.setDate(date.getDate() + days);
  return toKey(date);
}

export function addMonths(key: string, months: number): string {
  const date = fromKey(key);
  const targetMonth = date.getMonth() + months;
  // 31일에서 2월로 넘어갈 때 다음 달로 튀지 않도록 1일로 맞춘 뒤 옮긴다.
  date.setDate(1);
  date.setMonth(targetMonth);
  return toKey(date);
}

export function startOfMonth(key: string): string {
  const date = fromKey(key);
  date.setDate(1);
  return toKey(date);
}

export function endOfMonth(key: string): string {
  const date = fromKey(key);
  date.setMonth(date.getMonth() + 1, 0);
  return toKey(date);
}

/** 일요일 시작. 달력 격자는 항상 6주(42칸)로 그려 높이가 달마다 흔들리지 않게 한다. */
export function monthGrid(key: string): string[] {
  const first = fromKey(startOfMonth(key));
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  const out: string[] = [];
  for (let i = 0; i < 42; i++) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    out.push(toKey(day));
  }
  return out;
}

/** 일요일 시작 한 주. */
export function weekOf(key: string): string[] {
  const date = fromKey(key);
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return toKey(day);
  });
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function weekdayIndex(key: string): number {
  return fromKey(key).getDay();
}

export function weekdayLabel(key: string): string {
  return WEEKDAYS[weekdayIndex(key)]!;
}

export function dayNumber(key: string): number {
  return Number(key.slice(8, 10));
}

export function monthLabel(key: string): string {
  return `${Number(key.slice(5, 7))}월`;
}

export function yearLabel(key: string): string {
  return key.slice(0, 4);
}

/** "8월 6일 목요일" */
export function longLabel(key: string): string {
  const date = fromKey(key);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${weekdayLabel(key)}요일`;
}

/** "8월 6일 목" — 좁은 화면용 */
export function shortLabel(key: string): string {
  const date = fromKey(key);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${weekdayLabel(key)}`;
}

/** 오늘로부터 며칠 뒤인지. 지난 날은 음수. */
export function daysFromToday(key: string): number {
  const a = fromKey(today()).getTime();
  const b = fromKey(key).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * 날짜를 사람이 읽는 말로. 시각은 어디에도 등장하지 않는다.
 * "오늘 / 내일 / 어제 / 이번 주 안에 / 8월 12일"
 */
export function relativeLabel(key: string): string {
  const diff = daysFromToday(key);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  if (diff > 1 && diff <= 6) return `${weekdayLabel(key)}요일`;
  if (diff < -1 && diff >= -6) return `지난 ${weekdayLabel(key)}요일`;
  return `${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일`;
}
