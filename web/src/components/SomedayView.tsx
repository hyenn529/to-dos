import { BUCKET_ORDER, groupByBucket, useStore } from '../lib/store.tsx';
import { LaneColumn } from './LaneColumn.tsx';

/**
 * 언젠가 — 날짜를 안 정한 것들이 담기는 서랍.
 * 알림도 독촉도 없다. 생각날 때 꺼내 오늘로 옮기면 된다.
 */
export function SomedayView() {
  const { someday, me } = useStore();
  const grouped = groupByBucket(someday);
  const buckets = BUCKET_ORDER.filter((bucket) => bucket !== 'partner' || me?.partner);

  return (
    <>
      <p className="drawer-note">
        날짜를 안 정한 일들입니다. 여기 있는 동안은 아무 일도 일어나지 않아요 — 알림도, 독촉도 없습니다.
      </p>
      <div className="lanes" data-count={buckets.length}>
        {buckets.map((bucket) => (
          <LaneColumn key={bucket} bucket={bucket} todos={grouped[bucket]} date={null} />
        ))}
      </div>
    </>
  );
}
