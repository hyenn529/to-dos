import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.tsx';

type Mode = 'login' | 'signup';

export function AuthScreen() {
  const { signIn } = useStore();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me =
        mode === 'login'
          ? await api.login(email, password)
          : await api.signup({
              email,
              name,
              password,
              ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
            });
      signIn(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : '잘 되지 않았습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth__card">
        <header className="auth__head">
          <span className="pane__mark" aria-hidden="true" />
          <h1>하루</h1>
          <p>둘이 같이 보는 달력, 각자 챙기는 할 일.</p>
        </header>

        <div className="auth__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'is-on' : undefined}
            onClick={() => setMode('login')}
          >
            로그인
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={mode === 'signup' ? 'is-on' : undefined}
            onClick={() => setMode('signup')}
          >
            처음이에요
          </button>
        </div>

        <form className="auth__form" onSubmit={submit}>
          {mode === 'signup' ? (
            <label>
              이름
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="혜인"
                autoComplete="name"
                required
              />
            </label>
          ) : null}

          <label>
            이메일
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label>
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </label>

          {mode === 'signup' ? (
            <label>
              초대 코드 <span className="auth__optional">있으면</span>
              <input
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                placeholder="ABCD-EFGH"
                autoCapitalize="characters"
              />
              <small>
                상대에게 받은 코드를 넣으면 같은 공간을 쓰게 됩니다. 없으면 비워 두세요 — 나중에
                초대하면 됩니다.
              </small>
            </label>
          ) : null}

          {error ? <p className="auth__error">{error}</p> : null}

          <button type="submit" className="auth__submit" disabled={busy}>
            {busy ? '잠시만요…' : mode === 'login' ? '들어가기' : '시작하기'}
          </button>
        </form>
      </div>
    </main>
  );
}
