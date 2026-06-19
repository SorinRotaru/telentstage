import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { apiFetch } from '../services/api';

interface CreatorVideoMetrics {
  id: string;
  title: string;
  file_url: string | null;
  created_at: string;
  views: number;
  unique_views: number;
  likes: number;
  dislikes: number;
  impressions_30d: number;
  avg_watch_seconds_30d: number;
  completion_rate_30d: number;
  skip_rate_30d: number;
  engagement_rate_30d: number;
  save_rate_30d: number;
  share_rate_30d: number;
  report_rate_30d: number;
  comments_30d: number;
  quality_score: number;
  reasons?: string[];
}

interface CreatorOverview30d {
  videos_count: number;
  total_views: number;
  total_unique_views: number;
  impressions_30d: number;
  avg_watch_seconds_30d: number;
  completion_rate_30d: number;
  skip_rate_30d: number;
  engagement_rate_30d: number;
  like_dislike_ratio: number;
  reports_30d: number;
}

interface CreatorPeriodCompare7d {
  delta: {
    impressions: number;
    completion_rate: number;
    skip_rate: number;
    avg_watch_seconds: number;
    new_followers: number;
  };
}

interface CreatorTrendPoint {
  date: string;
  impressions: number;
}

interface CreatorAnalyticsPayload {
  overview_30d: CreatorOverview30d;
  videos: CreatorVideoMetrics[];
  period_compare_7d?: CreatorPeriodCompare7d;
  trend_7d?: CreatorTrendPoint[];
  top_videos?: CreatorVideoMetrics[];
  bottom_videos?: CreatorVideoMetrics[];
  action_tips?: string[];
}

interface Props {
  onNav: (page: string) => void;
}

