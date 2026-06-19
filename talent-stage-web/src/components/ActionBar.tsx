import { useState, useEffect, useRef } from 'react';
import { DEFAULT_AVATAR, useAppStore } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from './Toast';

interface Props {
  onLike: () => void;
  onDislike: () => void;
  onOpenComments: () => void;
  onNav: (page: string, data?: unknown) => void;
  videoVoted: boolean;
  showActions?: boolean;
  showReport?: boolean;
  creatorAvatarUrl?: string | null;
}

export default function ActionBar({
  onLike,
  onDislike,
  onNav,
  videoVoted,
  showActions = true,
  showReport = true,
}: Props) {
  const { currentVideo, feedVideos, setFeedVideos, setCurrentVideo, loggedIn, setShareOpen } = useAppStore();
  const [isFollowing, setIsFollowing] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [hintMode, setHintMode] = useState(false);
  const [reportModal, setReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDesc, setReportDesc] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const followCacheRef = useRef<Record<string, boolean>>({});
  const saveCacheRef = useRef<Record<string, boolean>>({});
  const followReqIdRef = useRef(0);
  const saveReqIdRef = useRef(0);
  const activeCreatorRef = useRef<string | null>(null);
  const activeVideoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentVideo) {
      setIsFollowing(false);
      setIsSaved(false);
      activeCreatorRef.current = null;
      activeVideoRef.current = null;
      return;
    }

    const creatorId = currentVideo.user_id;
    const videoId = currentVideo.id;
    activeCreatorRef.current = creatorId;
    activeVideoRef.current = videoId;
    setIsFollowing(!!currentVideo.is_following_author);
    setIsSaved(!!currentVideo.is_saved);

    if (!loggedIn) return;

    const cachedFollow = followCacheRef.current[creatorId];
    if (typeof cachedFollow === 'boolean') {
      setIsFollowing(cachedFollow);
    } else {
      const reqId = ++followReqIdRef.current;
      void (async () => {
        const followData = await apiFetch<{ is_followed?: number | boolean }>('/users/' + creatorId);
        if (reqId !== followReqIdRef.current) return;
        if (activeCreatorRef.current !== creatorId) return;
        if (!followData.success || !followData.data) return;
        const followed = !!followData.data.is_followed;
        followCacheRef.current[creatorId] = followed;
        setIsFollowing(followed);
      })();
    }

    const cachedSaved = saveCacheRef.current[videoId];
    if (typeof cachedSaved === 'boolean') {
      setIsSaved(cachedSaved);
    } else {
      const reqId = ++saveReqIdRef.current;
      void (async () => {
        const savedData = await apiFetch<{ is_saved?: number | boolean }>('/videos/' + videoId);
        if (reqId !== saveReqIdRef.current) return;
        if (activeVideoRef.current !== videoId) return;
        if (!savedData.success || !savedData.data) return;
        const saved = !!savedData.data.is_saved;
        saveCacheRef.current[videoId] = saved;
        setIsSaved(saved);
      })();
    }
  }, [currentVideo, loggedIn]);

  useEffect(() => {
    if (loggedIn) return;
    followCacheRef.current = {};
    saveCacheRef.current = {};
    followReqIdRef.current += 1;
    saveReqIdRef.current += 1;
  }, [loggedIn]);

  useEffect(() => {
    if (!showActions) {
      setHintMode(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      if (!videoVoted) {
        setHintMode((h) => !h);
      } else {
        setHintMode(false);
      }
    }, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [videoVoted]);

  const doFollow = async () => {
    if (!loggedIn) { toast('Sign in to follow'); onNav('login'); return; }
    if (!currentVideo) return;
    const data = await apiFetch<{ following: boolean }>('/users/' + currentVideo.user_id + '/follow', { method: 'POST' });
    if (!data.success) { toast('Error: ' + data.error); return; }
    const following = !!data.data?.following;
    followCacheRef.current[currentVideo.user_id] = following;
    setIsFollowing(following);
    const nextFollowValue = following ? 1 : 0;
    const nextVideos = feedVideos.map((v) => (
      v.user_id === currentVideo.user_id ? { ...v, is_following_author: nextFollowValue } : v
    ));
    setFeedVideos(nextVideos);
    setCurrentVideo({ ...currentVideo, is_following_author: nextFollowValue });
    toast(following ? 'Now following!' : 'Unfollowed');
  };

  const doSave = async () => {
    if (!loggedIn) { toast('Sign in to save'); onNav('login'); return; }
    if (!currentVideo) return;
    const data = await apiFetch<{ saved: boolean }>('/videos/' + currentVideo.id + '/save', { method: 'POST' });
    if (!data.success) { toast('Error: ' + data.error); return; }
    const saved = !!data.data?.saved;
    saveCacheRef.current[currentVideo.id] = saved;
    setIsSaved(saved);
    const nextSavedValue = saved ? 1 : 0;
    const nextVideos = feedVideos.map((v) => (
      v.id === currentVideo.id ? { ...v, is_saved: nextSavedValue } : v
    ));
    setFeedVideos(nextVideos);
    setCurrentVideo({ ...currentVideo, is_saved: nextSavedValue });
    toast(saved ? 'Saved!' : 'Removed from saved');
  };

  const doReport = async () => {
    if (!loggedIn) { toast('Sign in to report'); onNav('login'); return; }
    if (!currentVideo) return;
    if (!reportReason) { toast('Please select a reason'); return; }

    setReportSubmitting(true);
    const data = await apiFetch('/videos/' + currentVideo.id + '/report', {
      method: 'POST',
      body: JSON.stringify({ reason: reportReason, description: reportDesc }),
    });
    setReportSubmitting(false);

    if (!data.success) {
      toast('Error: ' + data.error);
      return;
    }

    toast('Video reported successfully. Thank you!');
    setReportModal(false);
    setReportReason('');
    setReportDesc('');
  };

  const openCreator = () => {
    if (!currentVideo) return;
    onNav('creator', {
      userId: currentVideo.user_id,
      username: currentVideo.username,
      fullName: currentVideo.full_name,
      avatarUrl: null,
      isFollowing: followCacheRef.current[currentVideo.user_id] ?? isFollowing,
    });
  };

  return (
    <>
    {showActions && (
    <div className={`r-actions ${hintMode ? 'hint-mode' : ''}`}>
      <div className="r-arrows">
        {/* Like arrow */}
        <div className="sg" onClick={onLike} style={{ cursor: 'pointer' }}>
          <div className="sa">
            <img src="/icons/swipe-up.png"
              style={{ width: 44, height: 44, objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
              alt="Like" />
          </div>
          {/* <div className="sg-hint">Swipe Up<br />to Like</div> */}
        </div>

        {/* Dislike arrow */}
        <div className="sg" onClick={onDislike} style={{ cursor: 'pointer' }}>
          <div className="sa">
            <img src="/icons/swipe-down.png"
              style={{ width: 44, height: 44, objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
              alt="Dislike" />
          </div>
          {/* <div className="sg-hint">Swipe Down<br />to Dislike</div> */}
        </div>
      </div>

      <div className="r-social">
        <div
          className="r-user-desktop"
          onClick={openCreator}
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openCreator();
            }
          }}
        >
          <div className="r-user-avatar">
            <img
              src={DEFAULT_AVATAR}
              alt="User avatar"
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR; }}
            />
          </div>
          <div className="r-user-name">
            {currentVideo?.username ? '@' + currentVideo.username : 'YOU'}
          </div>
        </div>

        {/* Follow */}
        <div className="rb" onClick={doFollow}>
          <div className="ri" id="ficon" style={{ background: 'none', border: 'none', backdropFilter: 'none' }}>
            {isFollowing ? (
              <img src="/icons/follow-active.png" className="fa" style={{ width: 46, height: 46, objectFit: 'contain' }} alt="Following" />
            ) : (
              <img src="/icons/follow.png" style={{ width: 46, height: 46, objectFit: 'contain', filter: 'invert(1)' }} alt="Follow" />
            )}
          </div>
          <div className="rl">Follow</div>
        </div>

        {/* Save */}
        <div className="rb" onClick={doSave}>
          <div className="ri" id="sicon" style={{ background: 'none', border: 'none', backdropFilter: 'none' }}>
            {isSaved ? (
              <img src="/icons/save-active.png" className="fa" style={{ width: 46, height: 46, objectFit: 'contain' }} alt="Saved" />
            ) : (
              <img src="/icons/save.png" style={{ width: 46, height: 46, objectFit: 'contain', filter: 'invert(1)' }} alt="Save" />
            )}
          </div>
          <div className="rl">Save</div>
        </div>

        {/* Share */}
        <div className="rb" onClick={() => setShareOpen(true)}>
          <div className="ri" style={{ background: 'none', border: 'none', backdropFilter: 'none' }}>
            <img src="/icons/share.png" style={{ width: 46, height: 46, objectFit: 'contain', filter: 'invert(1)' }} alt="Share" />
          </div>
          <div className="rl">Share</div>
        </div>
      </div>
    </div>
    )}

    {showReport && (
    <div className="report-left rb" onClick={() => setReportModal(true)}>
      <div style={{ background: 'none', border: 'none', backdropFilter: 'none' }}>
        <div style={{ width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
          <img
            src="/icons/report.png"
            style={{ width: 46, height: 46, objectFit: 'contain' }}
            alt="Report"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
              if (fb) fb.style.display = 'flex';
            }}
          />
          <span style={{ display: 'none', width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }} aria-hidden>🚩</span>
        </div>
      </div>
      <div className="rl">Report</div>
    </div>
    )}

    {/* Report modal */}
    {reportModal && (
      <div style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 400 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 20 }}>Report This Video</div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Reason</div>
            <select value={reportReason} onChange={(e) => setReportReason(e.target.value)}
              style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}>
              <option value="">-- Select a reason --</option>
              <option value="Inappropriate content">Inappropriate content</option>
              <option value="Harassment or bullying">Harassment or bullying</option>
              <option value="Spam or misleading">Spam or misleading</option>
              <option value="Violates community standards">Violates community standards</option>
              <option value="Copyright violation">Copyright violation</option>
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
            <button onClick={doReport} disabled={reportSubmitting || !reportReason}
              style={{ flex: 2, padding: 13, borderRadius: 12, border: 'none', background: reportSubmitting ? 'rgba(255,0,0,.3)' : 'rgba(255,0,0,.6)', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: reportSubmitting ? 'wait' : 'pointer', opacity: reportSubmitting || !reportReason ? 0.5 : 1 }}>
              {reportSubmitting ? 'Reporting...' : 'Report Video'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
