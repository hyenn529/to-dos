import { type DragEvent, useState } from 'react';
import { api } from '../lib/api.ts';
import * as d from '../lib/dates.ts';
import { DRAG_TYPE, moveFields, type DragPayload } from '../lib/move.ts';
import { useStore } from '../lib/store.tsx';
import type { Bucket, DayLoad } from '../lib/types.ts';
import { AvatarPair } from './Avatar.tsx';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 막대 순서는 어디서나 고정 — 내 개인·업무 먼저, 그다음 상대. */
const BAR_ORDER: Bucket[] = ['mine', 'mineWork', 'partner', 'partnerWork'];

/** 개수를 세 단계 길이로 줄인다. 정확한 수는 눌러서 보면 된다. */
function step(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  return 3;
}

function Bars({ load }: { load: DayLoad | undefined }) {
  return (
    <span className="cal__bars">
      {BAR_ORDER.map((bucket) => {
        const size = load ? step(load[bucket]) : 0;
        if (size === 0) return null;
        return (
          <i
            key={bucket}
            className={`cal__bar cal__bar--${size}${load!.allDone ? ' cal__bar--done' : ''}`}
            data-bucket={bucket}
          />
        );
      })}
    </span>
  );
}

/** 톱니바퀴. 선만으로 그려서 어느 테마에서나 글자색을 따라간다. */
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.1 14.4a1.4 1.4 0 0 0 .3 1.6l.1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.4 1.4 0 0 0-1.6-.3 1.4 1.4 0 0 0-.9 1.3v.2a1.7 1.7 0 1 1-3.4 0v-.1a1.4 1.4 0 0 0-.9-1.3 1.4 1.4 0 0 0-1.6.3l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.4 1.4 0 0 0 .3-1.6 1.4 1.4 0 0 0-1.3-.9h-.2a1.7 1.7 0 1 1 0-3.4h.1a1.4 1.4 0 0 0 1.3-.9 1.4 1.4 0 0 0-.3-1.6l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.4 1.4 0 0 0 1.6.3h.1a1.4 1.4 0 0 0 .9-1.3v-.2a1.7 1.7 0 1 1 3.4 0v.1a1.4 1.4 0 0 0 .9 1.3 1.4 1.4 0 0 0 1.6-.3l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.4 1.4 0 0 0-.3 1.6v.1a1.4 1.4 0 0 0 1.3.9h.2a1.7 1.7 0 1 1 0 3.4h-.1a1.4 1.4 0 0 0-1.3.9Z"
      />
    </svg>
  );
}

/**
 * 늘 화면에 있는 월간 달력.
 *
 * 칸 안에 글자는 날짜 숫자뿐이고, 그날의 양은 얇은 막대로만 보여준다.
 * 좁은 화면에서는 위쪽에 붙어 따라다니며, 접으면 이번 주 한 줄만 남는다 —
 * 사라지지는 않는다.
 */
export function CalendarPane({
  collapsed = false,
  onToggleCollapse,
  onOpenSettings,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenSettings?: () => void;
}) {
  const {
    me,
    month,
    selected,
    load,
    view,
    selectDate,
    stepMonth,
    goToday,
    bucketName,
    refresh,
    notify,
  } = useStore();
  // 지금 손이 올라와 있는 칸. 어디에 놓이는지 보이지 않으면 끌어놓기는 도박이 된다.
  const [over, setOver] = useState<string | null>(null);

  const read = (event: DragEvent): DragPayload | null => {
    const raw = event.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as DragPayload;
      return typeof value?.id === 'number' ? value : null;
    } catch {
      return null;
    }
  };

  const drop = async (event: DragEvent, key: string) => {
    const payload = read(event);
    setOver(null);
    if (!payload) return;
    event.preventDefault();
    try {
      await api.update(payload.id, moveFields(key, payload.span ?? 0));
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : '옮기지 못했습니다.');
    }
  };

  const days = collapsed ? d.weekOf(selected) : d.monthGrid(month);
  const today = d.today();
  const week = view === 'week' ? new Set(d.weekOf(selected)) : null;

  return (
    <aside className={`pane${collapsed ? ' is-collapsed' : ''}`}>
      <header className="pane__brand">
        <span className="pane__mark" aria-hidden="true" />
        <span className="pane__title">하루</span>
        {/* 아바타와 톱니바퀴가 한 버튼이다 — 어느 쪽을 눌러도 설정이 열린다. */}
        <button
          type="button"
          className="pane__settings"
          onClick={onOpenSettings}
          aria-label="설정 · 초대 코드"
          title="설정 · 초대 코드"
        >
          {me ? (
            <AvatarPair mine={me.user.initial} partner={me.partner?.initial ?? null} />
          ) : null}
          <GearIcon />
        </button>
      </header>

      <section className="cal">
        <div className="cal__head">
          <span className="cal__month">{d.monthLabel(collapsed ? selected : month)}</span>
          <span className="cal__year">{d.yearLabel(collapsed ? selected : month)}</span>
          <span className="cal__nav">
            <button
              type="button"
              onClick={() => (collapsed ? selectDate(d.addDays(selected, -7)) : stepMonth(-1))}
              aria-label={collapsed ? '지난주' : '이전 달'}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => (collapsed ? selectDate(d.addDays(selected, 7)) : stepMonth(1))}
              aria-label={collapsed ? '다음주' : '다음 달'}
            >
              ›
            </button>
          </span>
        </div>

        <div className="cal__weekdays" aria-hidden="true">
          {WEEKDAYS.map((label, index) => (
            <span key={label} className={index === 0 ? 'is-sunday' : undefined}>
              {label}
            </span>
          ))}
        </div>

        <div className="cal__grid">
          {days.map((key) => {
            const outside = !collapsed && !d.isSameMonth(key, month);
            const classes = ['cal__day'];
            if (outside) classes.push('is-outside');
            if (key === today) classes.push('is-today');
            if (key === selected) classes.push('is-selected');
            if (week?.has(key)) classes.push('is-inweek');
            if (d.weekdayIndex(key) === 0) classes.push('is-sunday');
            if (key === over) classes.push('is-drop');

            return (
              <button
                key={key}
                type="button"
                className={classes.join(' ')}
                aria-current={key === today ? 'date' : undefined}
                aria-label={d.longLabel(key)}
                onClick={() => selectDate(key)}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setOver(key);
                }}
                onDragLeave={() => setOver((v) => (v === key ? null : v))}
                onDrop={(event) => void drop(event, key)}
              >
                <span className="cal__num">{d.dayNumber(key)}</span>
                <Bars load={load.get(key)} />
              </button>
            );
          })}
        </div>
      </section>

      {onToggleCollapse ? (
        <button
          type="button"
          className="pane__handle"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? '달력 펼치기' : '달력 접기'}
        >
          <span className="pane__grip" aria-hidden="true" />
          {collapsed ? '한 달 보기' : '접기'}
        </button>
      ) : null}

      <section className="legend" aria-label="달력 읽는 법">
        {BAR_ORDER.filter((bucket) => me?.partner || !bucket.startsWith('partner')).map(
          (bucket) => (
            <span key={bucket} className="legend__row">
              <i className="legend__bar" data-bucket={bucket} />
              {bucketName(bucket)}
            </span>
          ),
        )}
        <span className="legend__row">
          <i className="legend__bar legend__bar--grey" />
          다 끝냈거나 지나간 날
        </span>
      </section>

      <button type="button" className="pane__today" onClick={goToday}>
        오늘로 돌아가기
      </button>
    </aside>
  );
}
