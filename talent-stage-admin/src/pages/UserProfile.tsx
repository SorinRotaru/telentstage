import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi, toMediaUrl } from '../hooks/useApi';
import { toast } from '../hooks/useToast';
import { fmt, fmtDate, fmtTime } from '../utils/format';
import { confirmDialog } from '../components/ConfirmDialog';
import DeleteUserTransferModal from '../components/DeleteUserTransferModal';
import { StrikeModal } from './Users';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface UserData {
  id: string | number;
  username: string;
  display_name: string | null;
  full_name: string | null;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  role: string;
  talent_type: string | null;
  status: string;
  is_shadow_banned: boolean | number;
  bio: string | null;
  video_count: number;
  follower_count: number;
  following_count: number;
  comment_count: number;
  strike_count: number;
  created_at: string;
  updated_at: string;
}

interface Strike {
  id: string | number;
  strike_type: string;
  reason: string;
  status?: string;
  is_active?: number;
  created_at: string;
  expires_at: string | null;
}

interface Video {
  id: string | number;
  title: string;
  file_url: string | null;
  thumbnail_url: string | null;
  category: string | null;
  view_count: number;
  like_count: number;
  status: string;
  created_at: string;
}

interface TopAffinityCategory {
  talent_type: string;
  score: number;
  event_count: number;
  last_event_at: string | null;
}

interface UserAnalytics {
  creator: {
    total_videos: number;
    total_views: number;
    total_unique_views: number;
    total_likes: number;
    total_dislikes: number;
    avg_views_per_video: number;
    top_videos: Array<{
      id: string;
      title: string;
      views: number;
      unique_views: number;
      likes: number;
      dislikes: number;
      file_url: string | null;
      created_at: string;
    }>;
  } | null;
  viewer: {
    likes_given: number;
    dislikes_given: number;
    saves_count: number;
    shares_count: number;
    comments_posted: number;
    follows_count: number;
    reports_submitted: number;
    impressions_30d: number;
    avg_watch_seconds_30d: number;
    top_affinity_categories: TopAffinityCategory[];
  } | null;
  moderation: {
    strikes_total: number;
    strikes_active: number;
    reports_received_total: number;
    reports_confirmed: number;
    reports_dismissed: number;
    reports_open: number;
    hidden_videos: number;
    hidden_comments: number;
  } | null;
  trends_30d: {
    uploads: Array<{ date: string; count: number }>;
    viewer_activity: Array<{ date: string; positive_actions: number; negative_actions: number; impressions: number }>;
    moderation_reports: Array<{ date: string; count: number }>;
  } | null;
  related: {
    videos: Array<{ id: string; title: string; file_url: string | null; views: number; likes: number; dislikes: number }>;
    comments: Array<{ id: string; body: string; video_id: string; report_count: number; created_at: string; video_file_url: string | null }>;
  };
}

interface ProfileData {
  user: UserData;
  videos: Video[];
  strikes: Strike[];
  analytics?: UserAnalytics;
}

/* ------------------------------------------------------------------ */
/*  Helper: strike type badge class                                   */
/* ------------------------------------------------------------------ */

function strikeTypeBadge(t: string): string {
  const map: Record<string, string> = {
    warning: 'badge-yellow',
    strike: 'badge-orange',
    temp_ban: 'badge-red',
    permanent_ban: 'badge-red',
    shadow_ban: 'badge-purple',
  };
  return map[t] || 'badge-blue';
}

function strikeTypeLabel(t: string): string {
  const map: Record<string, string> = {
    warning: 'Warning',
    strike: 'Strike',
    temp_ban: 'Temp Ban',
    permanent_ban: 'Perm Ban',
    shadow_ban: 'Shadow Ban',
  };
  return map[t] || t;
}

function pct(v: number): string {
  return `${(Number(v || 0) * 100).toFixed(2)}%`;
}

/* ------------------------------------------------------------------ */
/*  UserProfile Page                                                  */
/* ------------------------------------------------------------------ */

