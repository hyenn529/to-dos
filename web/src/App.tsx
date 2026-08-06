import { useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen.tsx';
import { CalendarPane } from './components/CalendarPane.tsx';
import { DayView } from './components/DayView.tsx';
import { SettingsSheet, applyTheme } from './components/SettingsSheet.tsx';
import { SomedayView } from './components/SomedayView.tsx';
import { WeekView } from './components/WeekView.tsx';
import * as d from './lib/dates.ts';
import { useStore } from './lib/store.tsx';
import type { ViewMode } from './lib/types.ts';

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'day', label: '하루' },
  { id: 'week', label: '이번 주' },
  { id: 'someday', label: '언젠가' },
];

/** 달력을 접을 수 있게 두는 폭. 이보다 넓으면 왼쪽에 늘 펼쳐져 있다. */
const NARROW = '(max-width: 720px)';

export function App() {
  const { me, ready, view, setView, selected, selectDate, error, notify } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const [calCollapsed, setCalCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('haru:theme');
    if (stored === 'light' || stored === 'dark') applyTheme(stored);
  }, []);

  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  if (!ready) {
    return (
      <div className="boot" role="status">
        불러오는 중…
      </div>
    );
  }

  if (!me) return <AuthScreen />;

  const week = d.weekOf(selected);
  const heading =
    view === 'someday'
      ? '언젠가'
      : view === 'week'
        ? `${d.shortLabel(week[0]!)} – ${d.shortLabel(week[6]!)}`
        : d.longLabel(selected);

  const subheading =
    view === 'someday'
      ? '날짜를 안 정한 일'
      : selected === d.today()
        ? '오늘'
        : d.relativeLabel(selected);

  return (
    <div className="shell">
      <CalendarPane
        collapsed={narrow && calCollapsed}
        {...(narrow ? { onToggleCollapse: () => setCalCollapsed((v) => !v) } : {})}
      />

      <main className="main">
        <header className="main__head">
          <div className="main__title">
            <h1>{heading}</h1>
            <span>{subheading}</span>
          </div>

          <nav className="chips" aria-label="보기 고르기">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={view === item.id ? 'is-on' : undefined}
                aria-current={view === item.id ? 'page' : undefined}
                onClick={() => setView(item.id)}
              >
                {item.label}
              </button>
            ))}
            <button type="button" onClick={() => setSettingsOpen(true)}>
              우리
            </button>
          </nav>
        </header>

        {view !== 'someday' ? (
          <div className="main__daynav">
            <button
              type="button"
              onClick={() => selectDate(d.addDays(selected, view === 'week' ? -7 : -1))}
            >
              ‹ {view === 'week' ? '지난주' : '어제'}
            </button>
            <button type="button" onClick={() => selectDate(d.today())}>
              오늘
            </button>
            <button
              type="button"
              onClick={() => selectDate(d.addDays(selected, view === 'week' ? 7 : 1))}
            >
              {view === 'week' ? '다음주' : '내일'} ›
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="banner" role="alert">
            {error}
            <button type="button" onClick={() => notify(null)} aria-label="닫기">
              ×
            </button>
          </div>
        ) : null}

        {view === 'day' ? <DayView /> : null}
        {view === 'week' ? <WeekView /> : null}
        {view === 'someday' ? <SomedayView /> : null}
      </main>

      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
