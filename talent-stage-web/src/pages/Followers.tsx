import { useState, useEffect } from 'react';
import { useAppStore, DEFAULT_AVATAR } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';
import Logo from '../components/Logo';
import type { UserWithStats, PaginatedResponse } from '../types';

interface Props {
  onNav: (page: string, data?: unknown) => void;
}

export default function Followers({ onNav }: Props) {
  const { user } = useAppStore();
  const [followers, setFollowers] = useState<UserWithStats[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (user) loadFollowers();
  }, [user]);

  const loadFollowers = async () => {
    if (!user) return;
    const data = await apiFetch<PaginatedResponse<UserWithStats>>('/users/' + user.id + '/followers');
    if (data.success && data.data) {
      setFollowers(data.data.items || []);
      setTotal(data.data.total || 0);
    }
  };

  const removeFollower = async (userId: string) => {
    await apiFetch('/users/' + userId + '/follow', { method: 'POST' });
    toast('Removed');
    loadFollowers();
  };

  const goToUser = (u: UserWithStats) => {
    onNav('creator', { userId: u.id, username: u.username, fullName: u.full_name || u.username, avatarUrl: null, isFollowing: !!u.is_followed });
  };

  return (
    <div className="sp">
      <div className="ph">
        <div className="bbtn" onClick={() => onNav('home')}>&#8592; Back</div>
      </div>
      <div className="lbrand">
        <Logo />
      </div>
      <div className="lcnt">{total} - Followers</div>
      <div className="ul">
        {followers.length === 0 ? (
          <div style={{ padding: 16, color: '#555' }}>No followers yet</div>
        ) : followers.map((u) => (
          <div className="ur" key={u.id}>
            <div className="uav" onClick={() => goToUser(u)} style={{ cursor: 'pointer' }}>
              <img src={DEFAULT_AVATAR} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }} alt="" />
            </div>
            <div className="uname" onClick={() => goToUser(u)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>{u.full_name || u.username}</div>
            <button className="bcnl" onClick={() => removeFollower(u.id)}>Cancel</button>
          </div>
        ))}
      </div>
    </div>
  );
}
