import { useEffect, useState, type CSSProperties } from 'react';
import { useApi, toMediaUrl } from '../hooks/useApi';
import { toast } from '../hooks/useToast';
import { fmt } from '../utils/format';

interface TopVideo {
  id: string;
  title: string;
  username: string;
  views: number;
  likes: number;
  dislikes: number;
  file_url: string | null;
}

interface DistributionItem {
  talent_type: string;
  count: number;
}

interface AnalyticsData {
  usersPerDay: { date: string; count: number }[];
  videosPerDay: { date: string; count: number }[];
  commentsPerDay: { date: string; count: number }[];
  topTalents: DistributionItem[];
  videoTalentDistribution: DistributionItem[];
  topViewed: TopVideo[];
  topLiked: TopVideo[];
}

const barBg: CSSProperties = {
  background: '#242424',
  borderRadius: 4,
  height: 8,
  width: '100%',
  maxWidth: 200,
  overflow: 'hidden',
};

export default function Analytics() {
  const api = useApi();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const r = await api<AnalyticsData>('GET', '/analytics');
      if (!r.success || !r.data) {
        toast(r.error || 'Failed to load analytics', 'error');
        setLoading(false);
        return;
      }
      setData(r.data);
      setLoading(false);
    })();
  }, [api]);

  const totalNewUsers = (data?.usersPerDay || []).reduce((s, x) => s + Number(x.count || 0), 0);
  const totalNewVideos = (data?.videosPerDay || []).reduce((s, x) => s + Number(x.count || 0), 0);
  const totalNewComments = (data?.commentsPerDay || []).reduce((s, x) => s + Number(x.count || 0), 0);

  const totalTalents = (data?.topTalents || []).reduce((s, x) => s + Number(x.count || 0), 0);
  const totalVideoTalents = (data?.videoTalentDistribution || []).reduce((s, x) => s + Number(x.count || 0), 0);

  return (
    <div className="analytics-page">
      <div className="page-header">
        <h1>Analytics</h1>
        <p>Platform growth and content performance (last 30 days)</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card" style={{ '--c': 'var(--acc)' } as CSSProperties}>
          <div className="sc-val">{fmt(totalNewUsers)}</div>
          <div className="sc-lbl">New Users (30d)</div>
        </div>
        <div className="stat-card" style={{ '--c': 'var(--acc2)' } as CSSProperties}>
          <div className="sc-val">{fmt(totalNewVideos)}</div>
          <div className="sc-lbl">New Videos (30d)</div>
        </div>
        <div className="stat-card" style={{ '--c': 'var(--blue)' } as CSSProperties}>
          <div className="sc-val">{fmt(totalNewComments)}</div>
          <div className="sc-lbl">New Comments (30d)</div>
        </div>
      </div>

      <div className="two-col">
        <div className="table-wrap">
          <div className="section-title">&#x1F3C6; Top Viewed Videos</div>
          <table>
            <thead>
              <tr><th>Video</th><th>Views</th><th>Likes</th></tr>
            </thead>
            <tbody>
              {loading && (
                <tr className="loading-row"><td colSpan={3}><div className="spinner" /></td></tr>
              )}
              {!loading && (data?.topViewed || []).length === 0 && (
                <tr className="empty-row"><td colSpan={3}>No data</td></tr>
              )}
              {!loading && (data?.topViewed || []).map((v) => (
                <tr key={v.id}>
                  <td>
                    <div className="name">{v.title}</div>
                    <div className="sub" style={{ color: 'var(--muted)', fontSize: 12 }}>
                      @{v.username}
                      {v.file_url ? (
                        <>
                          {' '}·{' '}
                          <a className="profile-id-link" href={toMediaUrl(v.file_url)} target="_blank" rel="noopener">
                            Open video
                          </a>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td>{fmt(v.views)}</td>
                  <td style={{ color: 'var(--green)' }}>{fmt(v.likes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="table-wrap">
          <div className="section-title">&#x2764; Top Liked Videos</div>
          <table>
            <thead>
              <tr><th>Video</th><th>Likes</th><th>Dislikes</th></tr>
            </thead>
            <tbody>
              {loading && (
                <tr className="loading-row"><td colSpan={3}><div className="spinner" /></td></tr>
              )}
              {!loading && (data?.topLiked || []).length === 0 && (
                <tr className="empty-row"><td colSpan={3}>No data</td></tr>
              )}
              {!loading && (data?.topLiked || []).map((v) => (
                <tr key={v.id}>
                  <td>
                    <div className="name">{v.title}</div>
                    <div className="sub" style={{ color: 'var(--muted)', fontSize: 12 }}>
                      @{v.username}
                      {v.file_url ? (
                        <>
                          {' '}·{' '}
                          <a className="profile-id-link" href={toMediaUrl(v.file_url)} target="_blank" rel="noopener">
                            Open video
                          </a>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ color: 'var(--green)' }}>{fmt(v.likes)}</td>
                  <td style={{ color: 'var(--red)' }}>{fmt(v.dislikes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-wrap">
        <div className="section-title">&#x1F465; Creator / Viewer Distribution</div>
        <table>
          <thead>
            <tr><th>Category</th><th>Users</th><th>Distribution</th></tr>
          </thead>
          <tbody>
            {!loading && (data?.topTalents || []).length === 0 && (
              <tr className="empty-row"><td colSpan={3}>No data</td></tr>
            )}
            {!loading && (data?.topTalents || []).map((t) => {
              const count = Number(t.count || 0);
              const role = String(t.talent_type || '');
              const badgeClass = role.toLowerCase() === 'creator'
                ? 'badge-green'
                : role.toLowerCase() === 'viewer'
                  ? 'badge-blue'
                  : 'badge-purple';
              const pct = totalTalents > 0 ? (count / totalTalents) * 100 : 0;
              return (
                <tr key={role}>
                  <td><span className={`badge ${badgeClass}`}>{role}</span></td>
                  <td>{fmt(count)}</td>
                  <td>
                    <div style={barBg}>
                      <div
                        style={{
                          background: 'linear-gradient(135deg,var(--acc),var(--acc2))',
                          height: '100%',
                          width: `${pct.toFixed(1)}%`,
                        }}
                      />
                    </div>
                    <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 8 }}>{pct.toFixed(1)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <div className="section-title">&#x1F3AD; Uploaded Videos by Talent Type</div>
        <table>
          <thead>
            <tr><th>Talent Type</th><th>Videos</th><th>Distribution</th></tr>
          </thead>
          <tbody>
            {!loading && (data?.videoTalentDistribution || []).length === 0 && (
              <tr className="empty-row"><td colSpan={3}>No data</td></tr>
            )}
            {!loading && (data?.videoTalentDistribution || []).map((t) => {
              const count = Number(t.count || 0);
              const type = String(t.talent_type || 'Uncategorized');
              const pct = totalVideoTalents > 0 ? (count / totalVideoTalents) * 100 : 0;
              return (
                <tr key={type}>
                  <td><span className="badge badge-purple">{type}</span></td>
                  <td>{fmt(count)}</td>
                  <td>
                    <div style={barBg}>
                      <div
                        style={{
                          background: 'linear-gradient(135deg,var(--blue),var(--acc2))',
                          height: '100%',
                          width: `${pct.toFixed(1)}%`,
                        }}
                      />
                    </div>
                    <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 8 }}>{pct.toFixed(1)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