export default function UserProfile() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const api = useApi();

  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  // Strike modal
  const [strikeModal, setStrikeModal] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    const r = await api<ProfileData>('GET', `/users/${userId}/profile`);
    if (r.success && r.data) {
      setData(r.data);
    } else {
      toast(r.error || 'Failed to load user profile', 'error');
    }
    setLoading(false);
  }, [api, userId]);

  useEffect(() => {
    fetchProfile();
  }, [userId]);

  /* ---- Actions ---- */

  const handleBan = () => {
    if (!data) return;
    confirmDialog('Ban User', `Are you sure you want to ban @${data.user.username}?`, async () => {
      const r = await api('PUT', `/users/${userId}/ban`);
      if (r.success) { toast('User banned'); fetchProfile(); }
      else toast(r.error || 'Failed to ban user', 'error');
    });
  };

  const handleUnban = async () => {
    const r = await api('PUT', `/users/${userId}/unban`);
    if (r.success) { toast('User unbanned'); fetchProfile(); }
    else toast(r.error || 'Failed to unban user', 'error');
  };

  const handleShadowBan = async () => {
    const r = await api('PUT', `/users/${userId}/shadow-ban`);
    if (r.success) {
      toast(isShadowBanned ? 'Shadow ban removed' : 'User shadow banned');
      fetchProfile();
    } else {
      toast(r.error || 'Failed to toggle shadow ban', 'error');
    }
  };

  const handleDelete = () => {
    if (!data) return;
    setDeleteModalOpen(true);
  };

  const handleVideoVisibility = async (video: Video) => {
    const action = video.status === 'active' ? 'hide' : 'show';
    const r = await api('PUT', `/videos/${video.id}/visibility`, { status: action === 'hide' ? 'hidden' : 'active' });
    if (r.success) {
      toast(`Video ${action === 'hide' ? 'hidden' : 'shown'}`);
      fetchProfile();
    } else {
      toast(r.error || 'Failed to update video', 'error');
    }
  };

  const handleVideoDelete = (video: Video) => {
    confirmDialog('Delete Video', `Delete "${video.title || 'Untitled'}"? This cannot be undone.`, async () => {
      const r = await api('DELETE', `/videos/${video.id}`);
      if (r.success) { toast('Video deleted'); fetchProfile(); }
      else toast(r.error || 'Failed to delete video', 'error');
    });
  };

  /* ---- Loading / Error ---- */

  if (loading) {
    return (
      <div className="page">
        <div style={{ textAlign: 'center', padding: 64 }}>Loading user profile...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <div style={{ textAlign: 'center', padding: 64 }}>
          <p>User not found</p>
          <button className="btn btn-ghost" onClick={() => navigate('/users')}>Back to Users</button>
        </div>
      </div>
    );
  }

  const { user, videos, strikes } = data;
  const userRole = String(user.role || (Number(user.video_count || 0) > 0 ? 'creator' : 'viewer')).toLowerCase();
  const userStatus = String(user.status || ((user as any).is_active === 0 ? 'banned' : 'active')).toLowerCase();
  const isShadowBanned = Boolean(Number(user.is_shadow_banned || (user as any).shadow_banned || 0));
  const analytics = data.analytics || null;

  /* ---- Render ---- */

  return (
    <div className="page user-profile-page">
      {/* Header */}
      <div className="page-header user-profile-header">
        <div className="user-profile-header-left">
          <button className="btn btn-ghost" onClick={() => navigate('/users')}>
            &larr; Back to Users
          </button>
          <h1>User Profile</h1>
        </div>
        <button className="btn btn-ghost" onClick={fetchProfile}>Refresh</button>
      </div>

      {/* User Card + Actions */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {user.avatar_url ? (
            <img
              className="av-lg"
              src={toMediaUrl(user.avatar_url)}
              alt=""
              style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <div
              className="av-lg av-placeholder"
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                fontWeight: 600,
                background: 'rgba(123,63,228,0.15)',
                color: '#7b3fe4',
              }}
            >
              {(user.username || '?')[0].toUpperCase()}
            </div>
          )}
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{user.display_name || user.full_name || user.username}</div>
            <div className="text-secondary">@{user.username}</div>
            <div className="text-secondary" style={{ fontSize: 12 }}>ID: {user.id}</div>
          </div>
        </div>

        <div className="action-btns">
          {userStatus === 'banned' ? (
            <button className="btn btn-ghost" onClick={handleUnban}>Unban</button>
          ) : (
            <button className="btn btn-danger-ghost" onClick={handleBan}>Ban</button>
          )}
          <button
            className={`btn ${isShadowBanned ? 'btn-warning-ghost' : 'btn-ghost'}`}
            onClick={handleShadowBan}
          >
            {isShadowBanned ? 'Remove Shadow Ban' : 'Shadow Ban'}
          </button>
          <button className="btn btn-ghost" onClick={() => setStrikeModal(true)}>Strike</button>
          <button className="btn btn-danger-ghost" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 16 }}>
        <div className="card stat-card">
          <div className="stat-label">Videos</div>
          <div className="stat-value">{fmt(user.video_count)}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Followers</div>
          <div className="stat-value">{fmt(user.follower_count)}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Following</div>
          <div className="stat-value">{fmt(user.following_count)}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Comments</div>
          <div className="stat-value">{fmt(user.comment_count)}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Strikes</div>
          <div className="stat-value" style={user.strike_count > 0 ? { color: '#ef4444' } : undefined}>
            {fmt(user.strike_count)}
          </div>
        </div>
      </div>

      {/* Account Data */}
      <div style={{ marginTop: 24 }}>
        <h2 className="section-title">Account Data</h2>
        <div className="table-wrap">
          <table className="table table-kv">
            <tbody>
              <tr><td className="kv-key">User ID</td><td>{user.id}</td></tr>
              <tr><td className="kv-key">Username</td><td>@{user.username}</td></tr>
              <tr><td className="kv-key">Full Name</td><td>{user.full_name || '-'}</td></tr>
              <tr><td className="kv-key">Email</td><td>{user.email || '-'}</td></tr>
              <tr><td className="kv-key">Phone</td><td>{user.phone || '-'}</td></tr>
              <tr>
                <td className="kv-key">Category</td>
                <td>
                  <span className={`badge ${userRole === 'creator' ? 'badge-purple' : 'badge-blue'}`}>
                    {userRole === 'creator' ? 'Creator' : 'Viewer'}
                  </span>
                </td>
              </tr>
              <tr><td className="kv-key">Talent Type</td><td>{user.talent_type || '-'}</td></tr>
              <tr>
                <td className="kv-key">Status</td>
                <td>
                  <span className={`badge ${userStatus === 'banned' ? 'badge-red' : 'badge-green'}`}>
                    {userStatus === 'banned' ? 'Banned' : 'Active'}
                  </span>
                </td>
              </tr>
              <tr>
                <td className="kv-key">Shadow Ban</td>
                <td>
                  <span className={`badge ${isShadowBanned ? 'badge-yellow' : 'badge-green'}`}>
                    {isShadowBanned ? 'Yes' : 'No'}
                  </span>
                </td>
              </tr>
              <tr>
                <td className="kv-key">Strikes</td>
                <td style={user.strike_count > 0 ? { color: '#ef4444', fontWeight: 600 } : undefined}>
                  {user.strike_count}
                </td>
              </tr>
              <tr><td className="kv-key">Created</td><td>{fmtTime(user.created_at)}</td></tr>
              <tr><td className="kv-key">Updated</td><td>{fmtTime(user.updated_at)}</td></tr>
              <tr><td className="kv-key">Bio</td><td style={{ whiteSpace: 'pre-wrap' }}>{user.bio || '-'}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Analytics */}
      <div style={{ marginTop: 24 }}>
        <h2 className="section-title">Profile Analytics</h2>
        {!analytics && (
          <div className="card" style={{ color: 'var(--muted)', padding: 16 }}>Analytics unavailable for this user.</div>
        )}

        {analytics?.creator && (
          <>
            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <div className="card stat-card"><div className="stat-label">Creator Views</div><div className="stat-value">{fmt(analytics.creator.total_views)}</div></div>
              <div className="card stat-card"><div className="stat-label">Unique Views</div><div className="stat-value">{fmt(analytics.creator.total_unique_views)}</div></div>
              <div className="card stat-card"><div className="stat-label">Creator Likes</div><div className="stat-value">{fmt(analytics.creator.total_likes)}</div></div>
              <div className="card stat-card"><div className="stat-label">Creator Dislikes</div><div className="stat-value">{fmt(analytics.creator.total_dislikes)}</div></div>
              <div className="card stat-card"><div className="stat-label">Avg Views / Video</div><div className="stat-value">{fmt(Math.round(analytics.creator.avg_views_per_video || 0))}</div></div>
            </div>

            <div className="table-wrap" style={{ marginTop: 12 }}>
              <div className="section-title">Top Creator Videos</div>
              <table className="table">
                <thead>
                  <tr><th>Video</th><th>Views</th><th>Likes</th><th>Dislikes</th></tr>
                </thead>
                <tbody>
                  {(analytics.creator.top_videos || []).length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', opacity: 0.6, padding: 16 }}>No video analytics</td></tr>
                  )}
                  {(analytics.creator.top_videos || []).map((v) => (
                    <tr key={v.id}>
                      <td>
                        <div className="text-primary">{v.title || 'Untitled'}</div>
                        {v.file_url && (
                          <a className="profile-id-link" href={toMediaUrl(v.file_url)} target="_blank" rel="noopener noreferrer">
                            Open video
                          </a>
                        )}
                      </td>
                      <td>{fmt(v.views)}</td>
                      <td style={{ color: 'var(--green)' }}>{fmt(v.likes)}</td>
                      <td style={{ color: 'var(--red)' }}>{fmt(v.dislikes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {analytics?.viewer && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <div className="section-title">Viewer Behavior (30d)</div>
            <table className="table table-kv">
              <tbody>
                <tr><td className="kv-key">Likes Given</td><td>{fmt(analytics.viewer.likes_given)}</td></tr>
                <tr><td className="kv-key">Dislikes Given</td><td>{fmt(analytics.viewer.dislikes_given)}</td></tr>
                <tr><td className="kv-key">Saves</td><td>{fmt(analytics.viewer.saves_count)}</td></tr>
                <tr><td className="kv-key">Shares</td><td>{fmt(analytics.viewer.shares_count)}</td></tr>
                <tr><td className="kv-key">Comments Posted</td><td>{fmt(analytics.viewer.comments_posted)}</td></tr>
                <tr><td className="kv-key">Follows</td><td>{fmt(analytics.viewer.follows_count)}</td></tr>
                <tr><td className="kv-key">Reports Submitted</td><td>{fmt(analytics.viewer.reports_submitted)}</td></tr>
                <tr><td className="kv-key">Impressions</td><td>{fmt(analytics.viewer.impressions_30d)}</td></tr>
                <tr><td className="kv-key">Avg Watch Time</td><td>{Number(analytics.viewer.avg_watch_seconds_30d || 0).toFixed(2)}s</td></tr>
              </tbody>
            </table>
            {(analytics.viewer.top_affinity_categories || []).length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(analytics.viewer.top_affinity_categories || []).map((c) => (
                  <span key={c.talent_type} className="badge badge-purple">
                    {c.talent_type}: {Number(c.score || 0).toFixed(2)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {analytics?.moderation && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <div className="section-title">Moderation Risk</div>
            <table className="table table-kv">
              <tbody>
                <tr><td className="kv-key">Reports Received</td><td>{fmt(analytics.moderation.reports_received_total)}</td></tr>
                <tr><td className="kv-key">Confirmed Reports</td><td>{fmt(analytics.moderation.reports_confirmed)}</td></tr>
                <tr><td className="kv-key">Dismissed Reports</td><td>{fmt(analytics.moderation.reports_dismissed)}</td></tr>
                <tr><td className="kv-key">Open Reports</td><td>{fmt(analytics.moderation.reports_open)}</td></tr>
                <tr><td className="kv-key">Hidden Videos</td><td>{fmt(analytics.moderation.hidden_videos)}</td></tr>
                <tr><td className="kv-key">Hidden Comments</td><td>{fmt(analytics.moderation.hidden_comments)}</td></tr>
              </tbody>
            </table>
            <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
              Confirmed rate: {pct(
                analytics.moderation.reports_received_total > 0
                  ? analytics.moderation.reports_confirmed / analytics.moderation.reports_received_total
                  : 0
              )}
            </div>
          </div>
        )}

        {analytics?.related && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <div className="section-title">Related Comments (with Links)</div>
            <table className="table">
              <thead>
                <tr><th>Comment</th><th>Reports</th><th>Date</th><th>Links</th></tr>
              </thead>
              <tbody>
                {(analytics.related.comments || []).length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', opacity: 0.6, padding: 16 }}>No related comments</td></tr>
                )}
                {(analytics.related.comments || []).map((c) => (
                  <tr key={c.id}>
                    <td style={{ maxWidth: 380, whiteSpace: 'pre-wrap' }}>{c.body || '-'}</td>
                    <td>{fmt(Number(c.report_count || 0))}</td>
                    <td>{fmtTime(c.created_at)}</td>
                    <td>
                      <div className="action-btns">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => navigate(`/comments?search=${encodeURIComponent(String(c.id))}`)}
                        >
                          Open comment
                        </button>
                        {c.video_file_url && (
                          <a className="btn btn-ghost btn-sm" href={toMediaUrl(c.video_file_url)} target="_blank" rel="noopener noreferrer">
                            Open video
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {analytics?.trends_30d && (
          <div className="two-col" style={{ marginTop: 12 }}>
            <div className="table-wrap">
              <div className="section-title">Uploads Trend (30d)</div>
              <table className="table">
                <thead><tr><th>Date</th><th>Uploads</th></tr></thead>
                <tbody>
                  {(analytics.trends_30d.uploads || []).length === 0 && (
                    <tr><td colSpan={2} style={{ textAlign: 'center', opacity: 0.6, padding: 16 }}>No upload trend</td></tr>
                  )}
                  {(analytics.trends_30d.uploads || []).map((row, idx) => (
                    <tr key={`${row.date}-${idx}`}><td>{fmtTime(row.date)}</td><td>{fmt(row.count)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <div className="section-title">Moderation Trend (30d)</div>
              <table className="table">
                <thead><tr><th>Date</th><th>Reports</th></tr></thead>
                <tbody>
                  {(analytics.trends_30d.moderation_reports || []).length === 0 && (
                    <tr><td colSpan={2} style={{ textAlign: 'center', opacity: 0.6, padding: 16 }}>No moderation trend</td></tr>
                  )}
                  {(analytics.trends_30d.moderation_reports || []).map((row, idx) => (
                    <tr key={`${row.date}-${idx}`}><td>{fmtTime(row.date)}</td><td>{fmt(row.count)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Strike History */}
      <div style={{ marginTop: 24 }}>
        <h2 className="section-title">Strike History ({strikes.length})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {strikes.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>No strikes</td></tr>
              )}
              {strikes.map(s => {
                const isActive = s.status === 'active' || (!s.expires_at || new Date(s.expires_at) > new Date());
                return (
                  <tr key={s.id}>
                    <td>
                      <span className={`badge ${strikeTypeBadge(s.strike_type)}`}>
                        {strikeTypeLabel(s.strike_type)}
                      </span>
                    </td>
                    <td>{s.reason}</td>
                    <td>
                      <span className={`badge ${isActive ? 'badge-red' : 'badge-green'}`}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{fmtTime(s.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Uploaded Videos */}
      <div style={{ marginTop: 24 }}>
        <h2 className="section-title">Uploaded Videos ({videos.length})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Video</th>
                <th>Category</th>
                <th>Views</th>
                <th>Likes</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {videos.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>No videos</td></tr>
              )}
              {videos.map(v => (
                <tr key={v.id}>
                  {/* Video */}
                  <td>
                    <div className="user-cell">
                      {v.thumbnail_url ? (
                        <img
                          src={toMediaUrl(v.thumbnail_url)}
                          alt=""
                          style={{ width: 48, height: 36, borderRadius: 4, objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 48,
                            height: 36,
                            borderRadius: 4,
                            background: 'rgba(255,255,255,0.06)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 14,
                          }}
                        >
                          --
                        </div>
                      )}
                      <div>
                        <div className="text-primary">{v.title || 'Untitled'}</div>
                        {v.file_url && (
                          <a
                            href={toMediaUrl(v.file_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link"
                            style={{ fontSize: 12 }}
                          >
                            Open file
                          </a>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Category */}
                  <td>{v.category || '-'}</td>

                  {/* Views */}
                  <td>{fmt(v.view_count)}</td>

                  {/* Likes */}
                  <td>{fmt(v.like_count)}</td>

                  {/* Status */}
                  <td>
                    <span className={`badge ${v.status === 'active' ? 'badge-green' : v.status === 'hidden' ? 'badge-yellow' : 'badge-red'}`}>
                      {v.status === 'active' ? 'Active' : v.status === 'hidden' ? 'Hidden' : v.status}
                    </span>
                  </td>

                  {/* Date */}
                  <td>{fmtDate(v.created_at)}</td>

                  {/* Actions */}
                  <td>
                    <div className="action-btns">
                      <button
                        className="btn btn-xs btn-ghost"
                        onClick={() => handleVideoVisibility(v)}
                        title={v.status === 'active' ? 'Hide' : 'Show'}
                      >
                        {v.status === 'active' ? 'Hide' : 'Show'}
                      </button>
                      <button
                        className="btn btn-xs btn-danger-ghost"
                        onClick={() => handleVideoDelete(v)}
                        title="Delete"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strike Modal */}
      <StrikeModal
        open={strikeModal}
        userId={userId || null}
        userName={user.username}
        onClose={() => setStrikeModal(false)}
        onSubmitted={fetchProfile}
      />

      <DeleteUserTransferModal
        open={deleteModalOpen}
        sourceUserId={String(user.id)}
        sourceUsername={user.username}
        onClose={() => setDeleteModalOpen(false)}
        onDeleted={() => {
          toast('User deleted');
          navigate('/users');
        }}
      />
    </div>
  );
}
