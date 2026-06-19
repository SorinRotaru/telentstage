import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toMediaUrl, useApi } from '../hooks/useApi';
import { toast } from '../hooks/useToast';
import { fmt, fmtTime } from '../utils/format';
import Pagination from '../components/Pagination';
import { confirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';

interface AdminCommentRow {
  id: string;
  body: string;
  created_at: string;
  parent_comment_id: string | null;
  likes_count: number;
  reply_count: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  video_id: string;
  video_title: string;
  video_file_url: string | null;
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
  items: AdminCommentRow[];
}

function expandableComment(text: string): { short: string; full: string; isLong: boolean } {
  const raw = String(text || '');
  if (raw.length <= 30) return { short: raw, full: raw, isLong: false };
  return { short: raw.slice(0, 30), full: raw, isLong: true };
}

export default function Comments() {
  const api = useApi();
  const location = useLocation();
  const { admin } = useAuth();
  const [comments, setComments] = useState<AdminCommentRow[]>([]);
  const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [search, setSearch] = useState('');
  const [expandedText, setExpandedText] = useState<Set<string>>(new Set());
  const [expandedConversation, setExpandedConversation] = useState<Set<string>>(new Set());
  const [conversationCache, setConversationCache] = useState<Record<string, ConversationData>>({});
  const [conversationLoading, setConversationLoading] = useState<Set<string>>(new Set());
  const [conversationError, setConversationError] = useState<Record<string, string>>({});
  const canDelete = admin?.role !== 'support';

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(1);
  const searchRef = useRef(search);
  searchRef.current = search;

  const fetchComments = useCallback(async (page: number, searchValue?: string) => {
    setLoading(true);
    setErrorMsg('');
    setConversationCache({});
    setExpandedConversation(new Set());
    setConversationLoading(new Set());
    setConversationError({});

    const q = new URLSearchParams();
    q.set('page', String(page));
    q.set('limit', '20');
    const s = (searchValue !== undefined ? searchValue : searchRef.current).trim();
    if (s) q.set('search', s);

    const r = await api<ApiPaginationData>('GET', `/comments?${q.toString()}`);
    if (!r.success || !r.data) {
      setComments([]);
      setPagination({ total: 0, page: 1, limit: 20, totalPages: 0 });
      setErrorMsg(r.error || 'Failed to load');
      setLoading(false);
      return;
    }

    const items = (r.data.items || []).filter((c) => !c.parent_comment_id);
    setComments(items);
    setPagination({
      total: Number(r.data.total || 0),
      page: Number(r.data.page || 1),
      limit: Number(r.data.limit || 20),
      totalPages: Number(r.data.totalPages || 0),
    });
    setLoading(false);
  }, [api]);

  useEffect(() => {
    const seededSearch = new URLSearchParams(location.search).get('search') || '';
    setSearch(seededSearch);
    pageRef.current = 1;
    void fetchComments(1, seededSearch);
  }, [fetchComments, location.search]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pageRef.current = 1;
      void fetchComments(1, value);
    }, 400);
  };

  const handlePage = (page: number) => {
    pageRef.current = page;
    void fetchComments(page);
  };

  const toggleCommentText = (id: string) => {
    setExpandedText((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleConversation = async (commentId: string) => {
    const isOpen = expandedConversation.has(commentId);
    if (isOpen) {
      setExpandedConversation((prev) => {
        const next = new Set(prev);
        next.delete(commentId);
        return next;
      });
      return;
    }

    setExpandedConversation((prev) => new Set(prev).add(commentId));
    if (conversationCache[commentId]) return;

    setConversationLoading((prev) => new Set(prev).add(commentId));
    const r = await api<ConversationData>('GET', `/comments/${encodeURIComponent(commentId)}/conversation`);
    if (!r.success || !r.data) {
      setConversationError((prev) => ({ ...prev, [commentId]: r.error || 'Failed to load conversation' }));
      setConversationLoading((prev) => {
        const next = new Set(prev);
        next.delete(commentId);
        return next;
      });
      return;
    }

    setConversationCache((prev) => ({ ...prev, [commentId]: r.data as ConversationData }));
    setConversationLoading((prev) => {
      const next = new Set(prev);
      next.delete(commentId);
      return next;
    });
  };

  const deleteComment = (commentId: string) => {
    confirmDialog('Delete Comment', 'This comment will be permanently removed.', async () => {
      const r = await api('DELETE', `/comments/${encodeURIComponent(commentId)}`);
      if (!r.success) {
        toast(r.error || 'Failed to delete comment', 'error');
        return;
      }
      toast('Comment deleted');
      void fetchComments(pageRef.current);
    });
  };

  const deleteCommentFromConversation = (commentId: string, parentId: string) => {
    confirmDialog('Delete Comment', 'Delete only this comment from the conversation?', async () => {
      const r = await api('DELETE', `/comments/${encodeURIComponent(commentId)}`);
      if (!r.success) {
        toast(r.error || 'Failed to delete comment', 'error');
        return;
      }
      toast('Comment deleted');
      setConversationCache((prev) => {
        const next = { ...prev };
        delete next[parentId];
        return next;
      });
      void fetchComments(pageRef.current);
    });
  };

  const toggleCommentHoldFromConversation = (commentId: string, parentId: string) => {
    confirmDialog(
      'Toggle 90 Days Hold',
      'If visible, this comment will be hidden for up to 90 days. If already hidden, it will be restored.',
      async () => {
        const r = await api<{ action?: 'hidden' | 'restored' }>(
          'PUT',
          `/comments/${encodeURIComponent(commentId)}/hide-for-review`
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
        setConversationCache((prev) => {
          const next = { ...prev };
          delete next[parentId];
          return next;
        });
        void fetchComments(pageRef.current);
      }
    );
  };

  const renderConversationPanel = (data: ConversationData, parentId: string) => {
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
            return (
              <div key={item.id} className="report-conv-item" style={{ marginLeft: `${indent}px` }}>
                <div className="report-conv-head">
                  <span className="report-conv-user">@{item.username || 'user'}</span>
                  <span className="report-conv-time">{fmtTime(item.created_at)}</span>
                </div>
                <div className="report-conv-text">{item.body || ''}</div>
                <div className="report-conv-foot">
                  &#x2764; {fmt(Number(item.likes_count || 0))}
                  {canDelete && (
                    <button
                      className="btn btn-warn btn-sm"
                      style={{ marginLeft: 10 }}
                      onClick={() => toggleCommentHoldFromConversation(item.id, parentId)}
                    >
                      90d Hide / Restore
                    </button>
                  )}
                  {canDelete && (
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ marginLeft: 8 }}
                      onClick={() => deleteCommentFromConversation(item.id, parentId)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="comments-page">
      <div className="page-header">
        <h1>Comment Moderation</h1>
        <p>Review and remove inappropriate comments</p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <span>&#x1F50D;</span>
          <input
            type="text"
            placeholder="Search comments or users..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Type</th>
              <th>Comment</th>
              <th>Likes</th>
              <th>Video</th>
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
            {!loading && !errorMsg && comments.length === 0 && (
              <tr className="empty-row">
                <td colSpan={7}>No comments found</td>
              </tr>
            )}
            {!loading && !errorMsg && comments.map((c) => {
              const expanded = expandedText.has(c.id);
              const tx = expandableComment(c.body);
              const isConversationOpen = expandedConversation.has(c.id);
              const isConversationLoading = conversationLoading.has(c.id);
              const conversation = conversationCache[c.id];
              const convError = conversationError[c.id];
              const replyCount = Number(c.reply_count || 0);

              return (
                <Fragment key={c.id}>
                  <tr>
                    <td>
                      <div className="av-cell">
                        <div className="av-ph">{String(c.username || '?').charAt(0).toUpperCase()}</div>
                        <div className="name">{c.username || 'user'}</div>
                      </div>
                    </td>
                    <td><span className="badge badge-blue">comment</span></td>
                    <td style={{ maxWidth: 300, wordBreak: 'break-word' }}>
                      {tx.isLong ? (
                        <span className="cmt-expand" data-expanded={expanded ? '1' : '0'}>
                          <span className="cmt-short" style={{ display: expanded ? 'none' : 'inline' }}>{tx.short}</span>
                          <span className="cmt-full" style={{ display: expanded ? 'inline' : 'none' }}>{tx.full}</span>
                          <button type="button" className="cmt-more-btn" onClick={() => toggleCommentText(c.id)}>
                            {expanded ? '...less' : '...more'}
                          </button>
                        </span>
                      ) : (
                        c.body || '-'
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(Number(c.likes_count || 0))}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 140, wordBreak: 'break-word' }}>
                      {c.video_title || '-'}
                      {c.video_file_url ? (
                        <>
                          <br />
                          <a
                            href={toMediaUrl(c.video_file_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="report-type-link"
                            style={{ fontSize: 11 }}
                          >
                            Open video
                          </a>
                        </>
                      ) : null}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtTime(c.created_at)}</td>
                    <td>
                      <div className="actions actions-nowrap">
                        <span className="badge badge-blue">{fmt(replyCount)} repl{replyCount === 1 ? 'y' : 'ies'}</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleConversation(c.id)}
                          disabled={isConversationLoading}
                        >
                          Thread
                        </button>
                        {canDelete && (
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteComment(c.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isConversationOpen && (
                    <tr className="report-conv-row">
                      <td colSpan={7}>
                        {isConversationLoading && (
                          <div className="report-conv-empty"><div className="spinner" /></div>
                        )}
                        {!isConversationLoading && !!convError && (
                          <div className="report-conv-empty">Failed to load conversation</div>
                        )}
                        {!isConversationLoading && !convError && conversation && renderConversationPanel(conversation, c.id)}
                        {!isConversationLoading && !convError && !conversation && (
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
    </div>
  );
}
