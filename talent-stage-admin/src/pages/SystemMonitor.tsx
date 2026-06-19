import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { toast } from '../hooks/useToast';
import { fmt, fmtTime } from '../utils/format';

interface SystemInfoData {
  server: {
    nodeVersion: string;
    platform: string;
    uptime: number;
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
    };
  };
  database: {
    sizeMb: number;
    users: number;
    videos: number;
    comments: number;
  };
  storage: {
    uploadSizeMb: string | number;
  };
  recentLogins: Array<{
    username: string;
    ip_address: string | null;
    success?: number | boolean;
    created_at: string;
  }>;
  recommendationMetrics?: {
    last24h: {
      impressions: number;
      interactions: number;
      ctr: number;
      avgWatchSeconds: number;
      completionRate: number;
      skipRate: number;
      reportRate: number;
    };
    trend7d: Array<{
      date: string;
      impressions: number;
      interactions: number;
      ctr: number;
      avg_watch_seconds: number;
      completion_rate: number;
      skip_rate: number;
      report_rate: number;
    }>;
  };
}

function formatUptime(seconds: number): string {
  const h = Math.floor(Number(seconds || 0) / 3600);
  const m = Math.floor((Number(seconds || 0) % 3600) / 60);
  return `${h}h ${m}m`;
}

function pct(v: number): string {
  return `${(Number(v || 0) * 100).toFixed(2)}%`;
}

export default function SystemMonitor() {
  const api = useApi();
  const [data, setData] = useState<SystemInfoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg('');
      const r = await api<SystemInfoData>('GET', '/system/info');
      if (!r.success || !r.data) {
        setData(null);
        setErrorMsg('Failed to load');
        toast(r.error || 'Failed to load system info', 'error');
        setLoading(false);
        return;
      }
      setData(r.data);
      setLoading(false);
    })();
  }, [api]);

  const uptime = formatUptime(Number(data?.server?.uptime || 0));
  const memUsedMb = (Number(data?.server?.memoryUsage?.heapUsed || 0) / 1024 / 1024).toFixed(1);
  const memTotalMb = (Number(data?.server?.memoryUsage?.heapTotal || 0) / 1024 / 1024).toFixed(1);

  return (
    <div className="system-page">
      <div className="page-header">
        <h1>System Monitor</h1>
        <p>Server health, database and storage info</p>
      </div>

      <div className="info-grid">
        {loading && <div className="page-loading">Loading...</div>}
        {!loading && !!errorMsg && <p style={{ color: 'var(--red)' }}>Failed to load</p>}
        {!loading && !errorMsg && data && (
          <>
            <div className="info-item"><div className="ii-lbl">Node Version</div><div className="ii-val">{data.server.nodeVersion}</div></div>
            <div className="info-item"><div className="ii-lbl">Platform</div><div className="ii-val">{data.server.platform}</div></div>
            <div className="info-item"><div className="ii-lbl">Uptime</div><div className="ii-val">{uptime}</div></div>
            <div className="info-item"><div className="ii-lbl">Memory (Heap)</div><div className="ii-val">{memUsedMb} / {memTotalMb} MB</div></div>
            <div className="info-item"><div className="ii-lbl">Database Size</div><div className="ii-val">{data.database.sizeMb} MB</div></div>
            <div className="info-item"><div className="ii-lbl">Upload Storage</div><div className="ii-val">{data.storage.uploadSizeMb} MB</div></div>
            <div className="info-item"><div className="ii-lbl">Total Users</div><div className="ii-val">{fmt(data.database.users)}</div></div>
            <div className="info-item"><div className="ii-lbl">Total Videos</div><div className="ii-val">{fmt(data.database.videos)}</div></div>
            <div className="info-item"><div className="ii-lbl">Total Comments</div><div className="ii-val">{fmt(data.database.comments)}</div></div>
          </>
        )}
      </div>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <div className="section-title">&#x1F4CA; Recommendation Health (last 24h)</div>
        {!loading && !errorMsg && data?.recommendationMetrics && (
          <div className="stats-grid" style={{ marginTop: 12 }}>
            <div className="stat-card"><div className="sc-val">{fmt(data.recommendationMetrics.last24h.impressions || 0)}</div><div className="sc-lbl">Impressions</div></div>
            <div className="stat-card"><div className="sc-val">{pct(data.recommendationMetrics.last24h.ctr || 0)}</div><div className="sc-lbl">CTR</div></div>
            <div className="stat-card"><div className="sc-val">{Number(data.recommendationMetrics.last24h.avgWatchSeconds || 0).toFixed(2)}s</div><div className="sc-lbl">Avg Watch Time</div></div>
            <div className="stat-card"><div className="sc-val">{pct(data.recommendationMetrics.last24h.completionRate || 0)}</div><div className="sc-lbl">Completion Rate</div></div>
            <div className="stat-card"><div className="sc-val">{pct(data.recommendationMetrics.last24h.skipRate || 0)}</div><div className="sc-lbl">Skip Rate</div></div>
            <div className="stat-card"><div className="sc-val">{pct(data.recommendationMetrics.last24h.reportRate || 0)}</div><div className="sc-lbl">Report Rate</div></div>
          </div>
        )}
        {!loading && !errorMsg && (!data?.recommendationMetrics || !data.recommendationMetrics.trend7d?.length) && (
          <div style={{ color: 'var(--muted)', paddingTop: 8 }}>No recommendation metrics yet.</div>
        )}
      </div>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <div className="section-title">&#x1F4C8; Recommendation Trend (7d)</div>
        <table>
          <thead>
            <tr><th>Date</th><th>Impressions</th><th>CTR</th><th>Watch</th><th>Completion</th><th>Skip</th><th>Report</th></tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="loading-row"><td colSpan={7}><div className="spinner" /></td></tr>
            )}
            {!loading && (!data?.recommendationMetrics?.trend7d || data.recommendationMetrics.trend7d.length === 0) && (
              <tr className="empty-row"><td colSpan={7}>No trend data</td></tr>
            )}
            {!loading && (data?.recommendationMetrics?.trend7d || []).map((r, idx) => (
              <tr key={`${r.date}-${idx}`}>
                <td>{fmtTime(r.date)}</td>
                <td>{fmt(Number(r.impressions || 0))}</td>
                <td>{pct(Number(r.ctr || 0))}</td>
                <td>{Number(r.avg_watch_seconds || 0).toFixed(2)}s</td>
                <td>{pct(Number(r.completion_rate || 0))}</td>
                <td>{pct(Number(r.skip_rate || 0))}</td>
                <td>{pct(Number(r.report_rate || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <div className="section-title">&#x1F512; Recent Admin Logins</div>
        <table>
          <thead>
            <tr><th>Username</th><th>IP Address</th><th>Status</th><th>Time</th></tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="loading-row"><td colSpan={4}><div className="spinner" /></td></tr>
            )}
            {!loading && (!data?.recentLogins || data.recentLogins.length === 0) && (
              <tr className="empty-row"><td colSpan={4}>No login attempts recorded</td></tr>
            )}
            {!loading && (data?.recentLogins || []).map((l, idx) => {
              const success = typeof l.success === 'boolean' ? l.success : Number(l.success || 0) === 1;
              return (
                <tr key={`${l.username}-${l.created_at}-${idx}`}>
                  <td>{l.username}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{l.ip_address || '-'}</td>
                  <td><span className={`badge ${success ? 'badge-green' : 'badge-red'}`}>{success ? 'Success' : 'Failed'}</span></td>
                  <td style={{ color: 'var(--muted)' }}>{fmtTime(l.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
