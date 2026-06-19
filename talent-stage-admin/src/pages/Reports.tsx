import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, toMediaUrl } from '../hooks/useApi';
import { toast } from '../hooks/useToast';
import { fmt, fmtTime, priorityBadgeClass, statusBadgeClass } from '../utils/format';
import Pagination from '../components/Pagination';
import { confirmDialog } from '../components/ConfirmDialog';

interface ReportRow {
  id: string;
  reporter_id: string | null;
  reporter_username: string | null;
  reviewed_by: string | null;
  reviewer_username: string | null;
  entity_type: string;
  entity_id: string;
  reason: string;
  description: string | null;
  priority: string;
  status: string;
  resolution_note: string | null;
  created_at: string;
  reported_video_id: string | null;
  reported_video_title: string | null;
  reported_video_url: string | null;
  reported_user_id: string | null;
  reported_user_username: string | null;
  reported_comment_id: string | null;
  reported_comment_body: string | null;
  reported_comment_video_id: string | null;
  reported_comment_username: string | null;
  reported_comment_reply_count: number;
}

interface ConversationItem {
  id: string;
  parent_comment_id: string | null;
  body: string;
  likes_count: number;
  created_at: string;
  username: string;
  avatar_url: string | null;
  depth: number;
  is_reported: number;
}

