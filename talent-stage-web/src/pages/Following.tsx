import { useState, useEffect } from 'react';
import { useAppStore, DEFAULT_AVATAR } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';
import Logo from '../components/Logo';
import type { UserWithStats, PaginatedResponse } from '../types';

interface Props {
  onNav: (page: string, data?: unknown) => void;
}

export default function Following({ onNav }: Props) {
  const { user } = useAppStore();
  const [following, setFollowing] = useState<UserWithStats[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (user) loadFollowing();
  }, [user]);

  const loadFollowing = async () => {
    if (!user) return;
    const data = await apiFetch<PaginatedResponse<UserWithStats>>('/users/' + user.id + '/following');
    if (data.success && data.data) {
      setFollowing(data.data.items || []);
      setTotal(data.data.total || 0);
    }
  };

  const unfollow = async (userId: string) => {
    await apiFetch('/users/' + userId + '/follow', { method: 'POST' });
    toast('Unfollowed');
    loadFollowing();
  };

  const goToUser = (u: UserWithStats) => {
    onNav('creator', { userId: u.id, username: u.username, fullName: u.full_name || u.username, avatarUrl: null, isFollowing: true });
  };

  return (
    <div className="sp">
      <div className="ph">
        <div className="bbtn" onClick={() => onNav('home')}>&#8592; Back</div>
      </div>
      <div className="lbrand">
        <Logo />
      </div>
      <div className="lcnt">{total} - Following</div>
      <div className="ul">
        {following.length === 0 ? (
          <div style={{ padding: 16, color: '#555' }}>Not following anyone yet</div>
        ) : following.map((u) => (
          <div className="ur" key={u.id}>
            <div className="uav" onClick={() => goToUser(u)} style={{ cursor: 'pointer' }}>
              <img src={DEFAULT_AVATAR} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }} alt="" />
            </div>
            <div className="uname" onClick={() => goToUser(u)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>{u.full_name || u.username}</div>
            <button className="bufl" onClick={() => unfollow(u.id)}>Unfollow</button>
          </div>
        ))}
      </div>
    </div>
  );
}
