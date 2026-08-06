import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.tsx';
import type { Bucket, Todo } from '../lib/types.ts';
import { TodoRow } from './TodoRow.tsx';

/**
 * 갈래 한 칸.
 *
 * 상대 칸에는 추가 입력이 없다 — 각자 자기 갈래만 쓴다.
 * 개수도 상대 칸은 "n 남음"이 아니라 "n 건"으로 적는다. 완료를 세지 않기 때문이다.
 */
export function LaneColumn({
  bucket,
  todos,
  date,
}: {
  bucket: Bucket;
  todos: Todo[];
  date: string | null;
}) {
  const { bucketName, refresh, notify } = useStore();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const editable = bucket !== 'partner';
  const open = todos.filter((todo) => !todo.done);
  const closed = todos.filter((todo) => todo.done);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setBusy(true);
    try {
      await api.create({
        title,
        lane: bucket === 'work' ? 'work' : 'personal',
        date,
      });
      setDraft('');
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : '추가하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lane" data-bucket={bucket}>
      <header className="lane__head">
        <i className="lane__mark" />
        <h2 className="lane__name">{bucketName(bucket)}</h2>
        {bucket === 'partner' ? <span className="lane__tag">보기만</span> : null}
        {bucket === 'work' ? <span className="lane__tag">나만 보임</span> : null}
        <span className="lane__count">
          {editable ? `${open.length} 남음` : `${todos.length} 건`}
        </span>
      </header>

      {open.length === 0 && closed.length === 0 ? (
        <p className="lane__empty">
          {editable ? '비어 있어요.' : `${bucketName(bucket)} 님 일정이 없어요.`}
        </p>
      ) : null}

      <ul className="lane__list">
        {open.map((todo) => (
          <TodoRow key={todo.id} todo={todo} />
        ))}
      </ul>

      {closed.length > 0 ? (
        <>
          <button type="button" className="lane__fold" onClick={() => setShowDone((v) => !v)}>
            완료한 {closed.length}개 {showDone ? '접기 ▴' : '보기 ▾'}
          </button>
          {showDone ? (
            <ul className="lane__list">
              {closed.map((todo) => (
                <TodoRow key={todo.id} todo={todo} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {editable ? (
        <form className="lane__add" onSubmit={submit}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`＋ ${bucketName(bucket)} 할 일`}
            aria-label={`${bucketName(bucket)} 갈래에 할 일 추가`}
            disabled={busy}
          />
        </form>
      ) : null}
    </section>
  );
}
