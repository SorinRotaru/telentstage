import { useState, useEffect, useMemo } from 'react';
import { useAppStore, DEFAULT_AVATAR } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';
import type { Video, PaginatedResponse } from '../types';

const BG = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];

interface CreatorData {
  userId: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  isFollowing: number | boolean;
}

interface CreatorUserStats {
  is_followed?: number | boolean;
  follower_count?: number;
  following_count?: number;
  website?: string | null;
  avatar_url?: string | null;
}

interface Props {
  data: CreatorData | null;
  onNav: (page: string, payload?: unknown) => void;
}

type SortMode = 'most_views' | 'more_likes' | 'more_dislikes' | 'newest' | 'oldest';
const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'most_views', label: 'Most views' },
  { value: 'more_likes', label: 'More likes' },
  { value: 'more_dislikes', label: 'More dislikes' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

export default function Creator({ data, onNav }: Props) {
  const {
    loggedIn,
    feedVideos,
    currentVideo,
    setFeedVideos,
    setFeedIndex,
    setCurrentVideo,
    setFeedCreatorContext,
    setFeedSavedContext,
  } = useAppStore();
  const [videos, setVideos] = useState<Video[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [creatorStats, setCreatorStats] = useState({
    followingCount: 0,
    followerCount: 0,
    likesCount: 0,
    dislikesCount: 0,
  });
  const [creatorWebsite, setCreatorWebsite] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [reportModal, setReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDesc, setReportDesc] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  useEffect(() => {
    if (data) {
      setIsFollowing(!!data.isFollowing);
      void loadCreatorUserStats(data.userId);
      loadVideos(data.userId);
    } else {
      setVideos([]);
      setCreatorStats({
        followingCount: 0,
        followerCount: 0,
        likesCount: 0,
        dislikesCount: 0,
      });
      setCreatorWebsite(null);
    }
  }, [data, loggedIn]);

  const loadCreatorUserStats = async (userId: string) => {
    const res = await apiFetch<CreatorUserStats>('/users/' + userId);
    const userData = res.data;
    if (!res.success || !userData) return;
    setIsFollowing(!!userData.is_followed);
    setCreatorStats((prev) => ({
      ...prev,
      followerCount: Number(userData.follower_count || 0),
      followingCount: Number(userData.following_count || 0),
    }));
    setCreatorWebsite((userData.website || '').trim() || null);
  };

  const loadVideos = async (userId: string) => {
    const limit = 50;
    const first = await apiFetch<PaginatedResponse<Video>>(`/videos/user/${userId}?page=1&limit=${limit}`);
    if (!first.success || !first.data) {
      setVideos([]);
      setCreatorStats((prev) => ({ ...prev, likesCount: 0, dislikesCount: 0 }));
      return;
    }

    const allItems: Video[] = [...(first.data.items || [])];
    const totalPages = Number(first.data.totalPages || 1);

    if (totalPages > 1) {
      const restPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const rest = await Promise.all(
        restPages.map((page) => apiFetch<PaginatedResponse<Video>>(`/videos/user/${userId}?page=${page}&limit=${limit}`))
      );
      for (const chunk of rest) {
        if (chunk.success && chunk.data?.items?.length) {
          allItems.push(...chunk.data.items);
        }
      }
    }

    setVideos(allItems);
    const likesCount = allItems.reduce((sum, v) => sum + Number(v.likes || 0), 0);
    const dislikesCount = allItems.reduce((sum, v) => sum + Number(v.dislikes || 0), 0);
    setCreatorStats((prev) => ({ ...prev, likesCount, dislikesCount }));
  };

  const doFollow = async () => {
    if (!loggedIn) { toast('Sign in to follow'); onNav('login'); return; }
    if (!data) return;
    const wasFollowing = isFollowing;
    const res = await apiFetch<{ following: boolean }>('/users/' + data.userId + '/follow', { method: 'POST' });
    if (!res.success) { toast('Error: ' + res.error); return; }
    const following = !!res.data?.following;
    setIsFollowing(following);
    if (following !== wasFollowing) {
      setCreatorStats((prev) => ({
        ...prev,
        followerCount: Math.max(0, prev.followerCount + (following ? 1 : -1)),
      }));
    }
    const nextFollowValue = following ? 1 : 0;
    const nextVideos = feedVideos.map((v) => (
      v.user_id === data.userId ? { ...v, is_following_author: nextFollowValue } : v
    ));
    setFeedVideos(nextVideos);
    if (currentVideo && currentVideo.user_id === data.userId) {
      setCurrentVideo({ ...currentVideo, is_following_author: nextFollowValue });
    }
    toast(following ? 'Now following!' : 'Unfollowed');
  };

  const openReportModal = () => {
    if (!loggedIn) { toast('Sign in to report'); onNav('login'); return; }
    setReportReason('');
    setReportDesc('');
    setReportModal(true);
  };

  const doReportUser = async () => {
    if (!data) return;
    if (!reportReason) { toast('Please select a reason'); return; }
    setReportSubmitting(true);
    const res = await apiFetch('/users/' + data.userId + '/report', {
      method: 'POST',
      body: JSON.stringify({ reason: reportReason, description: reportDesc }),
    });
    setReportSubmitting(false);
    if (!res.success) { toast('Error: ' + res.error); return; }
    setReportModal(false);
    setReportReason('');
    setReportDesc('');
    toast('User reported successfully. Thank you!');
  };

  const sortedVideos = useMemo(() => {
    const rows = [...videos];
    rows.sort((a, b) => {
      if (sortMode === 'most_views') return Number(b.views || 0) - Number(a.views || 0);
      if (sortMode === 'more_likes') return Number(b.likes || 0) - Number(a.likes || 0);
      if (sortMode === 'more_dislikes') return Number(b.dislikes || 0) - Number(a.dislikes || 0);
      if (sortMode === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return rows;
  }, [videos, sortMode]);

  const openVideo = (list: Video[], index: number) => {
    if (!data) return;
    const selected = list[index];
    if (!selected) return;
    setFeedVideos(list);
    setFeedIndex(index);
    setCurrentVideo(selected);
    setFeedSavedContext(false);
    setFeedCreatorContext({
      userId: data.userId,
      creatorName: data.fullName || data.username || 'Creator',
    });
    onNav('home');
  };

  if (!data) return null;
  const fmt = (value: number) => new Intl.NumberFormat().format(Math.max(0, Number(value || 0)));
  const websiteHref = creatorWebsite && /^https?:\/\//i.test(creatorWebsite)
    ? creatorWebsite
    : creatorWebsite
      ? `https://${creatorWebsite}`
      : null;

  return (
    <div className="sp">
      <div className="ph">
        <div className="bbtn" onClick={() => onNav('home')}>&#8592; Back</div>
      </div>

      {/* Creator header */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0 20px', gap: 10 }}>
        <div style={{ width: 80, height: 80, borderRadius: '50%', overflow: 'hidden', border: '3px solid rgba(255,255,255,.3)' }}>
          <img src={DEFAULT_AVATAR}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }} alt="" />
        </div>
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>@{data.username || 'user'}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8, color: 'rgba(255,255,255,.82)', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          <span>Followers {fmt(creatorStats.followerCount)}</span>
          <span style={{ opacity: 0.55 }}>•</span>
          <span>Likes {fmt(creatorStats.likesCount)}</span>
          <span style={{ opacity: 0.55 }}>•</span>
          <span>Dislikes {fmt(creatorStats.dislikesCount)}</span>
        </div>
        {creatorWebsite && websiteHref && (
          <a
            href={websiteHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#a6d3ff', fontSize: 13, textDecoration: 'underline', wordBreak: 'break-all', marginBottom: 8 }}
          >
            {creatorWebsite}
          </a>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={doFollow}
            style={{ background: isFollowing ? '#444' : 'var(--acc)', color: '#fff', border: 'none', borderRadius: 30, padding: '10px 24px', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {isFollowing ? 'Following' : 'Follow'}
          </button>
          <button
            onClick={openReportModal}
            style={{
              background: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: 30,
              padding: '10px 24px',
              fontFamily: 'inherit',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
            aria-label="Report user"
          >
            <img
              src="/icons/report-user.png"
              alt=""
              style={{ width: 16, height: 16, objectFit: 'contain' }}
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
            <span aria-hidden style={{ display: 'none', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🚩</span>
            <span>Report</span>
          </button>
        </div>
      </div>

      {/* Videos grid */}
      <div style={{ display: 'flex', justifyContent: 'center', width: '100%', padding: '0 12px 10px', boxSizing: 'border-box' }}>
        <div style={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, padding: 8, borderRadius: 14, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.14)', backdropFilter: 'blur(6px)' }}>
          {SORT_OPTIONS.map((opt) => {
            const active = sortMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSortMode(opt.value)}
                style={{
                  background: active ? 'var(--acc)' : 'rgba(255,255,255,.06)',
                  color: '#fff',
                  border: active ? '1px solid rgba(255,255,255,.45)' : '1px solid rgba(255,255,255,.18)',
                  borderRadius: 999,
                  padding: '7px 12px',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  lineHeight: 1,
                }}
                aria-pressed={active}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="vg">
        {sortedVideos.length === 0 ? (
          <div style={{ gridColumn: '1/-1', padding: 24, textAlign: 'center', color: '#555' }}>No videos found</div>
        ) : sortedVideos.map((v, i) => (
          <div className={`vgi ${BG[i % BG.length]}`} key={v.id} onClick={() => openVideo(sortedVideos, i)} style={{ position: 'relative' }}>
            {v.thumbnail_url ? (
              <img src={v.thumbnail_url} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} alt="" />
            ) : (
              <video src={v.file_url} preload="metadata" muted playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0, pointerEvents: 'none' }}
                onLoadedMetadata={(e) => { (e.target as HTMLVideoElement).currentTime = 1; }} />
            )}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.6)', pointerEvents: 'none' }}>
              <img
                src="/icons/play.png"
                alt=""
                style={{ width: 34, height: 34, objectFit: 'contain' }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                  if (fb) fb.style.display = 'inline';
                }}
              />
              <span aria-hidden style={{ display: 'none', fontSize: 22 }}>&#9654;</span>
            </div>
            <div style={{ position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ minWidth: 118, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 12px', color: '#fff', fontSize: 11, fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,.7)', background: 'rgba(16, 16, 16, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', backdropFilter: 'blur(6px)' }}>
                <span style={{ lineHeight: 1.1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <img
                    src="/icons/like.png"
                    alt=""
                    style={{ width: 14, height: 14, objectFit: 'contain' }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fb) fb.style.display = 'inline';
                    }}
                  />
                  <span aria-hidden style={{ display: 'none' }}>&#128077;</span>
                  <span>{v.likes || 0}</span>
                </span>
                <span style={{ lineHeight: 1.1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <img
                    src="/icons/dislike.png"
                    alt=""
                    style={{ width: 14, height: 14, objectFit: 'contain' }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fb) fb.style.display = 'inline';
                    }}
                  />
                  <span aria-hidden style={{ display: 'none' }}>&#128078;</span>
                  <span>{v.dislikes || 0}</span>
                </span>
                <span style={{ lineHeight: 1.1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <img
                    src="/icons/views.png"
                    alt=""
                    style={{ width: 14, height: 14, objectFit: 'contain' }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fb) fb.style.display = 'inline';
                    }}
                  />
                  <span aria-hidden style={{ display: 'none' }}>&#128065;</span>
                  <span>{v.views || 0}</span>
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>

      {reportModal && (
        <div style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 400 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 20 }}>Report User</div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Reason</div>
              <select value={reportReason} onChange={(e) => setReportReason(e.target.value)}
                style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}>
                <option value="">-- Select a reason --</option>
                <option value="Harassment or bullying">Harassment or bullying</option>
                <option value="Impersonation">Impersonation</option>
                <option value="Spam or misleading">Spam or misleading</option>
                <option value="Inappropriate profile">Inappropriate profile</option>
                <option value="Violates community standards">Violates community standards</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Details (optional)</div>
              <textarea placeholder="Provide additional details..." value={reportDesc} onChange={(e) => setReportDesc(e.target.value)}
                style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', minHeight: 80 }} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setReportModal(false)} disabled={reportSubmitting}
                style={{ flex: 1, padding: 13, borderRadius: 12, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.6)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={doReportUser} disabled={reportSubmitting || !reportReason}
                style={{ flex: 2, padding: 13, borderRadius: 12, border: 'none', background: reportSubmitting ? 'rgba(255,0,0,.3)' : 'rgba(255,0,0,.6)', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: reportSubmitting ? 'wait' : 'pointer', opacity: reportSubmitting || !reportReason ? 0.5 : 1 }}>
                {reportSubmitting ? 'Reporting...' : 'Report User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
