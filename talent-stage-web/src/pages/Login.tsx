import { useState } from 'react';
import { DEFAULT_AVATAR, useAppStore } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';
import Logo from '../components/Logo';
import type { User } from '../types';

interface Props {
  onNav: (page: string) => void;
}

const AUTH_EMAIL_ICON = '/icons/auth-email.png';
const AUTH_LOCK_ICON = '/icons/auth-lock.png';

export default function Login({ onNav }: Props) {
  const { setUser } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const doLogin = async () => {
    if (!email || !password) { toast('Please fill all fields'); return; }
    const data = await apiFetch<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!data.success || !data.data) { toast('Error: ' + data.error); return; }
    localStorage.setItem('ts_token', data.data.token);
    setUser(data.data.user);
    toast('Welcome back, ' + data.data.user.full_name + '!');
    onNav('home');
  };

  return (
    <div className="aw">
      <div className="ts-brand">
        <Logo />
      </div>
      <div className="ac">
        <div className="cav2" style={{ overflow: 'hidden' }}>
          <img src={DEFAULT_AVATAR} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} alt="" />
        </div>
        <h2>Login</h2>
        <div className="ff">
          <span className="fi">
            <img
              className="fi-img"
              src={AUTH_EMAIL_ICON}
              alt="Email"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                const fb = (e.currentTarget.nextElementSibling as HTMLElement | null);
                if (fb) fb.style.display = 'inline';
              }}
            />
            <span className="fi-fallback" style={{ display: 'none' }} aria-hidden>&#9993;&#65039;</span>
          </span>
          <input type="email" placeholder="Email address..." value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="ff">
          <span className="fi">
            <img
              className="fi-img"
              src={AUTH_LOCK_ICON}
              alt="Password"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                const fb = (e.currentTarget.nextElementSibling as HTMLElement | null);
                if (fb) fb.style.display = 'inline';
              }}
            />
            <span className="fi-fallback" style={{ display: 'none' }} aria-hidden>&#128274;</span>
          </span>
          <input type="password" placeholder="Password..." value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }} />
        </div>
        <button className="bp" onClick={doLogin}>Sign in</button>
        <button className="bo" onClick={() => onNav('signup')}>Sign Up</button>
        <span className="fgt" onClick={() => onNav('forgot')}>Forgot your password?</span>
      </div>
    </div>
  );
}
