// Account nel menu: accedi o crea un account per salvare i progressi su ogni
// dispositivo; da ospite restano in questo browser.

import { useState } from 'react';
import { supabaseConfig } from '../net/room';
import { login, logout, useProgress } from '../progress/store';

export function AccountBox() {
  const account = useProgress((s) => s.account);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const online = supabaseConfig() !== null && new URLSearchParams(location.search).get('rete') !== 'locale';
  if (!online) return null;

  if (account.status === 'loading') return <div className="account muted small-text">Controllo dell’account…</div>;

  if (account.status === 'cloud') {
    return (
      <div className="account">
        <span>
          Progressi salvati sull’account <b>{account.email}</b>
        </span>
        <button className="small" onClick={() => void logout()}>
          Esci
        </button>
      </div>
    );
  }

  const submit = async (register: boolean) => {
    setBusy(true);
    setErr(null);
    const e = await login(email, password, register);
    setBusy(false);
    if (e) setErr(e);
    else setOpen(false);
  };

  return (
    <div className="account">
      {!open ? (
        <>
          <span className="muted small-text">Da ospite i progressi restano su questo dispositivo.</span>
          <button className="small" onClick={() => setOpen(true)}>
            Accedi o crea un account
          </button>
        </>
      ) : (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password (almeno 6 caratteri)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <div className="account-actions">
            <button type="submit" className="primary" disabled={busy}>
              Accedi
            </button>
            <button type="button" disabled={busy || !email || password.length < 6} onClick={() => void submit(true)}>
              Crea account
            </button>
            <button type="button" className="small" onClick={() => setOpen(false)}>
              Annulla
            </button>
          </div>
          {err && <div className="error">{err}</div>}
          <small className="muted">I progressi fatti da ospite su questo dispositivo passano al nuovo account.</small>
        </form>
      )}
    </div>
  );
}
