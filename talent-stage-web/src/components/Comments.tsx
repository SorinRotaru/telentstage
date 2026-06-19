import { useState, useEffect, useRef, useMemo } from 'react';
import { useAppStore, DEFAULT_AVATAR } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from './Toast';
import type { Comment, PaginatedResponse } from '../types';

interface Props {
  videoId: string | null;
  open: boolean;
  onClose: () => void;
}

export default function Comments({ videoId, open, onClose }: Props) {
  const { loggedIn, user } = useAppStore();
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [likeLoading, setLikeLoading] = useState<Record<string, boolean>>({});
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});
  const [reportModal, setReportModal] = useState(false);
  const [reportCommentId, setReportCommentId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportDesc, setReportDesc] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (videoId && open) {
      void loadComments();
    }
  }, [videoId, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 380);
    if (!open) setReplyTo(null);
  }, [open]);

  const thread = useMemo(() => {
    const byId = new Map<string, Comment>();
    const repliesByParent: Record<string, Comment[]> = {};
    const roots: Comment[] = [];

    comments.forEach((c) => { byId.set(c.id, c); });

    comments.forEach((c) => {
      const parentId = c.parent_comment_id;
      if (parentId && byId.has(parentId)) {
        if (!repliesByParent[parentId]) repliesByParent[parentId] = [];
        repliesByParent[parentId].push(c);
      } else {
        roots.push(c);
      }
    });

    roots.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    Object.values(repliesByParent).forEach((list) => {
      list.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    });

    return { roots, repliesByParent };
  }, [comments]);

  const loadComments = async () => {
    if (!videoId) return;
    const data = await apiFetch<PaginatedResponse<Comment>>('/videos/' + videoId + '/comments?limit=100');
    if (data.success && data.data) {
      setComments(data.data.items || []);
      return;
    }
    toast('Could not load comments');
  };

  const addComment = async () => {
    if (!text.trim()) return;
    if (!loggedIn) { toast('Sign in to comment'); return; }
    if (!videoId) return;

    const body = text.trim();
    const parentCommentId = replyTo?.id || null;
    setText('');

    const data = await apiFetch('/videos/' + videoId + '/comments', {
      method: 'POST',
      body: JSON.stringify({ body, parent_comment_id: parentCommentId }),
    });
    if (!data.success) {
      toast('Error: ' + data.error);
      setText(body);
      return;
    }
    setReplyTo(null);
    void loadComments();
  };

  const toggleCommentLike = async (commentId: string) => {
    if (!loggedIn) { toast('Sign in to like comments'); return; }
    if (!videoId) return;
    if (likeLoading[commentId]) return;

    setLikeLoading((prev) => ({ ...prev, [commentId]: true }));
    const data = await apiFetch<{ liked: boolean; likes_count: number }>(
      '/videos/' + videoId + '/comments/' + commentId + '/like',
      { method: 'POST' },
    );
    setLikeLoading((prev) => ({ ...prev, [commentId]: false }));

    if (!data.success || !data.data) {
      toast('Error: ' + (data.error || 'Could not like comment'));
      return;
    }

    setComments((prev) => prev.map((c) => (
      c.id === commentId
        ? {
            ...c,
            likes_count: Number(data.data?.likes_count || 0),
            is_liked: data.data?.liked ? 1 : 0,
          }
        : c
    )));
  };

  const openReportModal = (commentId: string) => {
    if (!loggedIn) { toast('Sign in to report'); return; }
    setReportCommentId(commentId);
    setReportReason('');
    setReportDesc('');
    setReportModal(true);
  };

  const submitReportComment = async () => {
    if (!videoId || !reportCommentId) return;
    if (!reportReason) { toast('Please select a reason'); return; }
    setReportSubmitting(true);
    const data = await apiFetch('/videos/' + videoId + '/comments/' + reportCommentId + '/report', {
      method: 'POST',
      body: JSON.stringify({ reason: reportReason, description: reportDesc }),
    });
    setReportSubmitting(false);
    if (!data.success) { toast('Error: ' + data.error); return; }
    setReportModal(false);
    setReportCommentId(null);
    setReportReason('');
    setReportDesc('');
    toast('Comment reported successfully. Thank you!');
  };

  const getAvatar = (c: Comment) => {
    const isMe = user && (String(c.user_id) === String(user.id) || c.username === user.username);
    if (isMe) {
      return localStorage.getItem('ts_avatar_' + user!.id) || user!.avatar_url || c.avatar_url || DEFAULT_AVATAR;
    }
    return c.avatar_url || DEFAULT_AVATAR;
  };

  const getName = (c: Comment) => {
    const isMe = user && (String(c.user_id) === String(user.id) || c.username === user.username);
    return isMe ? (user!.username || c.username) : c.username;
  };

  const isOwnComment = (c: Comment) => {
    if (!user) return false;
    return String(c.user_id) === String(user.id) || c.username === user.username;
  };

  const deleteOwnComment = async (commentId: string) => {
    if (!videoId) return;
    if (!loggedIn) { toast('Sign in first'); return; }
    if (deleteLoading[commentId]) return;
    if (!window.confirm('Delete this comment?')) return;

    setDeleteLoading((prev) => ({ ...prev, [commentId]: true }));
    const data = await apiFetch('/videos/' + videoId + '/comments/' + commentId, { method: 'DELETE' });
    setDeleteLoading((prev) => ({ ...prev, [commentId]: false }));
    if (!data.success) {
      toast('Error: ' + (data.error || 'Could not delete comment'));
      return;
    }
    if (replyTo && replyTo.id === commentId) setReplyTo(null);
    void loadComments();
  };

  const renderCommentRow = (c: Comment, depth = 0) => {
    const replies = thread.repliesByParent[c.id] || [];
    const liked = Number(c.is_liked) > 0;
    const level = Math.min(depth, 3);
    const ownComment = isOwnComment(c);
    return (
      <div key={c.id}>
        <div className={`ci ${depth > 0 ? 'ci-reply' : ''}`} style={level > 0 ? { marginLeft: `${level * 18}px` } : undefined}>
          <img
            src={getAvatar(c)}
            style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
            onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }}
            alt=""
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p><strong style={{ color: '#333' }}>{getName(c)}</strong> {c.body}</p>
            <div className="ci-meta">
              <button
                type="button"
                className={`ci-meta-btn ci-like-btn ${liked ? 'liked' : ''}`}
                disabled={!!likeLoading[c.id]}
                onClick={() => { void toggleCommentLike(c.id); }}
              >
                <span aria-hidden>{liked ? '❤' : '♡'}</span>
                <span>{Number(c.likes_count || 0)}</span>
              </button>
              <button
                type="button"
                className="ci-meta-btn"
                onClick={() => setReplyTo(c)}
              >
                Reply
              </button>
              {replies.length > 0 && (
                <span className="ci-meta-count">{replies.length} repl{replies.length === 1 ? 'y' : 'ies'}</span>
              )}
            </div>
          </div>
          {ownComment ? (
            <button
              type="button"
              onClick={() => { void deleteOwnComment(c.id); }}
              disabled={!!deleteLoading[c.id]}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                background: 'none',
                cursor: deleteLoading[c.id] ? 'wait' : 'pointer',
                color: '#8d8d8d',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 4,
                opacity: deleteLoading[c.id] ? 0.5 : 1,
              }}
              aria-label="Delete comment"
              title="Delete comment"
            >
              <img src="/icons/bin.png" alt="Delete" style={{ width: 16, height: 16, objectFit: 'contain' }} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openReportModal(c.id)}
              style={{
                width: 42,
                height: 42,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: '#8d8d8d',
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 4,
                gap: 2,
                padding: 0,
              }}
              aria-label="Report comment"
              title="Report comment"
            >
              <img
                src="/icons/report-comment.png"
                alt="Report comment"
                style={{ width: 18, height: 18, objectFit: 'contain' }}
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (!img.dataset.fallbackTried) {
                    img.dataset.fallbackTried = '1';
                    img.src = '/icons/report.png';
                    return;
                  }
                  img.style.display = 'none';
                  const fb = img.nextElementSibling as HTMLElement | null;
                  if (fb) fb.style.display = 'inline-flex';
                }}
              />
              <span aria-hidden style={{ display: 'none', alignItems: 'center', justifyContent: 'center' }}>🚩</span>
              <span style={{ fontSize: 9, fontWeight: 600, lineHeight: 1, color: '#8d8d8d' }}>Report</span>
            </button>
          )}
        </div>
        {replies.map((reply) => renderCommentRow(reply, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <div className={`cmt-drawer-wrap ${open ? 'open' : ''}`}>
        <div className="cmt-drawer">
          <div
            onClick={onClose}
            style={{
              cursor: 'pointer',
              padding: '14px 0 10px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              userSelect: 'none',
              position: 'sticky',
              top: 0,
              background: '#fff',
              zIndex: 10,
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <div className="drh" />
            <span style={{ fontSize: 10, color: '#bbb', fontWeight: 600, letterSpacing: '.5px' }}>CLOSE</span>
          </div>
          <div id="cmtList">
            {thread.roots.length === 0 ? (
              <div style={{ padding: '12px 16px', color: '#aaa', fontSize: 13 }}>No comments yet</div>
            ) : thread.roots.map((c) => renderCommentRow(c))}
          </div>
        </div>
      </div>

      <div className={`cib-fixed ${open ? 'show' : ''}`}>
        <input
          ref={inputRef}
          type="text"
          placeholder={replyTo ? `Reply to @${getName(replyTo)}...` : 'Write a comment...'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addComment(); }}
        />
        {replyTo && (
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            style={{ fontSize: 12, border: '1px solid #ddd', borderRadius: 14, padding: '6px 10px', lineHeight: 1.1 }}
          >
            Cancel
          </button>
        )}
        <button onClick={addComment}>Send</button>
      </div>

      {reportModal && (
        <div style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 400 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 20 }}>Report Comment</div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Reason</div>
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,.07)',
                  border: '1px solid rgba(255,255,255,.12)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  color: '#fff',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">-- Select a reason --</option>
                <option value="Harassment or bullying">Harassment or bullying</option>
                <option value="Spam or misleading">Spam or misleading</option>
                <option value="Hate speech">Hate speech</option>
                <option value="Inappropriate content">Inappropriate content</option>
                <option value="Violates community standards">Violates community standards</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Details (optional)</div>
              <textarea
                placeholder="Provide additional details..."
                value={reportDesc}
                onChange={(e) => setReportDesc(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,.07)',
                  border: '1px solid rgba(255,255,255,.12)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  color: '#fff',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  minHeight: 80,
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setReportModal(false)}
                disabled={reportSubmitting}
                style={{
                  flex: 1,
                  padding: 13,
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,.15)',
                  background: 'none',
                  color: 'rgba(255,255,255,.6)',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitReportComment}
                disabled={reportSubmitting || !reportReason}
                style={{
                  flex: 2,
                  padding: 13,
                  borderRadius: 12,
                  border: 'none',
                  background: reportSubmitting ? 'rgba(255,0,0,.3)' : 'rgba(255,0,0,.6)',
                  color: '#fff',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: reportSubmitting ? 'wait' : 'pointer',
                  opacity: reportSubmitting || !reportReason ? 0.5 : 1,
                }}
              >
                {reportSubmitting ? 'Reporting...' : 'Report Comment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
