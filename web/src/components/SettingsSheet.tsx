import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.tsx';

type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  const stored = localStorage.getItem('haru:theme');
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  localStorage.setItem('haru:theme', theme);
}

/** "우리" 화면 — 연결 상태, 초대 코드, 화면 밝기, 로그아웃. */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { me, signOut, refresh, notify } = useStore();
  const [code, setCode] = useState(me?.space.inviteCode ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!me) return null;

  const regenerate = async () => {
    setBusy(true);
    try {
      const res = await api.regenerateInvite();
      setCode(res.inviteCode);
    } catch (err) {
      notify(err instanceof Error ? err.message : '코드를 바꾸지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const join = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.joinSpace(joinCode.trim().toUpperCase());
      window.location.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : '합류하지 못했습니다.');
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      notify('복사하지 못했어요. 코드를 직접 옮겨 적어 주세요.');
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="우리">
      <div className="sheet">
        <header className="sheet__head">
          <h2>우리</h2>
          <button type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>

        <section className="sheet__block">
          <h3>함께 쓰는 사람</h3>
          <p className="sheet__people">
            <span data-bucket="mine">{me.user.name}</span>
            {me.partner ? (
              <>
                <span aria-hidden="true"> · </span>
                <span data-bucket="partner">{me.partner.name}</span>
              </>
            ) : (
              <span className="sheet__muted"> · 아직 혼자예요</span>
            )}
          </p>
        </section>

        {me.partner ? null : (
          <>
            <section className="sheet__block">
              <h3>초대하기</h3>
              <p className="sheet__muted">
                이 코드를 상대에게 알려주세요. 가입할 때 넣으면 같은 공간을 쓰게 됩니다.
              </p>
              <div className="sheet__code">
                <code>{code}</code>
                <button type="button" onClick={copy}>
                  {copied ? '복사됨' : '복사'}
                </button>
                <button type="button" onClick={regenerate} disabled={busy}>
                  새 코드
                </button>
              </div>
            </section>

            <section className="sheet__block">
              <h3>이미 코드를 받았다면</h3>
              <form className="sheet__join" onSubmit={join}>
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="ABCD-EFGH"
                  aria-label="초대 코드"
                />
                <button type="submit" disabled={busy || joinCode.trim().length === 0}>
                  합류
                </button>
              </form>
              <p className="sheet__muted">지금까지 적은 내 할 일은 그대로 따라옵니다.</p>
            </section>
          </>
        )}

        <section className="sheet__block">
          <h3>화면</h3>
          <div className="sheet__themes">
            {(['system', 'light', 'dark'] as Theme[]).map((option) => (
              <button
                key={option}
                type="button"
                className={theme === option ? 'is-on' : undefined}
                onClick={() => {
                  setTheme(option);
                  applyTheme(option);
                }}
              >
                {option === 'system' ? '기기 설정' : option === 'light' ? '밝게' : '어둡게'}
              </button>
            ))}
          </div>
        </section>

        <section className="sheet__block">
          <h3>규칙</h3>
          <ul className="sheet__rules">
            <li>체크는 자기 것만. 상대 할 일은 점으로만 보입니다.</li>
            <li>「같이」 붙은 일은 두 사람 칸에 모두 뜨고, 누가 체크해도 양쪽에서 끝납니다.</li>
            <li>상대 칸은 보기만 합니다 — 개인도 업무도, 체크하거나 고칠 수 없어요.</li>
            <li>재촉 알림은 없습니다.</li>
          </ul>
        </section>

        <button
          type="button"
          className="sheet__signout"
          onClick={async () => {
            await signOut();
            await refresh();
          }}
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
