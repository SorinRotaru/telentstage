import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ADMIN_API_BASE } from '../hooks/useApi';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const doLogin = async () => {
    setError('');
    setResetSuccess('');
    if (!username.trim() || !password) {
      setError('Enter username and password');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(ADMIN_API_BASE + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const j = await r.json();
      if (!j.success) {
        setError(j.error || 'Login failed');
        return;
      }
      login(j.data.token, j.data.admin);
      navigate('/', { replace: true });
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const doForgotPassword = async () => {
    setError('');
    setResetSuccess('');

    const id = resetIdentifier.trim();
    if (!id || !resetPassword || !resetPasswordConfirm) {
      setError('Enter username/email and new password');
      return;
    }
    if (resetPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (resetPassword !== resetPasswordConfirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const r = await fetch(ADMIN_API_BASE + '/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: id, new_password: resetPassword }),
      });
      const j = await r.json();
      if (!j.success) {
        setError(j.error || 'Reset failed');
        return;
      }
      setResetSuccess('Password reset successful. You can sign in now.');
      setMode('login');
      setUsername(id);
      setPassword('');
      setResetIdentifier('');
      setResetPassword('');
      setResetPasswordConfirm('');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (mode === 'login') doLogin();
    else doForgotPassword();
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <svg width="44" height="44" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="48" stroke="url(#lg)" strokeWidth="4"/>
            <path d="M50 22l7 18h18l-14.5 11 5.5 18L50 58 34 69l5.5-18L25 40h18z" fill="url(#lg)"/>
            <defs><linearGradient id="lg" x1="0" y1="0" x2="100" y2="100"><stop stopColor="#7b3fe4"/><stop offset="1" stopColor="#c84fd8"/></linearGradient></defs>
          </svg>
          <span>Talents Stage</span>
          <small>Admin Panel</small>
        </div>

        {mode === 'login' ? (
          <>
            <label className="lbl">Username or Email</label>
            <input className="linp" type="text" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={handleKey} placeholder="admin" autoFocus />

            <label className="lbl">Password</label>
            <input className="linp" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKey} placeholder="••••••" />

            <button className="lbtn" onClick={doLogin} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <button
              type="button"
              className="llink"
              onClick={() => {
                setMode('forgot');
                setError('');
                setResetSuccess('');
                setResetIdentifier(username.trim());
              }}
              disabled={loading}
            >
              Forgot password?
            </button>
          </>
        ) : (
          <>
            <label className="lbl">Username or Email</label>
            <input
              className="linp"
              type="text"
              value={resetIdentifier}
              onChange={e => setResetIdentifier(e.target.value)}
              onKeyDown={handleKey}
              placeholder="ceo_sorin or info@rotarusorin.com"
              autoFocus
            />

            <label className="lbl">New Password</label>
            <input
              className="linp"
              type="password"
              value={resetPassword}
              onChange={e => setResetPassword(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Min 8 characters"
            />

            <label className="lbl">Confirm New Password</label>
            <input
              className="linp"
              type="password"
              value={resetPasswordConfirm}
              onChange={e => setResetPasswordConfirm(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Repeat new password"
            />

            <button className="lbtn" onClick={doForgotPassword} disabled={loading}>
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>

            <button
              type="button"
              className="llink"
              onClick={() => {
                setMode('login');
                setError('');
                setResetSuccess('');
              }}
              disabled={loading}
            >
              Back to sign in
            </button>
          </>
        )}

        <div className="lsuccess">{resetSuccess}</div>
        <div className="lerr">{error}</div>
      </div>
    </div>
  );
}
