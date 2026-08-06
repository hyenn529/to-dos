import { useState } from 'react';
import { api } from '../lib/api.ts';
import * as d from '../lib/dates.ts';
import { BUCKET_ORDER, groupByBucket, useStore } from '../lib/store.tsx';
import type { Bucket } from '../lib/types.ts';
import { LaneColumn } from './LaneColumn.tsx';

/** 하루 화면 — 나 · 상대 · 업무 세 칸. 좁은 화면에서는 갈래 칩으로 걸러 본다. */
export function DayView() {
  const { todos, selected, overdue, refresh, notify, bucketName, me } = useStore();
  const [filter, setFilter] = useState<Bucket | 'all'>('all');
  const [carrying, setCarrying] = useState(false);

  const grouped = groupByBucket(todos);
  const buckets = BUCKET_ORDER.filter((bucket) => bucket !== 'partner' || me?.partner);

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

      <div className="chips chips--mobile" role="tablist" aria-label="갈래 고르기">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={filter === 'all' ? 'is-on' : undefined}
          onClick={() => setFilter('all')}
        >
          전체
        </button>
        {buckets.map((bucket) => (
          <button
            key={bucket}
            type="button"
            role="tab"
            data-bucket={bucket}
            aria-selected={filter === bucket}
            className={filter === bucket ? 'is-on' : undefined}
            onClick={() => setFilter(bucket)}
          >
            {bucketName(bucket)}
          </button>
        ))}
      </div>

      <div className="lanes" data-count={buckets.length}>
        {buckets
          .filter((bucket) => filter === 'all' || filter === bucket)
          .map((bucket) => (
            <LaneColumn key={bucket} bucket={bucket} todos={grouped[bucket]} date={selected} />
          ))}
      </div>
    </>
  );
}