interface ConversationData {
  root_comment_id: string;
  reported_comment_id: string;
  reply_count: number;
  items: ConversationItem[];
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

export default function Reports() {
  const api = useApi();
  const navigate = useNavigate();

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');

  const [prioritySelections, setPrioritySelections] = useState<Record<string, string>>({});
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [threadCache, setThreadCache] = useState<Record<string, ConversationData>>({});
  const [threadLoading, setThreadLoading] = useState<Set<string>>(new Set());
  const [threadError, setThreadError] = useState<Record<string, string>>({});

  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveReport, setResolveReport] = useState<ReportRow | null>(null);
  const [resolveStatus, setResolveStatus] = useState('resolved');
  const [resolveNote, setResolveNote] = useState('');
  const [resolveError, setResolveError] = useState('');
  const [resolveSaving, setResolveSaving] = useState(false);
  const [resolveVideoId, setResolveVideoId] = useState('');
  const [resolveCommentId, setResolveCommentId] = useState('');
  const [showResolveDeleteVideo, setShowResolveDeleteVideo] = useState(false);
  const [showResolveHideVideo, setShowResolveHideVideo] = useState(false);
  const [showResolveHideComment, setShowResolveHideComment] = useState(false);

  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoModalUrl, setVideoModalUrl] = useState('');
  const [videoModalTitle, setVideoModalTitle] = useState('Reported Video');
  const [videoModalMeta, setVideoModalMeta] = useState('');

  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [commentModalBody, setCommentModalBody] = useState('');
  const [commentModalMeta, setCommentModalMeta] = useState('');
  const [commentModalId, setCommentModalId] = useState('');

  const pageRef = useRef(1);

  const fetchReports = useCallback(async (page: number) => {
    setLoading(true);
    setErrorMsg('');
    setThreadCache({});
    setExpandedThreads(new Set());
    setThreadLoading(new Set());
    setThreadError({});

    const q = new URLSearchParams();
    q.set('page', String(page));
    q.set('limit', '20');
    q.set('status', statusFilter || 'queue');
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

  const updatePriority = async (reportId: string) => {
    const nextPriority = prioritySelections[reportId];
    if (!nextPriority) return;
    const r = await api('PUT', `/reports/${encodeURIComponent(reportId)}`, { priority: nextPriority });
    if (!r.success) {
      toast(r.error || 'Failed to update priority', 'error');
      return;
    }
    toast(`Priority updated to ${nextPriority}`);
    void fetchReports(pageRef.current);
  };

  const markReviewing = async (reportId: string) => {
    const r = await api('PUT', `/reports/${encodeURIComponent(reportId)}`, { status: 'reviewing' });
    if (!r.success) {
      toast(r.error || 'Failed to update report', 'error');
      return;
    }
    toast('Marked as reviewing');
    void fetchReports(pageRef.current);
  };

  const openResolveModal = (report: ReportRow) => {
    const canModerateVideo = (report.status === 'pending' || report.status === 'reviewing') && report.entity_type === 'video' && !!report.entity_id;
    const canModerateComment = (report.status === 'pending' || report.status === 'reviewing') && report.entity_type === 'comment' && !!(report.reported_comment_id || report.entity_id);
    setResolveReport(report);
    setResolveStatus('resolved');
    setResolveNote('');
    setResolveError('');
    setResolveVideoId(canModerateVideo ? String(report.entity_id) : '');
    setResolveCommentId(canModerateComment ? String(report.reported_comment_id || report.entity_id) : '');
    setShowResolveDeleteVideo(canModerateVideo);
    setShowResolveHideVideo(canModerateVideo);
    setShowResolveHideComment(canModerateComment);
    setResolveOpen(true);
  };

  const closeResolveModal = () => {
    setResolveOpen(false);
    setResolveReport(null);
    setResolveStatus('resolved');
    setResolveNote('');
    setResolveError('');
    setResolveVideoId('');
    setResolveCommentId('');
    setShowResolveDeleteVideo(false);
    setShowResolveHideVideo(false);
    setShowResolveHideComment(false);
    setResolveSaving(false);
  };

  const hideVideoForReviewFromResolveModal = () => {
    if (!resolveVideoId || !resolveReport) {
      toast('No video linked to this report', 'error');
      return;
    }
    confirmDialog(
      'Toggle 90 Days Hold',
      'If public, it will be hidden for up to 90 days. If already on hold, it will be restored to platform.',
      async () => {
        const r = await api<{ action?: 'hidden' | 'restored' }>('PUT', `/videos/${encodeURIComponent(resolveVideoId)}/hide-for-review`, {
          report_id: resolveReport.id,
        });
        if (!r.success) {
          toast(r.error || 'Failed to toggle video hold', 'error');
          return;
        }
        const action = r.data?.action;
        if (action === 'restored') {
          toast('Video restored to platform');
        } else {
          toast('Video hidden for 90 days');
        }
        void fetchReports(pageRef.current);
      }
    );
  };

  const hideCommentForReviewFromResolveModal = () => {
    if (!resolveCommentId || !resolveReport) {
      toast('No comment linked to this report', 'error');
      return;
    }
    confirmDialog(
      'Toggle 90 Days Hold',
      'If visible, it will be hidden for up to 90 days. If already on hold, it will be restored to platform.',
      async () => {
        const r = await api<{ action?: 'hidden' | 'restored' }>(
          'PUT',
          `/comments/${encodeURIComponent(resolveCommentId)}/hide-for-review`,
          { report_id: resolveReport.id }
        );
        if (!r.success) {
          toast(r.error || 'Failed to toggle comment hold', 'error');
          return;
        }
        const action = r.data?.action;
        if (action === 'restored') {
          toast('Comment restored to platform');
        } else {
          toast('Comment hidden for 90 days');
        }
        void fetchReports(pageRef.current);
      }
    );
  };

  const submitResolve = async () => {
    if (!resolveReport) return;
    setResolveSaving(true);
    setResolveError('');
    const r = await api('PUT', `/reports/${encodeURIComponent(resolveReport.id)}`, {
      status: resolveStatus,
      resolution_note: resolveNote.trim(),
    });
    setResolveSaving(false);
    if (!r.success) {
      setResolveError(r.error || 'Failed to resolve report');
      return;
    }
    closeResolveModal();
    toast(`Report ${resolveStatus}`);
    void fetchReports(pageRef.current);
  };

  const deleteVideoFromResolveModal = () => {
    if (!resolveVideoId) {
      toast('No video linked to this report', 'error');
      return;
    }
    confirmDialog('Delete Reported Video', 'This will permanently delete the video.', async () => {
      const r = await api('DELETE', `/videos/${encodeURIComponent(resolveVideoId)}`);
      if (!r.success) {
        toast(r.error || 'Failed to delete video', 'error');
        return;
      }
      closeResolveModal();
      toast('Reported video deleted');
      void fetchReports(pageRef.current);
    });
  };

  const openReportVideoModal = (rawUrl: string | null, rawTitle: string | null, entityId: string | null) => {
    const url = toMediaUrl(rawUrl || '');
    if (!url) {
      toast('Reported video is unavailable', 'error');
      return;
    }
    setVideoModalTitle(rawTitle || 'Reported Video');
    setVideoModalMeta(`Video ID: ${entityId || '-'}`);
    setVideoModalUrl(url);
    setVideoModalOpen(true);
  };

  const closeReportVideoModal = () => {
    setVideoModalOpen(false);
    setVideoModalUrl('');
    setVideoModalTitle('Reported Video');
    setVideoModalMeta('');
  };

  const openReportedUser = (userId: string | null, username: string | null) => {
    const id = String(userId || '').trim();
    if (id) {
      navigate(`/users/${encodeURIComponent(id)}`);
      return;
    }
    const query = String(username || '').trim();
    if (!query) {
      toast('Reported user is unavailable', 'error');
      return;
    }
    navigate(`/users?search=${encodeURIComponent(query)}`);
  };

  const openReportCommentModal = (
    commentBody: string | null,
    commentId: string | null,
    commentUsername: string | null,
    videoId: string | null,
  ) => {
    const cid = String(commentId || '');
    const metaParts = [`Comment ID: ${cid || '-'}`];
    if (commentUsername) metaParts.push(`By: @${commentUsername}`);
    if (videoId) metaParts.push(`Video ID: ${videoId}`);

    setCommentModalBody(commentBody || 'Comment unavailable');
    setCommentModalMeta(metaParts.join(' | '));
    setCommentModalId(cid);
    setCommentModalOpen(true);
  };

  const closeReportCommentModal = () => {
    setCommentModalOpen(false);
    setCommentModalBody('');
    setCommentModalMeta('');
    setCommentModalId('');
  };

  const deleteReportedCommentFromModal = () => {
    if (!commentModalId) {
      toast('No comment linked to this report', 'error');
      return;
    }
    confirmDialog('Delete Comment', 'This will permanently remove the reported comment.', async () => {
      const r = await api('DELETE', `/comments/${encodeURIComponent(commentModalId)}`);
      if (!r.success) {
        toast(r.error || 'Failed to delete comment', 'error');
        return;
      }
      closeReportCommentModal();
      toast('Comment deleted');
      void fetchReports(pageRef.current);
    });
  };

  const toggleReportConversation = async (reportId: string, commentId: string) => {
    const isOpen = expandedThreads.has(reportId);
    if (isOpen) {
      setExpandedThreads((prev) => {
        const next = new Set(prev);
        next.delete(reportId);
        return next;
      });
      return;
    }

    setExpandedThreads((prev) => new Set(prev).add(reportId));
    if (threadCache[reportId]) return;

    setThreadLoading((prev) => new Set(prev).add(reportId));
    const r = await api<ConversationData>('GET', `/comments/${encodeURIComponent(commentId)}/conversation`);
    if (!r.success || !r.data) {
      setThreadError((prev) => ({ ...prev, [reportId]: r.error || 'Failed to load conversation' }));
      setThreadLoading((prev) => {
        const next = new Set(prev);
        next.delete(reportId);
        return next;
      });
      return;
    }

    setThreadCache((prev) => ({ ...prev, [reportId]: r.data as ConversationData }));
    setThreadLoading((prev) => {
      const next = new Set(prev);
      next.delete(reportId);
      return next;
    });
  };

  const deleteCommentFromConversation = (commentId: string, reportId: string) => {
    confirmDialog('Delete Comment', 'Delete only this comment from the conversation?', async () => {
      const r = await api('DELETE', `/comments/${encodeURIComponent(commentId)}`);
      if (!r.success) {
        toast(r.error || 'Failed to delete comment', 'error');
        return;
      }
      toast('Comment deleted');
      setThreadCache((prev) => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
      void fetchReports(pageRef.current);
    });
  };

  const toggleCommentHoldFromConversation = (commentId: string, reportId: string) => {
    confirmDialog(
      'Toggle 90 Days Hold',
      'If visible, this comment will be hidden for up to 90 days. If already hidden, it will be restored.',
      async () => {
        const r = await api<{ action?: 'hidden' | 'restored' }>(
          'PUT',
          `/comments/${encodeURIComponent(commentId)}/hide-for-review`,
          { report_id: reportId }
        );
        if (!r.success) {
          toast(r.error || 'Failed to toggle comment hold', 'error');
          return;
        }
        const action = r.data?.action;
        if (action === 'restored') {
          toast('Comment restored to platform');
        } else {
          toast('Comment hidden for 90 days');
        }
        setThreadCache((prev) => {
          const next = { ...prev };
          delete next[reportId];
          return next;
        });
        void fetchReports(pageRef.current);
      }
    );
  };

  const renderConversationPanel = (data: ConversationData, reportId: string) => {
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) return <div className="report-conv-empty">No conversation found</div>;

    return (
      <div className="report-conv-panel">
        <div className="report-conv-header">
          Conversation thread • {fmt(data.reply_count || 0)} repl{Number(data.reply_count || 0) === 1 ? 'y' : 'ies'}
        </div>
        <div className="report-conv-list">
          {items.map((item) => {
            const depth = Math.max(0, Math.min(8, Number(item.depth || 0)));
            const indent = depth * 16;
            const isReported = Number(item.is_reported) === 1;
            return (
              <div
                key={item.id}
                className={`report-conv-item ${isReported ? 'is-reported' : ''}`}
                style={{ marginLeft: `${indent}px` }}
              >
                <div className="report-conv-head">
                  <span className="report-conv-user">@{item.username || 'user'}</span>
                  <span className="report-conv-time">{fmtTime(item.created_at)}</span>
                  {isReported && <span className="badge badge-red">reported</span>}
                </div>
                <div className="report-conv-text">{item.body || ''}</div>
                <div className="report-conv-foot">
                  &#x2764; {fmt(Number(item.likes_count || 0))}
                  <button
                    className="btn btn-warn btn-sm"
                    style={{ marginLeft: 10 }}
                    onClick={() => toggleCommentHoldFromConversation(item.id, reportId)}
                  >
                    90d Hide / Restore
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    style={{ marginLeft: 8 }}
                    onClick={() => deleteCommentFromConversation(item.id, reportId)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderReportTypeCell = (rp: ReportRow) => {
    const badge = <span className="badge badge-blue">{rp.entity_type}</span>;

    if (rp.entity_type === 'video') {
      if (!rp.reported_video_url) {
        return (
          <>
            {badge}
            <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>Video unavailable</div>
          </>
        );
      }
      return (
        <a
          href="#"
          className="report-type-link"
          onClick={(e) => {
            e.preventDefault();
            openReportVideoModal(rp.reported_video_url, rp.reported_video_title, rp.entity_id);
          }}
        >
          {badge}
        </a>
      );
    }

    if (rp.entity_type === 'user') {
      if (!rp.reported_user_id && !rp.entity_id) {
        return (
          <>
            {badge}
            <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>User unavailable</div>
          </>
        );
      }
      return (
        <a
          href="#"
          className="report-type-link"
          onClick={(e) => {
            e.preventDefault();
            openReportedUser(rp.reported_user_id || rp.entity_id, rp.reported_user_username || null);
          }}
        >
          {badge}
        </a>
      );
    }

    if (rp.entity_type === 'comment') {
      if (!rp.reported_comment_id) {
        return (
          <>
            {badge}
            <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>Comment unavailable</div>
          </>
        );
      }
      return (
        <a
          href="#"
          className="report-type-link"
          onClick={(e) => {
            e.preventDefault();
            openReportCommentModal(
              rp.reported_comment_body || null,
              rp.reported_comment_id || rp.entity_id,
              rp.reported_comment_username || null,
              rp.reported_comment_video_id || null,
            );
          }}
        >
          {badge}
        </a>
      );
    }

    return badge;
  };

  return (
    <div className="reports-page">
      <div className="page-header">
        <h1>Reports Queue</h1>
        <p>Review reported content — videos, comments, users</p>
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/reports-archive')}
          >
            Open Archive
          </button>
        </div>
      </div>

      <div className="toolbar">
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All queue</option>
          <option value="pending">Pending</option>
          <option value="reviewing">Reviewing</option>
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
              <th>Date</th>
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
                <td colSpan={7}>No reports found</td>
              </tr>
            )}
            {!loading && !errorMsg && reports.map((rp) => {
              const replyCount = Number(rp.reported_comment_reply_count || 0);
              const selectedPriority = prioritySelections[rp.id] || rp.priority;
              const isThreadOpen = expandedThreads.has(rp.id);
              const isThreadLoading = threadLoading.has(rp.id);
              const threadData = threadCache[rp.id];
              const convError = threadError[rp.id];
              return (
                <Fragment key={rp.id}>
                  <tr>
                    <td>{rp.reporter_username || 'Anonymous'}</td>
                    <td>{renderReportTypeCell(rp)}</td>
                    <td style={{ maxWidth: 200, wordBreak: 'break-word' }}>
                      {rp.reason}
                      {rp.description ? (
                        <>
                          <br />
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>{rp.description}</span>
                        </>
                      ) : null}
                    </td>
                    <td><span className={`badge ${priorityBadgeClass(rp.priority)}`}>{rp.priority}</span></td>
                    <td><span className={`badge ${statusBadgeClass(rp.status)}`}>{rp.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtTime(rp.created_at)}</td>
                    <td>
                      <div className="actions">
                        <div className="report-priority-control">
                          <select
                            className="report-priority-select"
                            value={selectedPriority}
                            onChange={(e) => setPrioritySelections((prev) => ({ ...prev, [rp.id]: e.target.value }))}
                          >
                            <option value="critical">Critical</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                          <button className="btn btn-ghost btn-sm" onClick={() => updatePriority(rp.id)}>
                            Set Priority
                          </button>
                        </div>

                        {rp.entity_type === 'comment' && !!rp.reported_comment_id && (
                          <>
                            <span className="badge badge-blue">
                              {fmt(replyCount)} repl{replyCount === 1 ? 'y' : 'ies'}
                            </span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => toggleReportConversation(rp.id, String(rp.reported_comment_id))}
                              disabled={isThreadLoading}
                            >
                              Thread
                            </button>
                          </>
                        )}

                        {(rp.status === 'pending' || rp.status === 'reviewing') ? (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => markReviewing(rp.id)}>
                              Review
                            </button>
                            <button className="btn btn-green btn-sm" onClick={() => openResolveModal(rp)}>
                              Resolve
                            </button>
                          </>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                            {rp.reviewer_username ? `by ${rp.reviewer_username}` : '-'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {rp.entity_type === 'comment' && isThreadOpen && (
                    <tr className="report-conv-row">
                      <td colSpan={7}>
                        {isThreadLoading && (
                          <div className="report-conv-empty"><div className="spinner" /></div>
                        )}
                        {!isThreadLoading && !!convError && (
                          <div className="report-conv-empty">Failed to load conversation</div>
                        )}
                        {!isThreadLoading && !convError && threadData && renderConversationPanel(threadData, rp.id)}
                        {!isThreadLoading && !convError && !threadData && (
                          <div className="report-conv-empty">No conversation found</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <Pagination data={pagination} onPage={handlePage} />
      </div>

      <div className={`modal-overlay ${resolveOpen ? 'open' : ''}`} onClick={closeResolveModal}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Resolve Report</h2>
          <input type="hidden" value={resolveReport?.id || ''} readOnly />
          <input type="hidden" value={resolveVideoId} readOnly />
          <input type="hidden" value={resolveCommentId} readOnly />
          <div className="form-row">
            <label>Status</label>
            <select value={resolveStatus} onChange={(e) => setResolveStatus(e.target.value)}>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
          <div className="form-row">
            <label>Resolution Note</label>
            <textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="What action was taken..."
            />
          </div>
          <div className="modal-err">{resolveError}</div>
          {showResolveHideVideo && (
            <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>
              Hide keeps the video private for up to 90 days while waiting for review.
            </div>
          )}
          {showResolveHideComment && (
            <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>
              Hide keeps the comment private for up to 90 days while waiting for review.
            </div>
          )}
          <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
            {showResolveHideVideo && (
              <button
                className="btn btn-warn"
                style={{ flex: '1 1 180px', justifyContent: 'center' }}
                onClick={hideVideoForReviewFromResolveModal}
                disabled={resolveSaving}
              >
                90d Hide / Restore
              </button>
            )}
            {showResolveHideComment && (
              <button
                className="btn btn-warn"
                style={{ flex: '1 1 180px', justifyContent: 'center' }}
                onClick={hideCommentForReviewFromResolveModal}
                disabled={resolveSaving}
              >
                90d Hide / Restore
              </button>
            )}
            {showResolveDeleteVideo && (
              <button
                className="btn btn-danger"
                style={{ flex: '1 1 180px', justifyContent: 'center' }}
                onClick={deleteVideoFromResolveModal}
                disabled={resolveSaving}
              >
                Delete Video
              </button>
            )}
            <button className="btn btn-ghost" style={{ flex: '1 1 120px', justifyContent: 'center' }} onClick={closeResolveModal} disabled={resolveSaving}>Cancel</button>
            <button className="btn btn-green" style={{ flex: '1 1 120px', justifyContent: 'center' }} onClick={submitResolve} disabled={resolveSaving}>
              {resolveSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${videoModalOpen ? 'open' : ''}`} onClick={closeReportVideoModal}>
        <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
          <h2>{videoModalTitle}</h2>
          <div className="report-video-wrap">
            {videoModalOpen && (
              <video src={videoModalUrl} controls playsInline preload="metadata" autoPlay />
            )}
          </div>
          <div className="report-video-meta">{videoModalMeta}</div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={closeReportVideoModal}>Close</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${commentModalOpen ? 'open' : ''}`} onClick={closeReportCommentModal}>
        <div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
          <h2>Reported Comment</h2>
          <input type="hidden" value={commentModalId} readOnly />
          <div className="report-comment-box">{commentModalBody}</div>
          <div className="report-video-meta">{commentModalMeta}</div>
          <div className="modal-actions">
            {commentModalId ? (
              <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={deleteReportedCommentFromModal}>
                Delete Comment
              </button>
            ) : null}
            <button className="btn btn-ghost" onClick={closeReportCommentModal}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
