import { useState } from 'react';
import { api } from '../lib/api.ts';
import * as d from '../lib/dates.ts';
import { PERSON_ORDER, bucketsOf, groupByBucket, useStore } from '../lib/store.tsx';
import type { Person } from '../lib/types.ts';
import { LaneColumn } from './LaneColumn.tsx';

/**
 * 하루 화면.
 *
 * 사람으로 먼저 나누고(나 / 상대), 그 안에서 개인과 업무로 나눈다.
 * 갈래가 넷이라 평평하게 늘어놓으면 무엇이 누구 것인지 매번 읽어야 하지만,
 * 사람으로 묶어 두면 "내 칸"과 "상대 칸"을 먼저 보고 그 안을 훑게 된다.
 */
export function DayView() {
  const { todos, selected, overdue, refresh, notify, personName, me } = useStore();
  const [filter, setFilter] = useState<Person | 'all'>('all');
  const [carrying, setCarrying] = useState(false);

  const grouped = groupByBucket(todos);
  const people: Person[] = me?.partner ? PERSON_ORDER : ['mine'];

  const carryForward = async () => {
    setCarrying(true);
    try {
      await api.carryForward(d.today());
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : '옮기지 못했습니다.');
    } finally {
      setCarrying(false);
    }
  };

  const isToday = selected === d.today();
  const shown = people.filter((person) => filter === 'all' || filter === person);

  return (
    <>
      {overdue > 0 && isToday ? (
        <div className="carry">
          <span>
            어제까지 못 한 일이 <b>{overdue}개</b> 있어요.
          </span>
          <span className="carry__actions">
            <button type="button" className="is-primary" onClick={carryForward} disabled={carrying}>
              오늘로 옮기기
            </button>
          </span>
        </div>
      ) : null}

      {people.length > 1 ? (
        <div className="chips chips--mobile" role="tablist" aria-label="누구 것을 볼지 고르기">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={filter === 'all' ? 'is-on' : undefined}
            onClick={() => setFilter('all')}
          >
            둘 다
          </button>
          {people.map((person) => (
            <button
              key={person}
              type="button"
              role="tab"
              data-person={person}
              aria-selected={filter === person}
              className={filter === person ? 'is-on' : undefined}
              onClick={() => setFilter(person)}
            >
              {personName(person)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="people" data-count={shown.length}>
        {shown.map((person) => (
          <section key={person} className="person" data-person={person}>
            <header className="person__head">
              <i className="person__mark" />
              <h2>{personName(person)}</h2>
              {person === 'partner' ? <span className="person__tag">보기만</span> : null}
            </header>

            <div className="person__lanes">
              {bucketsOf(person).map((bucket) => (
                <LaneColumn
                  key={bucket}
                  bucket={bucket}
                  todos={grouped[bucket]}
                  date={selected}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
