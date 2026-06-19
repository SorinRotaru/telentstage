import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, toMediaUrl } from '../hooks/useApi';
import { toast } from '../hooks/useToast';
import { fmtTime, priorityBadgeClass, statusBadgeClass } from '../utils/format';
import Pagination from '../components/Pagination';
import { confirmDialog } from '../components/ConfirmDialog';

interface ReportRow {
  id: string;
  reporter_username: string | null;
  reviewer_username: string | null;
  entity_type: string;
  entity_id: string;
  reason: string;
  description: string | null;
  priority: string;
  status: string;
  resolution_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reported_video_url: string | null;
  reported_user_id: string | null;
  reported_user_username: string | null;
  reported_comment_body: string | null;
}

interface PaginationData {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ApiPaginationData extends PaginationData {
  items: ReportRow[];
}

export default function ReportsArchive() {
  const api = useApi();
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const pageRef = useRef(1);

  const fetchReports = useCallback(async (page: number) => {
    setLoading(true);
    setErrorMsg('');

    const q = new URLSearchParams();
    q.set('page', String(page));
    q.set('limit', '20');
    q.set('status', statusFilter || 'archive');
    if (typeFilter) q.set('entity_type', typeFilter);
    if (priorityFilter) q.set('priority', priorityFilter);

    const r = await api<ApiPaginationData>('GET', `/reports?${q.toString()}`);
    if (!r.success || !r.data) {
      setReports([]);
      setPagination({ total: 0, page: 1, limit: 20, totalPages: 0 });
      setErrorMsg(r.error || 'Failed to load');
      setLoading(false);
      return;
    }

    setReports(r.data.items || []);
    setPagination({
      total: Number(r.data.total || 0),
      page: Number(r.data.page || page),
      limit: Number(r.data.limit || 20),
      totalPages: Number(r.data.totalPages || 0),
    });
    setLoading(false);
  }, [api, priorityFilter, statusFilter, typeFilter]);

  useEffect(() => {
    pageRef.current = 1;
    void fetchReports(1);
  }, [fetchReports]);

  const handlePage = (page: number) => {
    pageRef.current = page;
    void fetchReports(page);
  };

  const reopenToQueue = (reportId: string) => {
    confirmDialog(
      'Repost To Queue',
      'Move this archived report back to Reports Queue?',
      async () => {
        const r = await api('PUT', `/reports/${encodeURIComponent(reportId)}`, {
          status: 'pending',
          resolution_note: '',
        });
        if (!r.success) {
          toast(r.error || 'Failed to repost report', 'error');
          return;
        }
        toast('Report reposted to queue');
        void fetchReports(pageRef.current);
      }
    );
  };

  const renderTypeCell = (rp: ReportRow) => {
    if (rp.entity_type === 'video') {
      const url = toMediaUrl(rp.reported_video_url || '');
      if (!url) return <span className="badge badge-blue">video</span>;
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="report-type-link">
          <span className="badge badge-blue">video</span>
        </a>
      );
    }

    if (rp.entity_type === 'user') {
      const userId = String(rp.reported_user_id || rp.entity_id || '').trim();
      if (!userId) return <span className="badge badge-blue">user</span>;
      return (
        <a
          href="#"
          className="report-type-link"
          onClick={(e) => {
            e.preventDefault();
            navigate(`/users/${encodeURIComponent(userId)}`);
          }}
        >
          <span className="badge badge-blue">user</span>
        </a>
      );
    }

    return (
      <>
        <span className="badge badge-blue">comment</span>
        {rp.reported_comment_body ? (
          <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
            {rp.reported_comment_body.slice(0, 60)}
            {rp.reported_comment_body.length > 60 ? '...' : ''}
          </div>
        ) : null}
      </>
    );
  };

  return (
    <div className="reports-page">
      <div className="page-header">
        <h1>Reports Archive</h1>
        <p>Reviewed reports (resolved or dismissed)</p>
      </div>

      <div className="toolbar">
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All archived</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select className="filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="video">Videos</option>
          <option value="comment">Comments</option>
          <option value="user">Users</option>
        </select>
        <select className="filter-select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">All priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reporter</th>
              <th>Type</th>
              <th>Reason</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Reviewed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="loading-row">
                <td colSpan={7}><div className="spinner" /></td>
              </tr>
            )}
            {!loading && !!errorMsg && (
              <tr className="empty-row">
                <td colSpan={7}>Failed to load</td>
              </tr>
            )}
            {!loading && !errorMsg && reports.length === 0 && (
              <tr className="empty-row">
                <td colSpan={7}>No archived reports found</td>
              </tr>
            )}
            {!loading && !errorMsg && reports.map((rp) => (
              <tr key={rp.id}>
                <td>{rp.reporter_username || 'Anonymous'}</td>
                <td>{renderTypeCell(rp)}</td>
                <td style={{ maxWidth: 220, wordBreak: 'break-word' }}>
                  {rp.reason}
                  {rp.description ? (
                    <>
                      <br />
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{rp.description}</span>
                    </>
                  ) : null}
                  {rp.resolution_note ? (
                    <>
                      <br />
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                        Note: {rp.resolution_note}
                      </span>
                    </>
                  ) : null}
                </td>
                <td><span className={`badge ${priorityBadgeClass(rp.priority)}`}>{rp.priority}</span></td>
                <td><span className={`badge ${statusBadgeClass(rp.status)}`}>{rp.status}</span></td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                  {fmtTime(rp.reviewed_at || rp.created_at)}
                  <div style={{ fontSize: 11 }}>{rp.reviewer_username || '-'}</div>
                </td>
                <td>
                  <div className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => reopenToQueue(rp.id)}>
                      Repost To Queue
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination data={pagination} onPage={handlePage} />
      </div>
    </div>
  );
}
