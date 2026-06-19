import { useState, useEffect } from 'react';
import { useAppStore, DEFAULT_AVATAR } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';
import Logo from '../components/Logo';
import type { UserWithStats, PaginatedResponse } from '../types';

interface Props {
  talentType: string;
  talentTypes?: string[];
  onNav: (page: string, data?: unknown) => void;
}

export default function Talent({ talentType, talentTypes = [], onNav }: Props) {
  const { loggedIn } = useAppStore();
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const selectedTypes = (talentTypes.length > 0 ? talentTypes : (talentType ? [talentType] : []));
  const selectedTitle = selectedTypes.length === 1 ? selectedTypes[0] : '';

  useEffect(() => {
    void loadTalents();
  }, [talentType, talentTypes.join('|')]);

  const loadTalents = async () => {
    const query = new URLSearchParams();
    query.set('creators_only', '1');
    if (selectedTypes.length === 1) {
      query.set('talent_type', selectedTypes[0]);
    } else if (selectedTypes.length > 1) {
      query.set('talent_types', selectedTypes.join(','));
    }
    const data = await apiFetch<PaginatedResponse<UserWithStats>>('/users?' + query.toString());
    if (data.success && data.data) setUsers(data.data.items || []);
  };

  const followTalent = async (userId: string) => {
    if (!loggedIn) { toast('Sign in to follow'); onNav('login'); return; }
    const data = await apiFetch<{ following: boolean }>('/users/' + userId + '/follow', { method: 'POST' });
    if (!data.success) { toast('Error: ' + data.error); return; }
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_followed: data.data?.following ? 1 : 0 } : u));
    toast(data.data?.following ? 'Following!' : 'Unfollowed');
  };

  const goToUser = (u: UserWithStats) => {
    onNav('creator', { userId: u.id, username: u.username, fullName: u.full_name || u.username, avatarUrl: null, isFollowing: !!u.is_followed });
  };

  return (
    <div className="tsc">
      <div className="ph">
        <div className="bbtn" onClick={() => onNav('home')}>&#8592; Back</div>
      </div>
      <div className="tbrand">
        <Logo />
      </div>
      <div className="tttl">
        {selectedTitle
          ? `Follow a ${selectedTitle} Talent`
          : selectedTypes.length > 1
            ? `Follow Talents (${selectedTypes.length} categories)`
            : 'Follow Talents'}
      </div>
      <div className="ul">
        {users.length === 0 ? (
          <div style={{ padding: 16, color: '#555' }}>
            {selectedTypes.length > 0 ? 'No talents in selected categories yet' : 'No talents found yet'}
          </div>
        ) : users.map((u) => (
          <div className="ur" key={u.id}>
            <div className="uav" onClick={() => goToUser(u)} style={{ cursor: 'pointer' }}>
              <img src={DEFAULT_AVATAR} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }} alt="" />
            </div>
            <div className="uname" onClick={() => goToUser(u)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>{u.full_name || u.username}</div>
            <button className="bflw" onClick={() => followTalent(u.id)}
              style={{ background: u.is_followed ? '#444' : '' }}>
              {u.is_followed ? 'Following' : 'Follow'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
