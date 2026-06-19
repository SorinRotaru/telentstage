import { useState } from 'react';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';

interface Props {
  onNav: (page: string) => void;
}

export default function ForgotPassword({ onNav }: Props) {
  const [email, setEmail] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');

  const doReset = async () => {
    if (!email || !newPwd || !confirmPwd) { toast('Please fill all fields'); return; }
    if (newPwd.length < 8) { toast('Min 8 characters'); return; }
    if (newPwd !== confirmPwd) { toast('Passwords do not match'); return; }
    const data = await apiFetch('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, new_password: newPwd }),
    });
    if (!data.success) { toast('Error: ' + data.error); return; }
    toast('Password reset! You can now log in.');
    onNav('login');
  };

  return (
    <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--blk)' }}>
      <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 400 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 8 }}>Forgot Password</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', textAlign: 'center', marginBottom: 20 }}>Enter your email and new password</div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Email address</div>
          <input type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>New password</div>
          <input type="password" placeholder="Min. 8 characters..." value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Confirm new password</div>
          <input type="password" placeholder="Repeat new password..." value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => onNav('login')}
            style={{ flex: 1, padding: 13, borderRadius: 12, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.6)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={doReset}
            style={{ flex: 2, padding: 13, borderRadius: 12, border: 'none', background: 'var(--acc)', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Reset Password</button>
        </div>
      </div>
    </div>
  );
}