export default function VideoAnalytics({ onNav }: Props) {
  type PeriodMode = '30d' | 'all';
  type SortMode = 'newest' | 'oldest' | 'views' | 'likes' | 'dislikes' | 'title';

  const { user } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [analytics, setAnalytics] = useState<CreatorAnalyticsPayload | null>(null);
  const [periodMode, setPeriodMode] = useState<PeriodMode>('30d');
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const load = async () => {
      if (!user?.id) {
        setAnalytics(null);
        return;
      }
      setLoading(true);
      const res = await apiFetch<CreatorAnalyticsPayload>('/users/' + user.id + '/creator-analytics');
      setLoading(false);
      if (!res.success || !res.data) {
        setAnalytics(null);
        return;
      }
      setAnalytics(res.data);
    };
    void load();
  }, [user?.id]);

  const fmt = (n: number) => new Intl.NumberFormat().format(Number(n || 0));
  const pct = (n: number) => `${(Number(n || 0) * 100).toFixed(1)}%`;
  const sec = (n: number) => `${Number(n || 0).toFixed(2)}s`;
  const deltaText = (n?: number) => {
    const val = Number(n || 0);
    const sign = val > 0 ? '+' : '';
    return `${sign}${(val * 100).toFixed(1)}%`;
  };
  const periodLabel = periodMode === '30d' ? '30d' : 'Full-time';
  const trendMax = Math.max(1, ...((analytics?.trend_7d || []).map((r) => Number(r.impressions || 0))));

  const totals = useMemo(() => {
    const list = analytics?.videos || [];
    let likes = 0;
    let dislikes = 0;
    for (const v of list) {
      likes += Number(v.likes || 0);
      dislikes += Number(v.dislikes || 0);
    }
    return {
      likes,
      dislikes,
      likeRatio: likes / Math.max(1, dislikes),
    };
  }, [analytics?.videos]);

  const filteredVideos = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let rows = [...(analytics?.videos || [])];

    if (needle) {
      rows = rows.filter((v) => {
        const hay = `${v.title || ''} ${v.id || ''}`.toLowerCase();
        return hay.includes(needle);
      });
    }

    rows.sort((a, b) => {
      if (sortMode === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortMode === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortMode === 'views') return Number(b.views || 0) - Number(a.views || 0);
      if (sortMode === 'likes') return Number(b.likes || 0) - Number(a.likes || 0);
      if (sortMode === 'dislikes') return Number(b.dislikes || 0) - Number(a.dislikes || 0);
      return String(a.title || '').localeCompare(String(b.title || ''));
    });

    return rows;
  }, [analytics?.videos, query, sortMode]);

  useEffect(() => {
    setPage(1);
  }, [query, sortMode, pageSize]);

  const totalItems = filteredVideos.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pagedVideos = filteredVideos.slice(start, start + pageSize);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  return (
    <div className="sp">
      <div className="ph" style={{ justifyContent: 'space-between' }}>
        <div className="bbtn" onClick={() => onNav('account')}>&#8592; Back</div>
      </div>

      <div className="creator-analytics-wrap">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <div className="creator-analytics-title" style={{ marginBottom: 0 }}>My Video Analytics</div>
          <div style={{ display: 'inline-flex', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setPeriodMode('30d')}
              style={{
                border: 'none',
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'inherit',
                cursor: 'pointer',
                background: periodMode === '30d' ? '#2b2b2b' : '#141414',
                color: '#fff',
              }}
            >
              30d
            </button>
            <button
              type="button"
              onClick={() => setPeriodMode('all')}
              style={{
                border: 'none',
                borderLeft: '1px solid #2a2a2a',
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'inherit',
                cursor: 'pointer',
                background: periodMode === 'all' ? '#2b2b2b' : '#141414',
                color: '#fff',
              }}
            >
              Full-time
            </button>
          </div>
        </div>

        {loading && <div className="creator-analytics-empty">Loading analytics...</div>}

        {!loading && !analytics && (
          <div className="creator-analytics-empty">Analytics unavailable right now.</div>
        )}

        {!loading && analytics && (
          <>
            <div className="creator-kpi-grid">
              <div className="creator-kpi-card">
                <div className="creator-kpi-label">Videos</div>
                <div className="creator-kpi-value">{fmt(analytics.overview_30d.videos_count)}</div>
              </div>

              {periodMode === '30d' ? (
                <>
                  <div className="creator-kpi-card">
                    <div className="creator-kpi-label">Impressions (30d)</div>
                    <div className="creator-kpi-value">{fmt(analytics.overview_30d.impressions_30d)}</div>
                    {typeof analytics.period_compare_7d?.delta?.impressions === 'number' && (
                      <div className={`creator-kpi-delta ${analytics.period_compare_7d.delta.impressions >= 0 ? 'up' : 'down'}`}>
                        {deltaText(analytics.period_compare_7d.delta.impressions)} vs prev 7d
                      </div>
                    )}
                  </div>
                  <div className="creator-kpi-card">
                    <div className="creator-kpi-label">Avg Watch (30d)</div>
                    <div className="creator-kpi-value">{sec(analytics.overview_30d.avg_watch_seconds_30d)}</div>
                    {typeof analytics.period_compare_7d?.delta?.avg_watch_seconds === 'number' && (
                      <div className={`creator-kpi-delta ${analytics.period_compare_7d.delta.avg_watch_seconds >= 0 ? 'up' : 'down'}`}>
                        {deltaText(analytics.period_compare_7d.delta.avg_watch_seconds)} vs prev 7d
                      </div>
                    )}
                  </div>
                  <div className="creator-kpi-card">
                    <div className="creator-kpi-label">Completion / Skip</div>
                    <div className="creator-kpi-value">{pct(analytics.overview_30d.completion_rate_30d)} / {pct(analytics.overview_30d.skip_rate_30d)}</div>
                    {(typeof analytics.period_compare_7d?.delta?.completion_rate === 'number'
                      && typeof analytics.period_compare_7d?.delta?.skip_rate === 'number') && (
                      <div className="creator-kpi-delta up">
                        {deltaText(analytics.period_compare_7d.delta.completion_rate)} comp / {deltaText(analytics.period_compare_7d.delta.skip_rate)} skip
                      </div>
                    )}
                  </div>
                  <div className="creator-kpi-card">
                    <div className="creator-kpi-label">Engagement (30d)</div>
                    <div className="creator-kpi-value">{pct(analytics.overview_30d.engagement_rate_30d)}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="creator-kpi-card">
                    <div className="creator-kpi-label">Total Views</div>
                    <div className="creator-kpi-value">{fmt(analytics.overview_30d.total_views)}</div>
                  </div>
                  <div className="creator-kpi-card">
                    <div className="creator-kpi-label">Total Unique Views</div>
                    <div className="creator-kpi-value">{fmt(analytics.overview_30d.total_unique_views)}</div>
                  </div>
                  <div className="creator-kpi-card">
                    <div className="creator-kpi-label">Total Likes / Dislikes</div>
                    <div className="creator-kpi-value">{fmt(totals.likes)} / {fmt(totals.dislikes)}</div>
                  </div>
                  <div className="creator-kpi-card">
                    <div className="creator-kpi-label">Like / Dislike Ratio</div>
                    <div className="creator-kpi-value">{analytics.overview_30d.like_dislike_ratio > 0 ? analytics.overview_30d.like_dislike_ratio.toFixed(2) : totals.likeRatio.toFixed(2)}</div>
                  </div>
                </>
              )}
            </div>

            <div className="creator-trend-block">
              <div className="creator-block-title">7-Day Reach Trend</div>
              <div className="creator-trend-chart">
                {(analytics.trend_7d || []).length === 0 && (
                  <div className="creator-analytics-empty">No trend data yet.</div>
                )}
                {(analytics.trend_7d || []).map((r) => (
                  <div className="creator-trend-col" key={String(r.date)}>
                    <div
                      className="creator-trend-bar"
                      style={{ height: `${Math.max(8, Math.round((Number(r.impressions || 0) / trendMax) * 96))}px` }}
                      title={`${r.date}: ${fmt(r.impressions)} impressions`}
                    />
                    <div className="creator-trend-day">{String(r.date).slice(5)}</div>
                    <div className="creator-trend-val">{fmt(r.impressions)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="creator-table-block">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div className="creator-block-title" style={{ marginBottom: 0 }}>Per Video Performance ({periodLabel})</div>
                <div style={{ color: '#a6a6a6', fontSize: 12 }}>
                  {fmt(totalItems)} result{totalItems === 1 ? '' : 's'}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, marginBottom: 10 }}>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find video by title or ID..."
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,.06)',
                    border: '1px solid rgba(255,255,255,.15)',
                    borderRadius: 10,
                    padding: '9px 11px',
                    color: '#fff',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as SortMode)}
                    style={{
                      background: 'rgba(255,255,255,.06)',
                      border: '1px solid rgba(255,255,255,.15)',
                      borderRadius: 10,
                      padding: '9px 11px',
                      color: '#fff',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      outline: 'none',
                      minWidth: 0,
                      width: '100%',
                    }}
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="views">Most views</option>
                    <option value="likes">Most likes</option>
                    <option value="dislikes">Most dislikes</option>
                    <option value="title">Title A-Z</option>
                  </select>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    style={{
                      background: 'rgba(255,255,255,.06)',
                      border: '1px solid rgba(255,255,255,.15)',
                      borderRadius: 10,
                      padding: '9px 11px',
                      color: '#fff',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      outline: 'none',
                      minWidth: 0,
                      width: '100%',
                    }}
                  >
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                    <option value={100}>100 / page</option>
                  </select>
                </div>
              </div>

              <div className="creator-table-wrap">
                <table className="creator-table">
                  <thead>
                    {periodMode === '30d' ? (
                      <tr>
                        <th>Video</th>
                        <th>Views</th>
                        <th>Unique</th>
                        <th>Impr.</th>
                        <th>Avg Watch</th>
                        <th>Comp.</th>
                        <th>Skip</th>
                        <th>Engage</th>
                        <th>Likes</th>
                        <th>Dislikes</th>
                        <th>Comments (30d)</th>
                        <th>Open</th>
                      </tr>
                    ) : (
                      <tr>
                        <th>Video</th>
                        <th>Views</th>
                        <th>Unique</th>
                        <th>Likes</th>
                        <th>Dislikes</th>
                        <th>Like Ratio</th>
                        <th>Created</th>
                        <th>Open</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {pagedVideos.length === 0 && (
                      <tr><td colSpan={periodMode === '30d' ? 12 : 8} className="creator-cell-empty">No video matches your filter.</td></tr>
                    )}
                    {pagedVideos.map((v) => {
                      const ratio = Number(v.likes || 0) / Math.max(1, Number(v.dislikes || 0));
                      return periodMode === '30d' ? (
                        <tr key={v.id}>
                          <td title={v.title}>{v.title}</td>
                          <td>{fmt(v.views)}</td>
                          <td>{fmt(v.unique_views)}</td>
                          <td>{fmt(v.impressions_30d)}</td>
                          <td>{sec(v.avg_watch_seconds_30d)}</td>
                          <td>{pct(v.completion_rate_30d)}</td>
                          <td>{pct(v.skip_rate_30d)}</td>
                          <td>{pct(v.engagement_rate_30d)}</td>
                          <td>{fmt(v.likes)}</td>
                          <td>{fmt(v.dislikes)}</td>
                          <td>{fmt(v.comments_30d)}</td>
                          <td>
                            {v.file_url ? (
                              <a href={v.file_url} target="_blank" rel="noreferrer">Open</a>
                            ) : '—'}
                          </td>
                        </tr>
                      ) : (
                        <tr key={v.id}>
                          <td title={v.title}>{v.title}</td>
                          <td>{fmt(v.views)}</td>
                          <td>{fmt(v.unique_views)}</td>
                          <td>{fmt(v.likes)}</td>
                          <td>{fmt(v.dislikes)}</td>
                          <td>{ratio.toFixed(2)}</td>
                          <td>{new Date(v.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                          <td>
                            {v.file_url ? (
                              <a href={v.file_url} target="_blank" rel="noreferrer">Open</a>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <div style={{ color: '#a6a6a6', fontSize: 12 }}>
                  Page {safePage} / {totalPages}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    style={{
                      border: '1px solid rgba(255,255,255,.2)',
                      background: safePage <= 1 ? '#1c1c1c' : '#242424',
                      borderRadius: 8,
                      color: '#fff',
                      fontFamily: 'inherit',
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '7px 10px',
                      cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
                      opacity: safePage <= 1 ? 0.5 : 1,
                    }}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    style={{
                      border: '1px solid rgba(255,255,255,.2)',
                      background: safePage >= totalPages ? '#1c1c1c' : '#242424',
                      borderRadius: 8,
                      color: '#fff',
                      fontFamily: 'inherit',
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '7px 10px',
                      cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
                      opacity: safePage >= totalPages ? 0.5 : 1,
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>

            <div className="creator-split-grid">
              <div className="creator-list-block">
                <div className="creator-block-title">Top 5 Videos</div>
                {(analytics.top_videos || []).length === 0 && (
                  <div className="creator-analytics-empty">No top videos yet.</div>
                )}
                {(analytics.top_videos || []).map((v) => (
                  <div key={v.id} className="creator-list-row">
                    <div className="creator-list-main">
                      <div className="creator-list-title">{v.title}</div>
                      <div className="creator-list-sub">
                        Score {Number(v.quality_score || 0).toFixed(3)} • Comp {pct(v.completion_rate_30d)} • Engage {pct(v.engagement_rate_30d)}
                      </div>
                    </div>
                    {v.file_url && <a href={v.file_url} target="_blank" rel="noreferrer">Open</a>}
                  </div>
                ))}
              </div>
              <div className="creator-list-block">
                <div className="creator-block-title">Bottom 5 Videos</div>
                {(analytics.bottom_videos || []).length === 0 && (
                  <div className="creator-analytics-empty">No low-performing videos yet.</div>
                )}
                {(analytics.bottom_videos || []).map((v) => (
                  <div key={v.id} className="creator-list-row">
                    <div className="creator-list-main">
                      <div className="creator-list-title">{v.title}</div>
                      <div className="creator-list-sub">{(v.reasons || []).join(' • ') || 'Needs review'}</div>
                    </div>
                    {v.file_url && <a href={v.file_url} target="_blank" rel="noreferrer">Open</a>}
                  </div>
                ))}
              </div>
            </div>

            <div className="creator-tips-block">
              <div className="creator-block-title">Action Tips</div>
              <ul>
                {(analytics.action_tips || []).map((tip, idx) => (
                  <li key={idx}>{tip}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
