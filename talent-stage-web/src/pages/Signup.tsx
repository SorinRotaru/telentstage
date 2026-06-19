import { useState } from 'react';
import { DEFAULT_AVATAR, useAppStore } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';
import Logo from '../components/Logo';
import type { User } from '../types';

interface Props {
  onNav: (page: string) => void;
}

const AUTH_USER_ICON = '/icons/auth-user.png';
const AUTH_EMAIL_ICON = '/icons/auth-email.png';
const AUTH_LOCK_ICON = '/icons/auth-lock.png';

export default function Signup({ onNav }: Props) {
  const { setUser } = useAppStore();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const doSignup = async () => {
    if (!first || !email || !password) { toast('Please fill all fields'); return; }
    const username = (first + (last || '')).toLowerCase().replace(/\s+/g, '') + '_' + Date.now().toString().slice(-4);
    const data = await apiFetch<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username, email, password,
        full_name: first + (last ? ' ' + last : ''),
        talent_type: 'Viewer',
      }),
    });
    if (!data.success || !data.data) { toast('Error: ' + data.error); return; }
    localStorage.setItem('ts_token', data.data.token);
    setUser(data.data.user);
    toast('Welcome, ' + data.data.user.full_name + '!');
    onNav('home');
  };

  return (
    <div className="aw">
      <div className="ts-brand">
        <Logo />
      </div>
      <div className="ac" style={{ paddingBottom: 24 }}>
        <div className="cav2" style={{ overflow: 'hidden' }}>
          <img src={DEFAULT_AVATAR} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} alt="" />
        </div>
        <div className="su-in">
          <h3>Sign up</h3>
          <div className="sf">
            <span className="fi">
              <img
                className="fi-img"
                src={AUTH_USER_ICON}
                alt="First name"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const fb = (e.currentTarget.nextElementSibling as HTMLElement | null);
                  if (fb) fb.style.display = 'inline';
                }}
              />
              <span className="fi-fallback" style={{ display: 'none' }} aria-hidden>&#128100;</span>
            </span>
            <input type="text" placeholder="First name..." value={first} onChange={(e) => setFirst(e.target.value)} />
          </div>
          <div className="sf">
            <span className="fi">
              <img
                className="fi-img"
                src={AUTH_USER_ICON}
                alt="Last name"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const fb = (e.currentTarget.nextElementSibling as HTMLElement | null);
                  if (fb) fb.style.display = 'inline';
                }}
              />
              <span className="fi-fallback" style={{ display: 'none' }} aria-hidden>&#128100;</span>
            </span>
            <input type="text" placeholder="Last name..." value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
          <div className="sf">
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
          <div className="sf">
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
            <input type="password" placeholder="Password..." value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <button className="bp" onClick={doSignup}>Sign up</button>
        <p className="ml" style={{ marginTop: 12 }}>Already a member? <span onClick={() => onNav('login')}>Sign In</span></p>
      </div>
    </div>
  );
}
