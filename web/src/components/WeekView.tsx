import * as d from '../lib/dates.ts';
import { useStore } from '../lib/store.tsx';
import { TodoRow } from './TodoRow.tsx';

/**
 * 이번 주 — 시간축은 없다. 그냥 목록 일곱 개.
 * 비어 있는 시간이 보이지 않으니 채워야 한다는 압박도 생기지 않는다.
 */
export function WeekView() {
  const { todos, selected, selectDate } = useStore();
  const week = d.weekOf(selected);
  const today = d.today();

  const byDate = new Map<string, typeof todos>();
  for (const key of week) byDate.set(key, []);
  for (const todo of todos) {
    // 여러 날 항목은 걸쳐 있는 모든 날 칸에 들어간다.
    const start = todo.date!;
    const end = todo.endDate ?? start;
    for (const key of week) {
      if (key >= start && key <= end) byDate.get(key)!.push(todo);
    }
  }

  return (
    <div className="week">
      {week.map((key) => {
        const list = byDate.get(key)!;
        const classes = ['week__col'];
        if (key === today) classes.push('is-today');
        if (d.weekdayIndex(key) === 0 || d.weekdayIndex(key) === 6) classes.push('is-rest');

        return (
          <section key={key} className={classes.join(' ')}>
            <button type="button" className="week__head" onClick={() => selectDate(key)}>
              <span className="week__dow">
                {d.weekdayLabel(key)}
                {key === today ? ' · 오늘' : ''}
              </span>
              <span className="week__num">{d.dayNumber(key)}</span>
            </button>

            <ul className="week__list">
              {list
                .slice()
                .sort((a, b) => {
                  if (a.done !== b.done) return a.done ? 1 : -1;
                  return a.position - b.position || a.id - b.id;
                })
                .map((todo) => (
                  <TodoRow key={`${key}-${todo.id}`} todo={todo} compact />
                ))}
              {list.length === 0 ? <li className="week__empty">비어 있음</li> : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
