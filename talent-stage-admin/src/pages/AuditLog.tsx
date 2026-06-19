import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../hooks/useApi';
import { actionLabel, fmtTime } from '../utils/format';
import Pagination from '../components/Pagination';

interface AuditLogItem {
  id: string;
  admin_id: string | null;
  admin_username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_value: string | null;
  new_value: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface PaginationData {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ApiPaginationData extends PaginationData {
  items: AuditLogItem[];
}

function parseValue(v: string | null): unknown {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return v; }
}

function toStringValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

function truncate(v: string, max: number): string {
  return v.length > max ? `${v.slice(0, max)}...` : v;
}

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'login_success', label: 'Login' },
  { value: 'login_failed', label: 'Failed Login' },
  { value: 'video_deleted', label: 'Video Deleted' },
  { value: 'video_visibility_changed', label: 'Video Visibility' },
  { value: 'user_banned', label: 'User Banned' },
  { value: 'user_unbanned', label: 'User Unbanned' },
  { value: 'user_deleted', label: 'User Deleted' },
  { value: 'user_shadow_banned', label: 'Shadow Banned' },
  { value: 'comment_deleted', label: 'Comment Deleted' },
  { value: 'strike_added', label: 'Strike Added' },
  { value: 'strike_removed', label: 'Strike Removed' },
  { value: 'report_updated', label: 'Report Updated' },
  { value: 'moderator_created', label: 'Moderator Created' },
  { value: 'moderator_deleted', label: 'Moderator Deleted' },
  { value: 'feature_flag_changed', label: 'Feature Flag Changed' },
  { value: 'setting_changed', label: 'Setting Changed' },
];

const ENTITY_OPTIONS = [
  { value: '', label: 'All entities' },
  { value: 'video', label: 'Video' },
  { value: 'user', label: 'User' },
  { value: 'comment', label: 'Comment' },
  { value: 'admin', label: 'Admin' },
  { value: 'report', label: 'Report' },
  { value: 'feature_flag', label: 'Feature Flag' },
  { value: 'setting', label: 'Setting' },
];

export default function AuditLog() {
  const api = useApi();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 30, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;
  const pageRef = useRef(1);

  const fetchAuditLogs = useCallback(async (page: number, searchValue?: string) => {
    setLoading(true);
    setErrorMsg('');

    const q = new URLSearchParams();
    q.set('page', String(page));
    q.set('limit', '30');
    const s = (searchValue !== undefined ? searchValue : searchRef.current).trim();
    if (s) q.set('search', s);
    if (actionFilter) q.set('action', actionFilter);
    if (entityFilter) q.set('entity_type', entityFilter);

    const r = await api<ApiPaginationData>('GET', `/audit-logs?${q.toString()}`);
    if (!r.success || !r.data) {
      setLogs([]);
      setPagination({ total: 0, page: 1, limit: 30, totalPages: 0 });
      setErrorMsg(r.error || 'Failed to load');
      setLoading(false);
      return;
    }

    setLogs(r.data.items || []);
    setPagination({
      total: Number(r.data.total || 0),
      page: Number(r.data.page || page),
      limit: Number(r.data.limit || 30),
      totalPages: Number(r.data.totalPages || 0),
    });
    setLoading(false);
  }, [actionFilter, api, entityFilter]);

  useEffect(() => {
    pageRef.current = 1;
    void fetchAuditLogs(1);
  }, [fetchAuditLogs]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pageRef.current = 1;
      void fetchAuditLogs(1, value);
    }, 400);
  };

  const handlePage = (page: number) => {
    pageRef.current = page;
    void fetchAuditLogs(page);
  };

  return (
    <div className="audit-page">
      <div className="page-header">
        <h1>Audit Log</h1>
        <p>Immutable record of all admin actions</p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <span>&#x1F50D;</span>
          <input
            type="text"
            placeholder="Search by admin, action, entity..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <select className="filter-select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value || 'all-actions'} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select className="filter-select" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
          {ENTITY_OPTIONS.map((o) => (
            <option key={o.value || 'all-entities'} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Admin</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
              <th>IP</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="loading-row">
                <td colSpan={6}><div className="spinner" /></td>
              </tr>
            )}
            {!loading && !!errorMsg && (
              <tr className="empty-row">
                <td colSpan={6}>Failed to load</td>
              </tr>
            )}
            {!loading && !errorMsg && logs.length === 0 && (
              <tr className="empty-row">
                <td colSpan={6}>No logs found</td>
              </tr>
            )}
            {!loading && !errorMsg && logs.map((a) => {
              let details: ReactNode = '-';
              const ov = parseValue(a.old_value);
              const nv = parseValue(a.new_value);
              const ovStr = toStringValue(ov);
              const nvStr = toStringValue(nv);
              if (ovStr || nvStr) {
                details = (
                  <>
                    {ovStr ? <span style={{ color: 'var(--red)' }}>-{truncate(ovStr, 60)}</span> : null}
                    {ovStr && nvStr ? ' ' : null}
                    {nvStr ? <span style={{ color: 'var(--green)' }}>+{truncate(nvStr, 60)}</span> : null}
                  </>
                );
              }

              return (
                <tr key={a.id}>
                  <td><span className="tl-user">{a.admin_username || 'system'}</span></td>
                  <td>{actionLabel(a.action)}</td>
                  <td>
                    {a.entity_type ? (
                      <>
                        <span className="badge badge-blue">{a.entity_type}</span>
                        {a.entity_id ? (
                          <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 4 }}>
                            {String(a.entity_id).slice(0, 8)}...
                          </span>
                        ) : null}
                      </>
                    ) : '-'}
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 200, wordBreak: 'break-word' }}>{details}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{a.ip_address || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtTime(a.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination data={pagination} onPage={handlePage} />
      </div>
    </div>
  );
}
