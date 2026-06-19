import { useState, useEffect, type CSSProperties } from 'react';
import { useApi, toMediaUrl } from '../hooks/useApi';
import { fmt, fmtTime, actionLabel } from '../utils/format';

interface Stats {
  users: { total: number; banned: number };
  videos: { total: number; hidden: number };
  comments: { total: number };
  moderators: { total: number };
  reports: { total: number; pending: number; resolved: number };
  strikes: { total: number; activeStrikes: number };
}

interface RecentUser {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  talent_type: string | null;
  is_active: number;
  created_at: string;
  video_count: number;
}

interface RecentVideo {
  id: string;
  title: string;
  talent_type: string | null;
  views: number;
  unique_views: number;
  likes: number;
  dislikes: number;
  is_public: number;
  created_at: string;
  username: string;
  avatar_url: string | null;
  thumbnail_url: string | null;
}

interface ActivityItem {
  id: string;
  admin_username: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}

type CardStyle = CSSProperties & { '--c'?: string };

export default function Dashboard() {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [recentVideos, setRecentVideos] = useState<RecentVideo[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await api<any>('GET', '/dashboard');
      if (r.success && r.data) {
        setStats(r.data.stats);
        setRecentUsers(r.data.recentUsers || []);
        setRecentVideos(r.data.recentVideos || []);
        setRecentActivity(r.data.recentActivity || []);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="page-loading">Loading dashboard...</div>;
  }

  if (!stats) {
    return <div className="page-empty">Failed to load dashboard data.</div>;
  }

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Platform overview and recent activity</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card" style={{ '--c': 'var(--acc)' } as CardStyle}>
          <div className="sc-val">{fmt(stats.users.total)}</div>
          <div className="sc-lbl">Total Users</div>
          <div className="sc-sub"><b>{fmt(stats.users.banned)}</b> banned</div>
        </div>
        <div className="stat-card" style={{ '--c': 'var(--acc2)' } as CardStyle}>
          <div className="sc-val">{fmt(stats.videos.total)}</div>
          <div className="sc-lbl">Total Videos</div>
          <div className="sc-sub"><b>{fmt(stats.videos.hidden)}</b> hidden</div>
        </div>
        <div className="stat-card" style={{ '--c': 'var(--blue)' } as CardStyle}>
          <div className="sc-val">{fmt(stats.comments.total)}</div>
          <div className="sc-lbl">Comments</div>
        </div>
        <div className="stat-card" style={{ '--c': 'var(--green)' } as CardStyle}>
          <div className="sc-val">{fmt(stats.moderators.total)}</div>
          <div className="sc-lbl">Moderators</div>
        </div>
        <div className="stat-card" style={{ '--c': 'var(--orange)' } as CardStyle}>
          <div className="sc-val">{fmt(stats.reports?.total || 0)}</div>
          <div className="sc-lbl">Reports</div>
          <div className="sc-sub"><b>{fmt(stats.reports?.pending || 0)}</b> pending</div>
        </div>
        <div className="stat-card" style={{ '--c': 'var(--red)' } as CardStyle}>
          <div className="sc-val">{fmt(stats.strikes?.activeStrikes || 0)}</div>
          <div className="sc-lbl">Active Strikes</div>
        </div>
      </div>

      <div className="two-col">
        <div className="table-wrap">
          <div className="section-title">🆕 Recent Users</div>
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="empty-row">No recent users</td>
                </tr>
              ) : recentUsers.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="av-cell">
                      <div className="av-ph">{(u.full_name || u.username || '?').charAt(0).toUpperCase()}</div>
                      <div>
                        <div className="name">{u.username}</div>
                        <div className="sub">{u.full_name || ''}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${Number(u.video_count) > 0 ? 'badge-green' : 'badge-blue'}`}>
                      {Number(u.video_count) > 0 ? 'Creator' : 'Viewer'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${u.is_active ? 'badge-green' : 'badge-red'}`}>
                      {u.is_active ? 'Active' : 'Banned'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="table-wrap">
          <div className="section-title">🎬 Recent Videos</div>
          <table>
            <thead>
              <tr>
                <th>Video</th>
                <th>Views</th>
                <th>Likes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentVideos.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-row">No recent videos</td>
                </tr>
              ) : recentVideos.map((v) => (
                <tr key={v.id}>
                  <td>
                    <div className="thumb-cell">
                      {v.thumbnail_url ? (
                        <img
                          src={toMediaUrl(v.thumbnail_url)}
                          alt=""
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : null}
                      <div>
                        <div className="name">{v.title || 'Untitled'}</div>
                        <div className="sub">@{v.username}</div>
                      </div>
                    </div>
                  </td>
                  <td>{fmt(v.views)}</td>
                  <td style={{ color: 'var(--green)' }}>{fmt(v.likes)}</td>
                  <td>
                    <span className={`badge ${v.is_public ? 'badge-green' : 'badge-yellow'}`}>
                      {v.is_public ? 'Public' : 'Hidden'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-wrap">
        <div className="section-title">📝 Recent Activity</div>
        <ul className="timeline">
          {recentActivity.length > 0 ? recentActivity.map((a) => (
            <li key={a.id}>
              <span className="tl-time">{fmtTime(a.created_at)}</span>
              <span className="tl-action">
                <span className="tl-user">{a.admin_username || 'system'}</span>{' '}
                {actionLabel(a.action)}
                {a.entity_type ? ` on ${a.entity_type}` : ''}
              </span>
            </li>
          )) : (
            <li style={{ color: 'var(--muted)' }}>No recent activity</li>
          )}
        </ul>
      </div>
    </div>
  );
}
