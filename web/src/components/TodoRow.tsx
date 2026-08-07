import { useState } from 'react';
import { api } from '../lib/api.ts';
import * as d from '../lib/dates.ts';
import { DRAG_TYPE, moveFields, spanOf } from '../lib/move.ts';
import { useStore } from '../lib/store.tsx';
import type { Todo } from '../lib/types.ts';
import { Avatar } from './Avatar.tsx';

/**
 * 할 일 한 줄.
 *
 * 체크 표시는 **누를 수 있을 때만 체크박스로 그린다.** 상대 것은 흐린 체크박스가 아니라
 * 아예 다른 모양(점)으로 바꿔서, 눌러 보기 전에 못 누른다는 걸 알 수 있게 한다.
 */
export function TodoRow({ todo, compact = false }: { todo: Todo; compact?: boolean }) {
  const { refresh, notify, me } = useStore();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draftSub, setDraftSub] = useState('');

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const done = todo.done;
  const partnerInitial = me?.partner?.initial ?? '?';
  const myInitial = me?.user.initial ?? '?';

  const span = spanOf(todo.date, todo.endDate);
  /** 다른 날로 옮기기. 여러 날짜리면 기간을 유지한 채 통째로 민다. */
  const moveTo = (next: string | null) =>
    run(() => api.update(todo.id, moveFields(next, span)));

  const meta: string[] = [];
  if (todo.endDate && todo.endDate !== todo.date) {
    const span = d.daysFromToday(todo.date!) > 0 ? `${d.daysFromToday(todo.date!)}일 뒤 시작` : null;
    meta.push(
      `${Number(todo.date!.slice(5, 7))}/${Number(todo.date!.slice(8, 10))}–${Number(
        todo.endDate.slice(5, 7),
      )}/${Number(todo.endDate.slice(8, 10))}`,
    );
    if (span) meta.push(span);
  }
  if (todo.carriedFrom) meta.push('어제에서');
  if (todo.subtasks.length > 0) {
    const doneCount = todo.subtasks.filter((s) => s.done).length;
    meta.push(`${todo.subtasks.length}개 중 ${doneCount}개 완료`);
  }

  const togetherBadge = todo.together ? (
    <span className="badge badge--together" title="둘 다 체크할 수 있는 일">
      <Avatar initial={myInitial} bucket="mine" />
      <Avatar initial={partnerInitial} bucket="partner" stacked />
      {compact ? null : '같이'}
    </span>
  ) : null;

  // 달력 칸으로 끌어다 놓으면 그 날로 옮겨진다. 손가락으로는 되지 않으므로
  // 아래 '날짜' 고르기가 본 길이고, 끌어놓기는 마우스에서의 지름길이다.
  return (
    <li
      className={`row${done ? ' is-done' : ''}${compact ? ' row--compact' : ''}`}
      data-bucket={todo.bucket}
      draggable={todo.canEdit || undefined}
      onDragStart={(event) => {
        if (!todo.canEdit) return;
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: todo.id, span }));
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="row__main">
        {todo.canCheck ? (
          <button
            type="button"
            className={`check${done ? ' is-checked' : ''}`}
            data-bucket={todo.bucket}
            disabled={busy}
            aria-pressed={done}
            aria-label={done ? `${todo.title} 완료 취소` : `${todo.title} 완료`}
            onClick={() => run(() => api.toggle(todo.id))}
          />
        ) : (
          <span
            className={`dot${done ? ' is-checked' : ''}`}
            data-bucket={todo.bucket}
            title="상대의 할 일이라 체크할 수 없어요"
            aria-label="상대의 할 일"
          />
        )}

        <div className="row__body">
          <button
            type="button"
            className="row__title"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {todo.title}
          </button>
          {meta.length > 0 && !compact ? (
            <span className="row__meta">{meta.join(' · ')}</span>
          ) : null}
          {/* 주간 칸은 좁아서 배지를 제목 옆에 두면 제목이 한 글자씩 쪼개진다. 아래로 내린다. */}
          {compact ? togetherBadge : null}
        </div>

        {compact ? null : togetherBadge}
      </div>

      {todo.subtasks.length > 0 && !compact ? (
        <ul className="subs">
          {todo.subtasks.map((sub) => (
            <li key={sub.id} className={sub.done ? 'is-done' : undefined}>
              {todo.canCheck ? (
                <button
                  type="button"
                  className={`check check--sm${sub.done ? ' is-checked' : ''}`}
                  data-bucket={todo.bucket}
                  disabled={busy}
                  aria-pressed={sub.done}
                  aria-label={sub.title}
                  onClick={() => run(() => api.toggleSubtask(sub.id, !sub.done))}
                />
              ) : (
                <span className="dot dot--sm" data-bucket={todo.bucket} aria-hidden="true" />
              )}
              <span>{sub.title}</span>
              {todo.canEdit ? (
                <button
                  type="button"
                  className="subs__remove"
                  aria-label={`${sub.title} 삭제`}
                  onClick={() => run(() => api.removeSubtask(sub.id))}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {expanded && !compact ? (
        <div className="row__tools">
          {todo.canEdit ? (
            <>
              <form
                className="row__subform"
                onSubmit={(event) => {
                  event.preventDefault();
                  const title = draftSub.trim();
                  if (!title) return;
                  setDraftSub('');
                  void run(() => api.addSubtask(todo.id, title));
                }}
              >
                <input
                  value={draftSub}
                  onChange={(event) => setDraftSub(event.target.value)}
                  placeholder="쪼개서 적기"
                  aria-label="하위 항목 추가"
                />
                <button type="submit" disabled={busy || draftSub.trim().length === 0}>
                  추가
                </button>
              </form>

              {/*
                한 줄에 다 넣으면 좁은 화면에서 제멋대로 접힌다.
                자주 쓰는 세 개를 윗줄에 묶고, 폭을 먹는 날짜와 위험한 지우기를 아랫줄로 내린다.
              */}
              <div className="row__actions">
                <button
                  type="button"
                  onClick={() => run(() => api.update(todo.id, { together: !todo.together }))}
                >
                  {todo.together ? '같이 해제' : '＋ 같이'}
                </button>
                <button
                  type="button"
                  onClick={() => moveTo(d.addDays(todo.date ?? d.today(), 1))}
                  disabled={todo.date === null}
                >
                  내일로
                </button>
                <button type="button" onClick={() => moveTo(null)} disabled={todo.date === null}>
                  언젠가로
                </button>
              </div>

              <div className="row__actions">
                {/* 아무 날로나. 달력을 띄우는 건 기기가 하므로 폰에서도 그대로 된다. */}
                <label className="row__pick">
                  날짜
                  <input
                    type="date"
                    value={todo.date ?? ''}
                    aria-label="다른 날짜로 옮기기"
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next) void moveTo(next);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => run(() => api.remove(todo.id))}
                >
                  지우기
                </button>
              </div>
            </>
          ) : (
            <p className="row__hint">
              {me?.partner?.name ?? '상대'} 님의 할 일이라 보기만 할 수 있어요.
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}
