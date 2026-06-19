import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { useAppStore, DEFAULT_AVATAR } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';
import { resolveVideoAvatarSrc } from '../utils/avatar';
import { useSwipe } from '../hooks/useSwipe';
import { useMomentumScroll } from '../hooks/useMomentumScroll';
import ActionBar from '../components/ActionBar';
import Comments from '../components/Comments';
import ReactionOverlay from '../components/ReactionOverlay';
import { TALENT_TYPES } from '../types';
import type { Video, PaginatedResponse, UserWithStats } from '../types';

const COMMENT_ICON = '/icons/comment.png';
const SEARCH_ICON = '/icons/search.png';
const MENU_ICON = '/icons/menu.png';
const PLAY_OVERLAY_ICON = '/icons/play.png';
const PAUSE_OVERLAY_ICON = '/icons/pause.png';
const MOMENTUM_SYNTHETIC_VELOCITY = 1.5; // px/ms for wheel/button triggers
const TITLE_PREVIEW_CHARS = 35;
const CREATOR_HANDLE_MAX = 20;
const CREATOR_HANDLE_TRUNCATED = 17;
const WHEEL_THRESHOLD = 30;
const WHEEL_DEBOUNCE_MS = 550;
const PRELOAD_WINDOW_RADIUS = 3; // 3 above + current + 3 below = 7 videos warmed
const IOS_SAFE_SWIPE = true;
const DRAG_FRAME_CAPTURE_MIN_PX = 40;
const DRAG_FRAME_CAPTURE_THROTTLE_MS = 66;
const OVERLAY_FRAME_CACHE_LIMIT = 20;
const OVERLAY_THUMB_CACHE_LIMIT = 40;
const DEFAULT_SWIPE_LOCK_MS = 5000;
const DEFAULT_SWIPE_LOCK_ENABLED = true;
const DEFAULT_SWIPE_LOCK_VISIBLE = false;
const DEFAULT_SWIPE_LOCK_OPACITY = 0.75;
const FEED_SEEN_STORAGE_PREFIX = 'ts_feed_seen_v1';
const FEED_PAGE_SIZE = 50;
const FEED_MAX_PAGES = 20;

interface Props {
  onNav: (page: string, data?: unknown) => void;
}

interface PendingSwipe {
  txn: number;
  nextIdx: number;
  nextVideo: Video;
  direction: 'up' | 'down';
  animationStarted: boolean;
}

interface FeedRuntimeConfig {
  swipe_timer_enabled?: boolean | number | string;
  swipe_timer_ms?: number;
  swipe_timer_seconds?: number;
  swipe_timer_visible?: boolean | number | string;
  swipe_timer_opacity?: number;
}

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
}

export default function Home({ onNav }: Props) {
  const {
    feedVideos, setFeedVideos, feedIndex, setFeedIndex,
    currentVideo, setCurrentVideo, feedMuted, toggleMute,
    feedCat, setFeedCat, feedCreatorContext, setFeedCreatorContext, feedSavedContext, setFeedSavedContext, cmtsOpen, setCmtsOpen,
    setDrawerOpen, loggedIn, user,
  } = useAppStore();

  const [catOpen, setCatOpen] = useState(false);
  const [browseCreatorPickerOpen, setBrowseCreatorPickerOpen] = useState(false);
  const [browseCreatorCategories, setBrowseCreatorCategories] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [creatorResults, setCreatorResults] = useState<UserWithStats[]>([]);
  const [creatorSearchOpen, setCreatorSearchOpen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [currentCreatorAvatarUrl, setCurrentCreatorAvatarUrl] = useState<string | null>(null);

  // Band (strip) animation — current + next video move as one continuous strip
  const [stripOffset, setStripOffset]   = useState(0);                        // translateY in px
  const [stripDir,    setStripDir]      = useState<'up' | 'down' | null>(null); // swipe direction
  const [stripNext,   setStripNext]     = useState<Video | null>(null);        // video peeking in
  const [,] = useState(false); // stripSnap slot kept for hook order stability

  const [containerH,  setContainerH]   = useState(844);   // feed-container height, updated by ResizeObserver
  const [, setNextVideoReady] = useState(false);
  const [reaction,    setReaction]     = useState<'like' | 'dislike' | null>(null);
  const [videoVoted,  setVideoVoted]   = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [mainCommentText, setMainCommentText] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [activeVideoReady, setActiveVideoReady] = useState(false);
  const [activeVideoErrored, setActiveVideoErrored] = useState(false);
  const [playbackIndicator, setPlaybackIndicator] = useState<'play' | 'pause' | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [swipeCountdown, setSwipeCountdown] = useState(0);
  const [swipeTimerEnabled, setSwipeTimerEnabled] = useState(DEFAULT_SWIPE_LOCK_ENABLED);
  const [swipeTimerMs, setSwipeTimerMs] = useState(DEFAULT_SWIPE_LOCK_MS);
  const [swipeTimerVisible, setSwipeTimerVisible] = useState(DEFAULT_SWIPE_LOCK_VISIBLE);
  const [swipeTimerOpacity, setSwipeTimerOpacity] = useState(DEFAULT_SWIPE_LOCK_OPACITY);
  const [muteBtnTop, setMuteBtnTop] = useState<number | null>(null);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [forceOverlayMode, setForceOverlayMode] = useState<boolean | null>(null);
  const [overlayThumbReady, setOverlayThumbReady] = useState({ current: false, next: false });
  const [, setOverlayFrameVersion] = useState(0);

  const feedContainerRef  = useRef<HTMLDivElement>(null);
  const titleRowRef       = useRef<HTMLDivElement>(null);
  const videoRefA         = useRef<HTMLVideoElement>(null);
  const videoRefB         = useRef<HTMLVideoElement>(null);
  const activeSlot        = useRef<'A' | 'B'>('A');
  const preloadedVideoId  = useRef<string | null>(null);
  const slotJustSwapped   = useRef(false);
  const pendingSwipeRef   = useRef<PendingSwipe | null>(null);
  const swipeTxnRef       = useRef(0);
  const reactionKey       = useRef(0);
  const searchTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creatorSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creatorAvatarCacheRef = useRef<Record<string, string | null>>({});
  const preloadWaitTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapBackTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postCommitCleanupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelTimer        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupPlayWatchdog = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadFeedSeqRef    = useRef(0);
  const failedVideos      = useRef<Set<string>>(new Set());
  const preloadWindowRef  = useRef<Map<string, HTMLVideoElement>>(new Map());
  const overlayThumbCacheRef = useRef<Set<string>>(new Set());
  const overlayThumbLoadRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const overlayFrameCacheRef = useRef<Map<string, string>>(new Map());
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastCaptureTimeRef = useRef(0);
  const pausedByScrollRef = useRef(false);
  const swipeLockUntilRef = useRef(0);
  const swipeCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchMilestonesRef = useRef<Set<number>>(new Set());
  const lastWatchPctRef = useRef<number>(0);
  const watchStartedAtRef = useRef<number>(Date.now());
  const completionSentRef = useRef<boolean>(false);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const momentumRef = useRef<{ startMomentum: (offset: number, velocity: number) => void; cancel: () => void } | null>(null);
  const seenScopeKeyRef = useRef('');
  const seenVideoIdsRef = useRef<Set<string>>(new Set());

  const buildFeedScopeKey = useCallback((talentType: string, search: string) => {
    const viewer = (user?.id || 'anon').trim() || 'anon';
    const category = (talentType || '').trim().toLowerCase() || 'all';
    const query = (search || '').trim().toLowerCase() || '-';
    return `${FEED_SEEN_STORAGE_PREFIX}:${viewer}:${category}:${query}`;
  }, [user?.id]);

  const loadSeenVideoIds = useCallback((scopeKey: string, allowedIds: Set<string>) => {
    try {
      const raw = localStorage.getItem(scopeKey);
      if (!raw) return new Set<string>();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set<string>();
      const seen = new Set<string>();
      for (const item of parsed) {
        if (typeof item !== 'string') continue;
        if (allowedIds.has(item)) seen.add(item);
      }
      return seen;
    } catch {
      return new Set<string>();
    }
  }, []);

  const persistSeenVideoIds = useCallback((scopeKey: string, seenIds: Set<string>) => {
    try {
      localStorage.setItem(scopeKey, JSON.stringify(Array.from(seenIds)));
    } catch {
      // ignore storage failures
    }
  }, []);

  const getActiveRef = useCallback(() =>
    activeSlot.current === 'A' ? videoRefA : videoRefB, []);

  const getInactiveRef = useCallback(() =>
    activeSlot.current === 'A' ? videoRefB : videoRefA, []);

  // Mobile-safe play: begin muted for autoplay policy, then restore user preference.
  const safePlay = useCallback((el: HTMLVideoElement) => {
    el.muted = true;
    el.play().then(() => { el.muted = feedMuted; }).catch(() => {
      el.muted = true;
      el.play().catch(() => {});
    });
  }, [feedMuted]);

  const settlePreloadedVideo = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    try {
      el.pause();
      if (el.readyState >= 2) el.currentTime = 0;
    } catch {
      // noop
    }
  }, []);

  const preloadOverlayThumb = useCallback((url: string | null | undefined): Promise<boolean> => {
    if (!url) return Promise.resolve(false);
    if (url.startsWith('data:')) return Promise.resolve(true);
    if (overlayThumbCacheRef.current.has(url)) return Promise.resolve(true);
    const inFlight = overlayThumbLoadRef.current.get(url);
    if (inFlight) return inFlight;

    const loader = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const cache = overlayThumbCacheRef.current;
        if (cache.has(url)) cache.delete(url);
        cache.add(url);
        while (cache.size > OVERLAY_THUMB_CACHE_LIMIT) {
          const oldestKey = cache.values().next().value as string | undefined;
          if (!oldestKey) break;
          cache.delete(oldestKey);
        }
        overlayThumbLoadRef.current.delete(url);
        resolve(true);
      };
      img.onerror = () => {
        overlayThumbLoadRef.current.delete(url);
        resolve(false);
      };
      img.src = url;
    });

    overlayThumbLoadRef.current.set(url, loader);
    return loader;
  }, []);

  const isOverlayImageReady = useCallback((url: string | null | undefined) => {
    if (!url) return false;
    if (url.startsWith('data:')) return true;
    return overlayThumbCacheRef.current.has(url);
  }, []);

  const getOverlayImageForVideo = useCallback((video?: Video | null) => {
    if (!video) return null;
    return video.thumbnail_url || overlayFrameCacheRef.current.get(video.id) || null;
  }, []);

  const resetOverlaySwipeState = useCallback(() => {
    setForceOverlayMode(null);
    setOverlayThumbReady({ current: false, next: false });
  }, []);

  const captureActiveFrame = useCallback(() => {
    if (!currentVideo) return;
    const active = getActiveRef().current;
    if (!active) return;
    const vw = active.videoWidth || 0;
    const vh = active.videoHeight || 0;
    if (vw < 2 || vh < 2) return;

    try {
      const canvas = frameCanvasRef.current || document.createElement('canvas');
      frameCanvasRef.current = canvas;
      const maxW = 360;
      const scale = Math.min(1, maxW / vw);
      canvas.width = Math.max(2, Math.round(vw * scale));
      canvas.height = Math.max(2, Math.round(vh * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      ctx.drawImage(active, 0, 0, canvas.width, canvas.height);
      const frameData = canvas.toDataURL('image/jpeg', 0.72);
      if (!frameData || frameData.length < 1000) return;
      const cache = overlayFrameCacheRef.current;
      if (cache.get(currentVideo.id) === frameData) return;
      if (cache.has(currentVideo.id)) cache.delete(currentVideo.id);
      cache.set(currentVideo.id, frameData);
      while (cache.size > OVERLAY_FRAME_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        cache.delete(oldestKey);
      }
      setOverlayFrameVersion((v) => v + 1);
    } catch {
      // Ignore tainted canvas / decode errors and fall back to thumbnails.
    }
  }, [currentVideo, getActiveRef]);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!sentinel) return;
    try {
      await sentinel.release();
    } catch {
      // ignored
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    const wakeLockApi = (navigator as unknown as {
      wakeLock?: {
        request?: (type: 'screen') => Promise<WakeLockSentinelLike>;
      };
    }).wakeLock;
    if (typeof wakeLockApi?.request !== 'function') return;
    if (wakeLockRef.current && !wakeLockRef.current.released) return;
    try {
      const sentinel = await wakeLockApi.request('screen');
      wakeLockRef.current = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
      });
    } catch {
      // ignored
    }
  }, []);

  useEffect(() => {
    if (!IOS_SAFE_SWIPE || typeof navigator === 'undefined') return;
    const ua = navigator.userAgent || '';
    const isIOSLike = /iPhone|iPad|iPod/i.test(ua)
      || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
    setIsIOSDevice(isIOSLike);
  }, []);

  // Track container height so strip slots are exactly the right size
  useEffect(() => {
    const el = feedContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setContainerH(entries[0].contentRect.height);
    });
    ro.observe(el);
    setContainerH(el.clientHeight || 844);
    return () => ro.disconnect();
  }, []);

  // Keep mute button directly below title row, including expanded "...more" state.
  useLayoutEffect(() => {
    const row = titleRowRef.current;
    if (!row) {
      setMuteBtnTop(null);
      return;
    }

    const updateMuteTop = () => {
      const display = window.getComputedStyle(row).display;
      if (display === 'none') {
        setMuteBtnTop(null);
        return;
      }

      const rect = row.getBoundingClientRect();
      if (rect.height <= 0) {
        setMuteBtnTop(null);
        return;
      }

      const desiredTop = Math.round(rect.bottom + 8);
      const maxTop = Math.max(56, window.innerHeight - 180);
      setMuteBtnTop(Math.min(desiredTop, maxTop));
    };

    updateMuteTop();
    const ro = new ResizeObserver(updateMuteTop);
    ro.observe(row);
    window.addEventListener('resize', updateMuteTop);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateMuteTop);
    };
  }, [titleExpanded, currentVideo?.id, currentVideo?.title]);

  // Feed loading
  const loadFeed = useCallback(async (talentType = '', search = ''): Promise<boolean> => {
    const seq = ++loadFeedSeqRef.current;
    let q = '';
    if (talentType) q += '?talent_type=' + encodeURIComponent(talentType);
    if (search) q += (q ? '&' : '?') + 'search=' + encodeURIComponent(search);
    const allItems: Video[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= FEED_MAX_PAGES) {
      const pageUrl = '/videos' + q + (q ? '&' : '?') + `page=${page}&limit=${FEED_PAGE_SIZE}`;
      const data = await apiFetch<PaginatedResponse<Video>>(pageUrl);

      // A newer loadFeed call won the race; do not trigger startup retries.
      if (seq !== loadFeedSeqRef.current) return true;

      if (!data.success || !data.data) {
        toast('Could not load feed');
        return false;
      }

      allItems.push(...(data.data.items || []));
      const parsedTotalPages = Number(data.data.totalPages || 1);
      totalPages = Number.isFinite(parsedTotalPages)
        ? Math.max(1, Math.floor(parsedTotalPages))
        : 1;

      if ((data.data.items || []).length === 0) break;
      page += 1;
    }

    const dedupMap = new Map<string, Video>();
    for (const item of allItems) {
      if (!item?.id) continue;
      if (!dedupMap.has(item.id)) dedupMap.set(item.id, item);
    }
    const rawItems = Array.from(dedupMap.values());
    const categoryFilter = (talentType || '').trim().toLowerCase();
    const items = categoryFilter
      ? rawItems.filter((v) => (v.talent_type || '').trim().toLowerCase() === categoryFilter)
      : rawItems;

    const scopeKey = buildFeedScopeKey(talentType, search);
    const allowedIds = new Set(items.map((v) => v.id));
    const seenInScope = loadSeenVideoIds(scopeKey, allowedIds);
    seenScopeKeyRef.current = scopeKey;
    seenVideoIdsRef.current = seenInScope;
    persistSeenVideoIds(scopeKey, seenInScope);

    failedVideos.current.clear();
    preloadedVideoId.current = null;
    pendingSwipeRef.current = null;
    setNextVideoReady(false);
    activeSlot.current = 'A';
    slotJustSwapped.current = false;
    const slotA = videoRefA.current;
    if (slotA) { slotA.pause(); slotA.removeAttribute('src'); slotA.load(); }
    const slotB = videoRefB.current;
    if (slotB) { slotB.pause(); slotB.removeAttribute('src'); slotB.load(); }
    for (const el of preloadWindowRef.current.values()) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    preloadWindowRef.current.clear();
    setFeedVideos(items);

    if (items.length > 0) {
      const followedUnseen = items
        .map((video, idx) => ({ video, idx }))
        .filter(({ video }) => Number(video.is_following_author) === 1 && !seenInScope.has(video.id))
        .sort((a, b) => {
          const at = new Date(a.video.created_at || '').getTime() || 0;
          const bt = new Date(b.video.created_at || '').getTime() || 0;
          return bt - at;
        });

      let startIdx = followedUnseen.length > 0
        ? followedUnseen[0].idx
        : items.findIndex((v) => !seenInScope.has(v.id));
      if (startIdx < 0) {
        // Every video from this scope was already seen: start a new cycle.
        seenInScope.clear();
        persistSeenVideoIds(scopeKey, seenInScope);
        startIdx = 0;
      }

      const first = items[startIdx];
      setFeedIndex(startIdx);
      setCurrentVideo(first);
      // Prime and play first video immediately on initial app open (even for anonymous visitors).
      requestAnimationFrame(() => {
        if (seq !== loadFeedSeqRef.current) return;
        const active = getActiveRef().current;
        if (!active) return;
        const src = active.currentSrc || active.src || '';
        if (active.dataset.videoId !== first.id || !src.includes(first.file_url)) {
          active.dataset.videoId = first.id;
          active.src = first.file_url;
          active.preload = 'auto';
          active.load();
        }
        safePlay(active);
      });
      return true;
    }
    seenInScope.clear();
    persistSeenVideoIds(scopeKey, seenInScope);
    setFeedIndex(0);
    setCurrentVideo(null);
    return true;
  }, [
    buildFeedScopeKey,
    getActiveRef,
    loadSeenVideoIds,
    persistSeenVideoIds,
    safePlay,
    setFeedVideos,
    setFeedIndex,
    setCurrentVideo,
  ]);

  useEffect(() => {
    let cancelled = false;

    const boot = async (attempt: number) => {
      const ok = await loadFeed(feedCat, searchTerm);
      if (cancelled || ok) return;
      if (attempt >= 3) return;
      if (startupRetryTimer.current) clearTimeout(startupRetryTimer.current);
      startupRetryTimer.current = setTimeout(() => {
        void boot(attempt + 1);
      }, 900 * (attempt + 1));
    };

    if (!currentVideo || feedVideos.length === 0) {
      void boot(0);
    }

    return () => {
      cancelled = true;
      if (startupRetryTimer.current) clearTimeout(startupRetryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setActiveVideoReady(false);
    setActiveVideoErrored(false);
  }, [currentVideo?.id]);

  useEffect(() => {
    if (!currentVideo?.id) return;
    const scopeKey = seenScopeKeyRef.current;
    if (!scopeKey) return;
    const seen = seenVideoIdsRef.current;
    if (seen.has(currentVideo.id)) return;
    seen.add(currentVideo.id);
    persistSeenVideoIds(scopeKey, seen);
  }, [currentVideo?.id, persistSeenVideoIds]);

  useEffect(() => {
    // If auth state changes and feed is still empty, retry loading once.
    if (currentVideo || feedVideos.length > 0) return;
    void loadFeed(feedCat, searchTerm);
  }, [loggedIn, currentVideo, feedVideos.length, feedCat, searchTerm, loadFeed]);

  useEffect(() => {
    if (!currentVideo) return;

    if (startupPlayWatchdog.current) {
      clearInterval(startupPlayWatchdog.current);
      startupPlayWatchdog.current = null;
    }

    const ensureFirstVideoPlayback = () => {
      const active = getActiveRef().current;
      if (!active) return;
      const src = active.currentSrc || active.src || '';
      if (active.dataset.videoId !== currentVideo.id || !src.includes(currentVideo.file_url)) {
        active.dataset.videoId = currentVideo.id;
        active.src = currentVideo.file_url;
        active.preload = 'auto';
        active.load();
      }
      if (active.paused) safePlay(active);
    };

    ensureFirstVideoPlayback();
    const t1 = setTimeout(ensureFirstVideoPlayback, 180);
    const t2 = setTimeout(ensureFirstVideoPlayback, 520);
    let tries = 0;
    startupPlayWatchdog.current = setInterval(() => {
      const active = getActiveRef().current;
      if (!active) return;
      if (!active.paused) {
        if (startupPlayWatchdog.current) {
          clearInterval(startupPlayWatchdog.current);
          startupPlayWatchdog.current = null;
        }
        return;
      }
      tries += 1;
      ensureFirstVideoPlayback();
      if (tries >= 12 && startupPlayWatchdog.current) {
        clearInterval(startupPlayWatchdog.current);
        startupPlayWatchdog.current = null;
      }
    }, 300);

    const onPageShow = () => ensureFirstVideoPlayback();
    window.addEventListener('pageshow', onPageShow);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (startupPlayWatchdog.current) {
        clearInterval(startupPlayWatchdog.current);
        startupPlayWatchdog.current = null;
      }
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [currentVideo?.id, currentVideo?.file_url, getActiveRef, safePlay, currentVideo]);

  useEffect(() => {
    return () => {
      if (preloadWaitTimer.current) clearTimeout(preloadWaitTimer.current);
      if (snapBackTimer.current) clearTimeout(snapBackTimer.current);
      if (postCommitCleanupTimer.current) clearTimeout(postCommitCleanupTimer.current);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      if (playbackIndicatorTimer.current) clearTimeout(playbackIndicatorTimer.current);
      if (startupRetryTimer.current) clearTimeout(startupRetryTimer.current);
      if (startupPlayWatchdog.current) clearInterval(startupPlayWatchdog.current);
      if (swipeCountdownTimerRef.current) clearInterval(swipeCountdownTimerRef.current);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (creatorSearchTimer.current) clearTimeout(creatorSearchTimer.current);
      for (const el of preloadWindowRef.current.values()) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      preloadWindowRef.current.clear();
      overlayThumbLoadRef.current.clear();
      void releaseWakeLock();
    };
  }, [releaseWakeLock]);

  useEffect(() => {
    let cancelled = false;

    const loadFeedRuntimeConfig = async () => {
      const data = await apiFetch<FeedRuntimeConfig>('/feed-config');
      if (cancelled || !data.success || !data.data) return;

      const toBool = (value: unknown): boolean | null => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        if (typeof value === 'string') {
          const normalized = value.trim().toLowerCase();
          if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
          if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
        }
        return null;
      };

      const enabled = toBool(data.data.swipe_timer_enabled);
      if (enabled !== null) setSwipeTimerEnabled(enabled);

      const rawMs = Number(data.data.swipe_timer_ms);
      if (Number.isFinite(rawMs)) {
        const timerMs = Math.max(0, Math.min(60000, Math.floor(rawMs)));
        setSwipeTimerMs(timerMs);
      } else {
        const rawSeconds = Number(data.data.swipe_timer_seconds);
        if (Number.isFinite(rawSeconds)) {
          const timerMs = Math.max(0, Math.min(60000, Math.floor(rawSeconds * 1000)));
          setSwipeTimerMs(timerMs);
        }
      }

      const visible = toBool(data.data.swipe_timer_visible);
      setSwipeTimerVisible(visible === null ? DEFAULT_SWIPE_LOCK_VISIBLE : visible);

      const rawOpacity = Number(data.data.swipe_timer_opacity);
      if (Number.isFinite(rawOpacity)) {
        const opacity = Math.max(0.05, Math.min(1, rawOpacity));
        setSwipeTimerOpacity(opacity);
      }
    };

    void loadFeedRuntimeConfig();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (swipeCountdownTimerRef.current) {
      clearInterval(swipeCountdownTimerRef.current);
      swipeCountdownTimerRef.current = null;
    }

    if (!currentVideo) {
      swipeLockUntilRef.current = 0;
      setSwipeCountdown(0);
      return;
    }

    if (!swipeTimerEnabled || swipeTimerMs <= 0) {
      swipeLockUntilRef.current = 0;
      setSwipeCountdown(0);
      return;
    }

    swipeLockUntilRef.current = Date.now() + swipeTimerMs;
    setSwipeCountdown(Math.ceil(swipeTimerMs / 1000));

    swipeCountdownTimerRef.current = setInterval(() => {
      const remainingMs = swipeLockUntilRef.current - Date.now();
      if (remainingMs <= 0) {
        if (swipeCountdownTimerRef.current) {
          clearInterval(swipeCountdownTimerRef.current);
          swipeCountdownTimerRef.current = null;
        }
        setSwipeCountdown(0);
        return;
      }
      setSwipeCountdown(Math.ceil(remainingMs / 1000));
    }, 120);

    return () => {
      if (swipeCountdownTimerRef.current) {
        clearInterval(swipeCountdownTimerRef.current);
        swipeCountdownTimerRef.current = null;
      }
    };
  }, [currentVideo?.id, currentVideo, swipeTimerEnabled, swipeTimerMs]);

  const overlayCurrentImage = getOverlayImageForVideo(currentVideo);
  const overlayNextImage = getOverlayImageForVideo(stripNext);

  useEffect(() => {
    let cancelled = false;
    if (!stripNext || !overlayCurrentImage || !overlayNextImage) {
      setOverlayThumbReady({ current: false, next: false });
      return;
    }

    const currentCached = isOverlayImageReady(overlayCurrentImage);
    const nextCached = isOverlayImageReady(overlayNextImage);
    setOverlayThumbReady({ current: currentCached, next: nextCached });
    if (currentCached && nextCached) return;

    void preloadOverlayThumb(overlayCurrentImage).then((ok) => {
      if (cancelled) return;
      setOverlayThumbReady((prev) => (prev.current === ok ? prev : { ...prev, current: ok }));
    });
    void preloadOverlayThumb(overlayNextImage).then((ok) => {
      if (cancelled) return;
      setOverlayThumbReady((prev) => (prev.next === ok ? prev : { ...prev, next: ok }));
    });

    return () => {
      cancelled = true;
    };
  }, [isOverlayImageReady, overlayCurrentImage, overlayNextImage, preloadOverlayThumb, stripNext]);

  useEffect(() => {
    const active = getActiveRef().current;
    const shouldHoldScreenAwake = !!currentVideo
      && !autoplayBlocked
      && !!active
      && !active.paused;

    if (shouldHoldScreenAwake) {
      void requestWakeLock();
    } else {
      void releaseWakeLock();
    }
  }, [currentVideo?.id, isPaused, autoplayBlocked, getActiveRef, requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        void releaseWakeLock();
        return;
      }
      const active = getActiveRef().current;
      if (currentVideo && active && !active.paused && !autoplayBlocked) {
        void requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [currentVideo?.id, autoplayBlocked, getActiveRef, requestWakeLock, releaseWakeLock]);

  // Strip helpers
  const clearStrip = useCallback(() => {
    if (preloadWaitTimer.current) clearTimeout(preloadWaitTimer.current);
    if (snapBackTimer.current) clearTimeout(snapBackTimer.current);
    if (postCommitCleanupTimer.current) clearTimeout(postCommitCleanupTimer.current);
    setStripOffset(0);
    setStripDir(null);
    setStripNext(null);
    pausedByScrollRef.current = false;
    resetOverlaySwipeState();
  }, [resetOverlaySwipeState]);

  const schedulePostCommitCleanup = useCallback(() => {
    if (postCommitCleanupTimer.current) clearTimeout(postCommitCleanupTimer.current);
    // Keep overlay/peek state for a brief moment so handoff to active video has no pop.
    postCommitCleanupTimer.current = setTimeout(() => {
      postCommitCleanupTimer.current = null;
      setStripDir(null);
      setStripNext(null);
      resetOverlaySwipeState();
    }, 90);
  }, [resetOverlaySwipeState]);

  // Next-playable index
  const getNextPlayableIndex = useCallback((): number | null => {
    if (feedVideos.length === 0) return null;

    const seen = seenVideoIdsRef.current;
    let fallbackIdx: number | null = null;

    // Pass 1: find next unseen playable video.
    for (let i = 1; i <= feedVideos.length; i++) {
      const idx = (feedIndex + i) % feedVideos.length;
      const candidate = feedVideos[idx];
      if (!candidate || failedVideos.current.has(candidate.id)) continue;
      if (fallbackIdx === null) fallbackIdx = idx;
      if (!seen.has(candidate.id)) return idx;
    }

    // Nothing playable.
    if (fallbackIdx === null) return null;

    // All playable videos were already seen in this scope: start a new cycle.
    seen.clear();
    if (currentVideo?.id) seen.add(currentVideo.id); // avoid immediate repeat of current
    const scopeKey = seenScopeKeyRef.current;
    if (scopeKey) persistSeenVideoIds(scopeKey, seen);

    for (let i = 1; i <= feedVideos.length; i++) {
      const idx = (feedIndex + i) % feedVideos.length;
      const candidate = feedVideos[idx];
      if (!candidate || failedVideos.current.has(candidate.id)) continue;
      if (!seen.has(candidate.id)) return idx;
    }

    return fallbackIdx;
  }, [currentVideo?.id, feedVideos, feedIndex, persistSeenVideoIds]);

  const getPlayableIndexByOffset = useCallback((offset: number): number | null => {
    if (feedVideos.length === 0) return null;
    if (offset === 0) return feedIndex;
    const step = offset > 0 ? 1 : -1;
    let idx = feedIndex;
    let remaining = Math.abs(offset);
    let guard = 0;
    const maxGuard = feedVideos.length * 3;

    while (remaining > 0 && guard < maxGuard) {
      idx = (idx + step + feedVideos.length) % feedVideos.length;
      guard += 1;
      const candidate = feedVideos[idx];
      if (!candidate || failedVideos.current.has(candidate.id)) continue;
      remaining -= 1;
    }
    return remaining === 0 ? idx : null;
  }, [feedVideos, feedIndex]);

  // Warm 7 videos around the current index (3 above + current + 3 below).
  // This keeps fast swipes ready without rendering extra DOM video elements.
  useEffect(() => {
    if (feedVideos.length === 0) {
      for (const el of preloadWindowRef.current.values()) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      preloadWindowRef.current.clear();
      return;
    }

    const keepIds = new Set<string>();
    for (let offset = -PRELOAD_WINDOW_RADIUS; offset <= PRELOAD_WINDOW_RADIUS; offset += 1) {
      const idx = getPlayableIndexByOffset(offset);
      if (idx === null) continue;
      const video = feedVideos[idx];
      if (!video) continue;
      keepIds.add(video.id);

      // Current and inactive strip slot are handled by live slot A/B elements.
      if (video.id === currentVideo?.id || video.id === preloadedVideoId.current) continue;

      if (!preloadWindowRef.current.has(video.id)) {
        const el = document.createElement('video');
        el.preload = 'auto';
        el.muted = true;
        el.playsInline = true;
        el.src = video.file_url;
        el.load();
        preloadWindowRef.current.set(video.id, el);
      }
    }

    for (const [id, el] of preloadWindowRef.current.entries()) {
      if (keepIds.has(id)) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
      preloadWindowRef.current.delete(id);
    }
  }, [feedVideos, feedIndex, currentVideo?.id, getPlayableIndexByOffset]);

  // Skip on error
  const skipToNextPlayable = useCallback(() => {
    if (feedVideos.length === 0) return;
    preloadedVideoId.current = null;
    pendingSwipeRef.current = null;
    setNextVideoReady(false);
    for (let i = 1; i <= feedVideos.length; i++) {
      const nextIdx = (feedIndex + i) % feedVideos.length;
      const nextVid = feedVideos[nextIdx];
      if (!failedVideos.current.has(nextVid.id)) {
        setFeedIndex(nextIdx);
        setCurrentVideo(nextVid);
        clearStrip();
        setIsAnimating(false);
        return;
      }
    }
    setCurrentVideo(null);
    clearStrip();
    setIsAnimating(false);
  }, [feedVideos, feedIndex, setFeedIndex, setCurrentVideo, clearStrip]);

  // Video lifecycle (active slot only)
  useLayoutEffect(() => {
    if (!currentVideo) {
      setVideoVoted(false);
      setAutoplayBlocked(false);
      return;
    }

    if (slotJustSwapped.current) {
      slotJustSwapped.current = false;
      setVideoVoted(false);
      return;
    }

    let cancelled = false;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const ensureActivePlayback = () => {
      if (cancelled) return;
      const active = getActiveRef().current;
      if (!active) {
        if (retries < 8) {
          retries += 1;
          retryTimer = setTimeout(ensureActivePlayback, 60);
        }
        return;
      }

      const src = active.currentSrc || active.src || '';
      const hasExpectedSrc = src.includes(currentVideo.file_url);
      const hasExpectedId = active.dataset.videoId === currentVideo.id;
      if (!hasExpectedId || !hasExpectedSrc) {
        active.dataset.videoId = currentVideo.id;
        active.src = currentVideo.file_url;
        active.preload = 'auto';
        active.load();
      }

      safePlay(active);

      if (active.paused && retries < 8) {
        retries += 1;
        retryTimer = setTimeout(ensureActivePlayback, 120);
        return;
      }

      setAutoplayBlocked(active.paused);
      setVideoVoted(false);
    };

    ensureActivePlayback();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [currentVideo, getActiveRef, safePlay]);

  useEffect(() => {
    setAutoplayBlocked(false);
  }, [currentVideo?.id]);

  useEffect(() => {
    if (!currentVideo) return;
    const active = getActiveRef().current;
    if (!active) return;
    const src = active.currentSrc || active.src || '';
    if (!src.includes(currentVideo.file_url)) {
      active.dataset.videoId = currentVideo.id;
      active.src = currentVideo.file_url;
      active.preload = 'auto';
      active.load();
      safePlay(active);
    }
  }, [currentVideo?.id, currentVideo?.file_url, getActiveRef, safePlay]);

  useEffect(() => {
    if (!currentVideo) return;
    // Some browsers need a second play attempt shortly after first paint.
    const t = setTimeout(() => {
      const active = getActiveRef().current;
      if (!active || !active.paused) return;
      safePlay(active);
    }, 260);
    return () => clearTimeout(t);
  }, [currentVideo?.id, getActiveRef, safePlay]);

  useEffect(() => {
    const active = getActiveRef().current;
    if (active) active.muted = feedMuted;
  }, [feedMuted, getActiveRef]);

  useEffect(() => {
    setTitleExpanded(false);
    setMainCommentText('');
    watchMilestonesRef.current = new Set();
    lastWatchPctRef.current = 0;
    watchStartedAtRef.current = Date.now();
    completionSentRef.current = false;
  }, [currentVideo?.id]);

  // Eagerly preload N+1 into inactive slot.
  useEffect(() => {
    const nextIdx = getNextPlayableIndex();
    if (nextIdx === null || nextIdx === feedIndex) return;
    const nextVid = feedVideos[nextIdx];
    if (!nextVid) return;

    const el = getInactiveRef().current;
    if (!el) return;

    if (preloadedVideoId.current === nextVid.id && el.readyState >= 2) {
      setNextVideoReady(true);
      return;
    }

    preloadedVideoId.current = nextVid.id;
    setNextVideoReady(false);
    el.dataset.videoId = nextVid.id;
    el.poster = nextVid.thumbnail_url || '';
    el.src = nextVid.file_url;
    el.muted = true;
    el.preload = 'auto';
    el.load();

    const onReady = () => {
      if (el.dataset.videoId !== nextVid.id || preloadedVideoId.current !== nextVid.id) return;
      settlePreloadedVideo(el);
      setNextVideoReady(true);
    };
    const onError = () => {
      if (el.dataset.videoId !== nextVid.id || preloadedVideoId.current !== nextVid.id) return;
      preloadedVideoId.current = null;
      setNextVideoReady(false);
    };

    el.addEventListener('canplay', onReady, { once: true });
    el.addEventListener('error', onError, { once: true });
    return () => {
      el.removeEventListener('canplay', onReady);
      el.removeEventListener('error', onError);
    };
  }, [feedIndex, feedVideos, getInactiveRef, getNextPlayableIndex, settlePreloadedVideo]);

  const showReaction = (type: 'like' | 'dislike') => {
    reactionKey.current++;
    setReaction(type);
    setTimeout(() => setReaction(null), 800);
  };

  const hidePlaybackIndicator = useCallback(() => {
    if (playbackIndicatorTimer.current) {
      clearTimeout(playbackIndicatorTimer.current);
      playbackIndicatorTimer.current = null;
    }
    setPlaybackIndicator(null);
  }, []);

  const showPlaybackIndicator = useCallback((type: 'play' | 'pause') => {
    setPlaybackIndicator(type);
    if (playbackIndicatorTimer.current) clearTimeout(playbackIndicatorTimer.current);
    playbackIndicatorTimer.current = setTimeout(() => {
      setPlaybackIndicator(null);
      playbackIndicatorTimer.current = null;
    }, 650);
  }, []);

  const toggleVideoPlayback = useCallback(() => {
    const active = getActiveRef().current;
    const scrollInProgress = isAnimating
      || swipeCountdown > 0
      || pausedByScrollRef.current
      || stripDir !== null
      || Math.abs(stripOffset) > 2;
    if (!active || scrollInProgress) return;
    if (active.paused) {
      hidePlaybackIndicator();
      setIsPaused(false);
      void active.play().then(() => {
        setAutoplayBlocked(false);
      }).catch(() => {
        setIsPaused(true);
        setAutoplayBlocked(true);
      });
      setAutoplayBlocked(false);
    } else {
      active.pause();
      showPlaybackIndicator('pause');
    }
  }, [getActiveRef, hidePlaybackIndicator, isAnimating, showPlaybackIndicator, stripDir, stripOffset, swipeCountdown]);

  const handleFallbackPlay = useCallback(() => {
    const active = getActiveRef().current;
    if (!active) return;
    hidePlaybackIndicator();
    setIsPaused(false);
    safePlay(active);
    setTimeout(() => {
      if (!active.paused) setAutoplayBlocked(false);
    }, 180);
  }, [getActiveRef, hidePlaybackIndicator, safePlay]);

  const onVideoError = useCallback(() => {
    if (!currentVideo) return;
    failedVideos.current.add(currentVideo.id);
    skipToNextPlayable();
  }, [currentVideo, skipToNextPlayable]);

  const trackVideoSignal = useCallback((eventType: string, payload: Record<string, unknown> = {}) => {
    if (!currentVideo?.id) return;
    void apiFetch('/videos/' + currentVideo.id + '/event', {
      method: 'POST',
      body: JSON.stringify({
        event_type: eventType,
        ...payload,
      }),
    });
  }, [currentVideo?.id]);

  const getPlaybackMetrics = useCallback(() => {
    const el = getActiveRef().current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) {
      return { watchPct: 0, watchSeconds: 0 };
    }
    const watchSeconds = Math.max(0, Number(el.currentTime || 0));
    const watchPct = Math.max(0, Math.min(100, (watchSeconds / Number(el.duration)) * 100));
    return { watchPct, watchSeconds };
  }, [getActiveRef]);

  const onVideoTimeUpdate = useCallback(() => {
    const { watchPct, watchSeconds } = getPlaybackMetrics();
    lastWatchPctRef.current = watchPct;

    const milestones = [25, 50, 75, 90];
    for (const ms of milestones) {
      if (watchPct >= ms && !watchMilestonesRef.current.has(ms)) {
        watchMilestonesRef.current.add(ms);
        trackVideoSignal('watch_progress', {
          event_value: ms,
          watch_seconds: Number(watchSeconds.toFixed(2)),
        });
      }
    }

    if (watchPct >= 99 && !completionSentRef.current) {
      completionSentRef.current = true;
      trackVideoSignal('completion', {
        event_value: 100,
        watch_seconds: Number(watchSeconds.toFixed(2)),
      });
    }
  }, [getPlaybackMetrics, trackVideoSignal]);

  const onVideoEnded = useCallback(() => {
    if (completionSentRef.current) return;
    const { watchSeconds } = getPlaybackMetrics();
    completionSentRef.current = true;
    trackVideoSignal('completion', {
      event_value: 100,
      watch_seconds: Number(watchSeconds.toFixed(2)),
    });
  }, [getPlaybackMetrics, trackVideoSignal]);

  // Drag (finger follows strip)
  const onDragMove = useCallback((dy: number) => {
    if (isAnimating || !currentVideo) return;
    const nextIdx = getNextPlayableIndex();
    if (nextIdx === null || nextIdx === feedIndex) return;
    const nextVideo = feedVideos[nextIdx];

    const max = Math.floor(containerH * 0.75);
    const clamped = Math.max(-max, Math.min(max, dy));

    if (Math.abs(clamped) > 4 && !pausedByScrollRef.current) {
      const active = getActiveRef().current;
      if (active && !active.paused) {
        active.pause();
        hidePlaybackIndicator();
        setIsPaused(true);
        pausedByScrollRef.current = true;
      }
    }

    setStripOffset(clamped);

    if (forceOverlayMode === null && clamped !== 0) {
      const currentOverlayImage = getOverlayImageForVideo(currentVideo);
      const nextOverlayImage = getOverlayImageForVideo(nextVideo);
      const canUseOverlay = IOS_SAFE_SWIPE
        && isIOSDevice
        && !!currentOverlayImage
        && !!nextOverlayImage
        && isOverlayImageReady(currentOverlayImage)
        && isOverlayImageReady(nextOverlayImage);
      setForceOverlayMode(canUseOverlay);
    }

    const now = Date.now();
    if (Math.abs(clamped) >= DRAG_FRAME_CAPTURE_MIN_PX
      && now - lastCaptureTimeRef.current >= DRAG_FRAME_CAPTURE_THROTTLE_MS) {
      lastCaptureTimeRef.current = now;
      captureActiveFrame();
    }

    if (clamped < 0) {
      setStripDir('up');
      setStripNext(nextVideo);
    } else if (clamped > 0) {
      setStripDir('down');
      setStripNext(nextVideo);
    } else {
      setStripDir(null);
      setStripNext(null);
    }
  }, [
    captureActiveFrame, containerH, currentVideo, feedIndex, feedVideos, forceOverlayMode,
    getActiveRef, getNextPlayableIndex, getOverlayImageForVideo, isAnimating, isIOSDevice, isOverlayImageReady,
    hidePlaybackIndicator,
  ]);

  // Snap back when gesture didn't cross threshold
  const onGestureEnd = useCallback((didSwipe: boolean) => {
    if (didSwipe) {
      // onRelease or goNext will handle the momentum
      pausedByScrollRef.current = false;
      return;
    }
    if (!stripNext && stripOffset === 0) {
      if (pausedByScrollRef.current) {
        const active = getActiveRef().current;
        if (active) {
          safePlay(active);
          setAutoplayBlocked(false);
          setIsPaused(false);
        }
        pausedByScrollRef.current = false;
      }
      resetOverlaySwipeState();
      return;
    }
    // Snap back via momentum (smooth spring)
    momentumRef.current?.startMomentum(stripOffset, 0);
  }, [getActiveRef, resetOverlaySwipeState, safePlay, stripNext, stripOffset]);

  const primeInactive = useCallback((video: Video) => {
    const el = getInactiveRef().current;
    if (!el) return;
    if (preloadedVideoId.current === video.id && el.readyState >= 2) {
      setNextVideoReady(true);
      return;
    }

    preloadedVideoId.current = video.id;
    setNextVideoReady(false);
    el.dataset.videoId = video.id;
    el.poster = video.thumbnail_url || '';
    el.src = video.file_url;
    el.muted = true;
    el.preload = 'auto';
    el.load();
    settlePreloadedVideo(el);
  }, [getInactiveRef, settlePreloadedVideo]);

  const finalizeSwipe = useCallback((txn?: number) => {
    const pending = pendingSwipeRef.current;
    if (!pending) return;
    if (txn !== undefined && pending.txn !== txn) return;
    const { nextIdx, nextVideo, txn: pendingTxn } = pending;
    const inactive = getInactiveRef().current;
    if (!inactive) return;

    const commit = () => {
      const activePending = pendingSwipeRef.current;
      if (!activePending || activePending.txn !== pendingTxn) return;
      pendingSwipeRef.current = null;
      if (preloadWaitTimer.current) clearTimeout(preloadWaitTimer.current);
      getActiveRef().current?.pause();
      activeSlot.current = activeSlot.current === 'A' ? 'B' : 'A';
      slotJustSwapped.current = true;

      const nowActive = getActiveRef().current;
      if (nowActive) {
        nowActive.loop = true;
        nowActive.muted = feedMuted;
        try {
          nowActive.pause();
          nowActive.currentTime = 0;
        } catch {
          // noop
        }
        safePlay(nowActive);
      }

      setFeedIndex(nextIdx);
      setCurrentVideo(nextVideo);
      setAutoplayBlocked(false);
      setIsPaused(false);
      setStripOffset(0);
      schedulePostCommitCleanup();
      pausedByScrollRef.current = false;
      setIsAnimating(false);
      setNextVideoReady(false);
    };

    if (preloadedVideoId.current === nextVideo.id && inactive.readyState >= 2) {
      commit();
      return;
    }

    const onReady = () => {
      if (inactive.dataset.videoId !== nextVideo.id || preloadedVideoId.current !== nextVideo.id) return;
      settlePreloadedVideo(inactive);
      setNextVideoReady(true);
      commit();
    };
    const onError = () => {
      const activePending = pendingSwipeRef.current;
      if (!activePending || activePending.txn !== pendingTxn) return;
      pendingSwipeRef.current = null;
      setStripOffset(0);
      setStripDir(null);
      setStripNext(null);
      resetOverlaySwipeState();
      pausedByScrollRef.current = false;
      setIsAnimating(false);
      failedVideos.current.add(nextVideo.id);
      skipToNextPlayable();
    };
    inactive.addEventListener('canplay', onReady, { once: true });
    inactive.addEventListener('error', onError, { once: true });
  }, [feedMuted, getActiveRef, getInactiveRef, resetOverlaySwipeState, safePlay, schedulePostCommitCleanup, setFeedIndex, setCurrentVideo, settlePreloadedVideo, skipToNextPlayable]);

  // Momentum scroll
  const momentumApi = useMomentumScroll({
    containerH,
    onOffsetChange: (offset: number) => {
      setStripOffset(offset);
    },
    onCommit: (_direction: 'up' | 'down') => {
      finalizeSwipe();
    },
    onSnapBack: () => {
      pendingSwipeRef.current = null;
      setStripOffset(0);
      setStripDir(null);
      setStripNext(null);
      resetOverlaySwipeState();
      pausedByScrollRef.current = false;
      setIsAnimating(false);
      const active = getActiveRef().current;
      if (active) {
        safePlay(active);
        setAutoplayBlocked(false);
        setIsPaused(false);
      }
    },
  });
  momentumRef.current = momentumApi;

  // Helper: set up pending swipe state for a direction (shared by onRelease + goNext)
  const prepareSwipeCommit = useCallback((direction: 'up' | 'down') => {
    if (!currentVideo) return false;
    const nextIdx = getNextPlayableIndex();
    if (nextIdx === null || nextIdx === feedIndex) return false;
    const nextVideo = feedVideos[nextIdx];
    const type = direction === 'up' ? 'like' : 'dislike';

    const { watchPct, watchSeconds } = getPlaybackMetrics();
    if (watchPct < 98) {
      const quick = watchSeconds <= 2 || watchPct <= 10;
      trackVideoSignal(quick ? 'quick_skip' : 'skip', {
        event_value: Number(watchPct.toFixed(2)),
        watch_seconds: Number(watchSeconds.toFixed(2)),
      });
    }

    const txn = ++swipeTxnRef.current;

    setIsAnimating(true);
    setVideoVoted(true);
    if (snapBackTimer.current) clearTimeout(snapBackTimer.current);

    if (!loggedIn) {
      showReaction(type);
    } else {
      apiFetch('/videos/' + currentVideo.id + '/' + type, { method: 'POST' }).then((res) => {
        if (res.error === 'already_voted') {
          toast('Already voted on this video');
        } else if ((res.data as { removed?: boolean })?.removed) {
          showReaction(type);
          toast('Video removed - too many dislikes');
          const filtered = feedVideos.filter((v) => v.id !== currentVideo.id);
          setFeedVideos(filtered);
        } else {
          showReaction(type);
          toast(type === 'like' ? 'Liked!' : 'Disliked');
        }
      });
    }

    pendingSwipeRef.current = {
      txn,
      nextIdx,
      nextVideo,
      direction,
      animationStarted: true,
    };

    if (forceOverlayMode === null) {
      const currentOverlayImage = getOverlayImageForVideo(currentVideo);
      const nextOverlayImage = getOverlayImageForVideo(nextVideo);
      const canUseOverlay = IOS_SAFE_SWIPE
        && isIOSDevice
        && !!currentOverlayImage
        && !!nextOverlayImage
        && isOverlayImageReady(currentOverlayImage)
        && isOverlayImageReady(nextOverlayImage);
      setForceOverlayMode(canUseOverlay);
    }

    captureActiveFrame();
    getActiveRef().current?.pause();
    setIsPaused(false);

    // Prime inactive video
    const inactive = getInactiveRef().current;
    const readyNow = !!inactive
      && preloadedVideoId.current === nextVideo.id
      && inactive.dataset.videoId === nextVideo.id
      && inactive.readyState >= 2;
    if (readyNow) {
      setNextVideoReady(true);
    } else {
      primeInactive(nextVideo);
    }

    // Set strip direction for peek
    setStripDir(direction);
    setStripNext(nextVideo);

    return true;
  }, [
    captureActiveFrame, currentVideo, feedIndex, feedVideos, forceOverlayMode,
    getActiveRef, getInactiveRef, getNextPlayableIndex, getOverlayImageForVideo,
    getPlaybackMetrics, isIOSDevice, isOverlayImageReady, loggedIn,
    primeInactive, resetOverlaySwipeState, setFeedVideos, trackVideoSignal,
  ]);

  // Touch release → momentum
  const onRelease = useCallback((dy: number, velocityPxPerMs: number) => {
    if (swipeCountdown > 0 || isAnimating) return;
    const direction: 'up' | 'down' = dy < 0 ? 'up' : 'down';
    if (!prepareSwipeCommit(direction)) {
      // No next video — snap back via momentum with animation flag set
      setIsAnimating(true);
      momentumRef.current?.startMomentum(stripOffset, 0);
      return;
    }
    momentumRef.current?.startMomentum(stripOffset, velocityPxPerMs);
  }, [isAnimating, prepareSwipeCommit, stripOffset, swipeCountdown]);

  // Commit swipe (wheel/button path)
  const goNext = useCallback((type: 'like' | 'dislike') => {
    if (swipeCountdown > 0 || isAnimating) return;
    momentumRef.current?.cancel();
    const direction = type === 'like' ? 'up' : 'down';
    if (!prepareSwipeCommit(direction)) return;
    // Start momentum with synthetic velocity (no drag phase)
    const syntheticVelocity = direction === 'up' ? -MOMENTUM_SYNTHETIC_VELOCITY : MOMENTUM_SYNTHETIC_VELOCITY;
    momentumRef.current?.startMomentum(0, syntheticVelocity);
  }, [isAnimating, prepareSwipeCommit, swipeCountdown]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (swipeCountdown > 0) return;
    if (isAnimating) return;
    if (Math.abs(e.deltaY) < WHEEL_THRESHOLD) return;
    if (wheelTimer.current) return;
    wheelTimer.current = setTimeout(() => { wheelTimer.current = null; }, WHEEL_DEBOUNCE_MS);
    if (e.deltaY > 0) goNext('like');
    else goNext('dislike');
  }, [goNext, isAnimating, swipeCountdown]);

  const swipeInteractionBlocked = isAnimating || swipeCountdown > 0;

  const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } = useSwipe(
    () => goNext('like'),
    () => goNext('dislike'),
    swipeInteractionBlocked,
    onDragMove,
    onGestureEnd,
    feedContainerRef,
    onRelease,
  );

  // Record view
  const currentVideoId = currentVideo?.id;
  useEffect(() => {
    if (currentVideoId) {
      apiFetch('/videos/' + currentVideoId + '/view', { method: 'POST' }).catch(() => {});
    }
  }, [currentVideoId]);

  // UI helpers
  const pickCat = (c: string) => {
    setCatOpen(false);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (creatorSearchTimer.current) clearTimeout(creatorSearchTimer.current);
    setCreatorResults([]);
    setCreatorSearchOpen(false);
    setFeedCreatorContext(null);
    setFeedSavedContext(false);
    setFeedCat(c);
    setSearchTerm('');
    loadFeed(c, '');
  };

  const doSearch = () => {
    setFeedCreatorContext(null);
    setFeedSavedContext(false);
    loadFeed(feedCat, searchTerm);
  };

  const openBrowseCreatorPicker = useCallback(() => {
    setCatOpen(false);
    setBrowseCreatorCategories(feedCat ? [feedCat] : []);
    setBrowseCreatorPickerOpen(true);
  }, [feedCat]);

  const toggleBrowseCreatorCategory = useCallback((category: string) => {
    setBrowseCreatorCategories((prev) => (
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    ));
  }, []);

  const toggleBrowseCreatorAll = useCallback(() => {
    setBrowseCreatorCategories((prev) => (
      prev.length === TALENT_TYPES.length ? [] : [...TALENT_TYPES]
    ));
  }, []);

  const browseSelectedCreators = useCallback(() => {
    setBrowseCreatorPickerOpen(false);
    onNav('talent', { categories: browseCreatorCategories });
  }, [browseCreatorCategories, onNav]);

  const resetToAllVideos = useCallback(() => {
    setCatOpen(false);
    setCreatorSearchOpen(false);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (creatorSearchTimer.current) clearTimeout(creatorSearchTimer.current);
    setCreatorResults([]);
    setFeedCreatorContext(null);
    setFeedSavedContext(false);
    setFeedCat('');
    setSearchTerm('');
    loadFeed('', '');
  }, [loadFeed, setFeedCat, setFeedCreatorContext, setFeedSavedContext]);

  const loadCreatorResults = useCallback(async (term: string) => {
    const needle = term.trim();
    if (!needle) {
      setCreatorResults([]);
      setCreatorSearchOpen(false);
      return;
    }
    const data = await apiFetch<PaginatedResponse<UserWithStats>>(
      '/users?search=' + encodeURIComponent(needle) + '&limit=8'
    );
    if (!data.success || !data.data) {
      setCreatorResults([]);
      setCreatorSearchOpen(false);
      return;
    }
    const items = data.data.items || [];
    setCreatorResults(items);
    setCreatorSearchOpen(items.length > 0);
  }, []);

  const openCreatorFromSearch = useCallback((u: UserWithStats) => {
    setCreatorSearchOpen(false);
    onNav('creator', {
      userId: u.id,
      username: u.username,
      fullName: u.full_name || u.username,
      avatarUrl: null,
      isFollowing: !!u.is_followed,
    });
  }, [onNav]);

  const onSearchInput = (val: string) => {
    setSearchTerm(val);
    if (feedCreatorContext || feedSavedContext) {
      setFeedCreatorContext(null);
      setFeedSavedContext(false);
    }
    const needle = val.trim();

    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadFeed(feedCat, val), 400);

    if (creatorSearchTimer.current) clearTimeout(creatorSearchTimer.current);
    if (!needle) {
      setCreatorResults([]);
      setCreatorSearchOpen(false);
      return;
    }
    creatorSearchTimer.current = setTimeout(() => {
      void loadCreatorResults(needle);
    }, 250);
  };

  const titleText = currentVideo?.title || 'No videos yet - upload one!';
  const hasLongTitle = titleText.length > TITLE_PREVIEW_CHARS;
  const shownTitle = titleExpanded || !hasLongTitle
    ? titleText
    : titleText.slice(0, TITLE_PREVIEW_CHARS);
  const activeSearch = searchTerm.trim();
  const hasScopedFeed = !!feedCreatorContext || feedSavedContext || !!feedCat || !!activeSearch;
  const creatorHandle = (currentVideo?.username || feedCreatorContext?.creatorName || 'creator').replace(/^@/, '');
  const creatorHandleShort = creatorHandle.length > CREATOR_HANDLE_MAX
    ? `${creatorHandle.slice(0, CREATOR_HANDLE_TRUNCATED)}...`
    : creatorHandle;
  const scopedFeedText = feedCreatorContext
    ? `@${creatorHandleShort}`
    : feedSavedContext
      ? 'Saved videos'
      : feedCat && activeSearch
        ? `${feedCat} • "${activeSearch}"`
        : feedCat
          ? `${feedCat}`
          : `Search "${activeSearch}"`;
  const canQuickReset = hasScopedFeed && !activeSearch;
  const browseAllSelected = browseCreatorCategories.length === TALENT_TYPES.length;
  const resolvedCurrentVideoAvatarUrl = currentCreatorAvatarUrl
    || (currentVideo
      ? (String(currentVideo.user_id) === String(user?.id)
        ? resolveVideoAvatarSrc(
          currentVideo.user_id,
          currentVideo.avatar_url,
          user?.id,
          user?.avatar_url,
          null,
        )
        : null)
      : null);

  useEffect(() => {
    let cancelled = false;
    const currentUserId = String(user?.id || '');
    const currentVideoUserId = String(currentVideo?.user_id || '');

    if (!currentVideoUserId) {
      setCurrentCreatorAvatarUrl(null);
      return;
    }

    if (currentUserId && currentVideoUserId === currentUserId) {
      const avatar = resolveVideoAvatarSrc(
        currentVideo?.user_id || null,
        currentVideo?.avatar_url || null,
        user?.id || null,
        user?.avatar_url || null,
        null,
      );
      creatorAvatarCacheRef.current[currentVideoUserId] = avatar;
      setCurrentCreatorAvatarUrl(avatar);
      return;
    }

    const cachedAvatar = creatorAvatarCacheRef.current[currentVideoUserId];
    if (cachedAvatar !== undefined) {
      setCurrentCreatorAvatarUrl(cachedAvatar);
      return;
    }

    setCurrentCreatorAvatarUrl(null);
    void (async () => {
      const res = await apiFetch<UserWithStats>('/users/' + currentVideoUserId);
      if (cancelled) return;
      const liveAvatar = (res.success && res.data ? res.data.avatar_url : null) || currentVideo?.avatar_url || null;
      creatorAvatarCacheRef.current[currentVideoUserId] = liveAvatar;
      setCurrentCreatorAvatarUrl(liveAvatar);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentVideo?.id, currentVideo?.user_id, currentVideo?.avatar_url, user?.id, user?.avatar_url]);

  const openCreator = () => {
    if (!currentVideo) return;
    onNav('creator', {
      userId: currentVideo.user_id,
      username: currentVideo.username,
      fullName: currentVideo.full_name,
      avatarUrl: null,
      isFollowing: currentVideo.is_following_author,
    });
  };

  const toggleComments = () => setCmtsOpen(!cmtsOpen);

  const submitMainComment = useCallback(async () => {
    const body = mainCommentText.trim();

    if (!body) {
      setCmtsOpen(true);
      return;
    }

    if (!loggedIn) {
      toast('Sign in to comment');
      onNav('login');
      return;
    }

    if (!currentVideo?.id) {
      toast('No video selected');
      return;
    }

    const data = await apiFetch('/videos/' + currentVideo.id + '/comments', {
      method: 'POST',
      body: JSON.stringify({ body }),
    });

    if (!data.success) {
      toast('Error: ' + data.error);
      return;
    }

    setMainCommentText('');
    setCmtsOpen(true);
  }, [mainCommentText, loggedIn, currentVideo, onNav, setCmtsOpen]);

  // Strip styles
  const overlayEligible = IOS_SAFE_SWIPE
    && isIOSDevice
    && !!stripNext
    && !!overlayCurrentImage
    && !!overlayNextImage
    && overlayThumbReady.current
    && overlayThumbReady.next;
  const usePosterOverlaySwipe = forceOverlayMode ?? overlayEligible;
  const hidePlaybackDuringSwipe = isAnimating
    || pausedByScrollRef.current
    || stripDir !== null
    || Math.abs(stripOffset) > 2;

  const stripStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'visible',
    zIndex: 1,
    background: '#000',
    transform: usePosterOverlaySwipe ? 'translateY(0px)' : `translateY(${stripOffset}px)`,
    transition: 'none',
    willChange: usePosterOverlaySwipe ? 'auto' : 'transform',
  };

  const swipeOverlayActive = usePosterOverlaySwipe && stripDir !== null && stripNext !== null;
  const swipeOverlayTrackStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    transform: `translateY(${stripOffset}px)`,
    transition: 'none',
    willChange: 'transform',
  };

  const swipeSurfaceBaseStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    width: '100%',
    height: containerH,
    backgroundColor: '#000',
    backgroundPosition: 'center center',
    backgroundSize: 'cover',
    backgroundRepeat: 'no-repeat',
  };

  const swipeCurrentSurfaceStyle: React.CSSProperties = {
    ...swipeSurfaceBaseStyle,
    top: 0,
    backgroundColor: overlayCurrentImage ? '#000' : 'transparent',
    backgroundImage: overlayCurrentImage ? `url(${overlayCurrentImage})` : undefined,
  };

  const swipeNextSurfaceStyle: React.CSSProperties = {
    ...swipeSurfaceBaseStyle,
    top: stripDir === 'up' ? containerH : -containerH,
    backgroundImage: overlayNextImage ? `url(${overlayNextImage})` : undefined,
  };

  const videoStyle = (slot: 'A' | 'B'): React.CSSProperties => {
    const isActive = activeSlot.current === slot;
    if (isActive) {
      return {
        width: '100%', height: containerH, objectFit: 'cover',
        position: 'absolute', left: 0, right: 0, top: 0,
        zIndex: 2, visibility: 'visible', background: '#000',
      };
    }

    const showInPeek = stripDir !== null && stripNext !== null;
    return {
      width: '100%', height: containerH, objectFit: 'cover',
      position: 'absolute', left: 0, right: 0,
      top: showInPeek ? (stripDir === 'up' ? containerH : -containerH) : 0,
      zIndex: showInPeek ? 1 : 0,
      visibility: showInPeek ? 'visible' : 'hidden',
      background: '#000',
    };
  };

  // handleSwipeTransitionEnd removed — momentum handles finalization

  const isActiveEl = (e: React.SyntheticEvent<HTMLVideoElement>) =>
    e.currentTarget === getActiveRef().current;

  return (
    <>
      {/* Top bar */}
      <div className="topbar" onClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.catdd') && !target.closest('.cat-btn'))
          setCatOpen(false);
        if (!target.closest('.creator-search-dd') && !target.closest('.search-pill'))
          setCreatorSearchOpen(false);
      }}>
        <div className="search-pill">
          <button className="cat-btn" onClick={() => setCatOpen(!catOpen)}>
            <img className="cat-icon" src={MENU_ICON} alt="Menu"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (fb) fb.style.display = 'inline';
              }}
            />
            <span className="cat-fallback" style={{ display: 'none' }} aria-hidden>&#9776;</span>
          </button>
          <input
            type="text"
            placeholder={hasScopedFeed ? scopedFeedText : 'Search...'}
            value={searchTerm}
            onChange={(e) => onSearchInput(e.target.value)}
            onFocus={() => {
              if (searchTerm.trim() && creatorResults.length > 0) setCreatorSearchOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                doSearch();
                setCreatorSearchOpen(false);
              }
            }}
          />
          <span
            key={canQuickReset ? 'reset' : 'search'}
            className="si"
            onClick={canQuickReset ? resetToAllVideos : doSearch}
            style={{ cursor: 'pointer' }}
            aria-label={canQuickReset ? 'Back to all videos' : 'Search'}
            title={canQuickReset ? 'Back to all videos' : 'Search'}
          >
            {canQuickReset ? (
              <span className="si-reset">All Videos</span>
            ) : (
              <>
                <img className="si-icon" src={SEARCH_ICON} alt="Search"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                    const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                    if (fb) fb.style.display = 'inline';
                  }}
                />
                <span className="si-fallback" style={{ display: 'none' }} aria-hidden>&#128269;</span>
              </>
            )}
          </span>
        </div>
        {creatorSearchOpen && (
          <div className="creator-search-dd">
            {creatorResults.map((u) => (
              <button
                key={u.id}
                type="button"
                className="creator-search-item"
                onClick={() => openCreatorFromSearch(u)}
              >
                <div className="creator-search-avatar">
                  <img
                    src={DEFAULT_AVATAR}
                    alt=""
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR; }}
                  />
                </div>
                <div className="creator-search-meta">
                  <div className="creator-search-name">{u.full_name || u.username}</div>
                  <div className="creator-search-username">@{u.username}</div>
                </div>
              </button>
            ))}
          </div>
        )}
        <button className="hbg" onClick={() => setDrawerOpen(true)}>
          <span /><span /><span />
        </button>
        {catOpen && (
          <div className="catdd open">
            <div className="co" onClick={openBrowseCreatorPicker}
              style={{ color: '#888', fontSize: 12 }}>Browse Creators</div>
            <div style={{ borderTop: '1px solid #2a2a2a', margin: '4px 0' }} />
            <div className="co" onClick={() => pickCat('')} style={{ color: 'var(--acc)', fontWeight: 700 }}>All Videos</div>
            {TALENT_TYPES.map((t) => (
              <div className={`co ${feedCat === t ? 'sel' : ''}`} key={t} onClick={() => pickCat(t)}>{t}</div>
            ))}
          </div>
        )}
      </div>

      {browseCreatorPickerOpen && (
        <div className="browse-creators-overlay" onClick={() => setBrowseCreatorPickerOpen(false)}>
          <div className="browse-creators-modal" onClick={(e) => e.stopPropagation()}>
            <div className="browse-creators-head">
              <div className="browse-creators-title">Browse Creators</div>
              <button
                type="button"
                className="browse-creators-close"
                onClick={() => setBrowseCreatorPickerOpen(false)}
                aria-label="Close creators picker"
              >
                ×
              </button>
            </div>
            <button type="button" className="browse-creators-all" onClick={toggleBrowseCreatorAll}>
              {browseAllSelected ? 'Clear All Categories' : 'Select All Categories'}
            </button>
            <div className="browse-creators-list">
              {TALENT_TYPES.map((category) => (
                <label className="browse-creators-option" key={category}>
                  <input
                    type="checkbox"
                    checked={browseCreatorCategories.includes(category)}
                    onChange={() => toggleBrowseCreatorCategory(category)}
                  />
                  <span>{category}</span>
                </label>
              ))}
            </div>
            <div className="browse-creators-actions">
              <button
                type="button"
                className="browse-creators-cancel"
                onClick={() => setBrowseCreatorPickerOpen(false)}
              >
                Cancel
              </button>
              <button type="button" className="browse-creators-go" onClick={browseSelectedCreators}>
                Browse
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Title row */}
      <div className="vtrow" ref={titleRowRef}>
        <div className={`vtitle ${titleExpanded ? 'open' : ''}`}>
          <span className="vtxt">{shownTitle}</span>
          {hasLongTitle && (
            <button
              type="button"
              className="more"
              onClick={() => setTitleExpanded((v) => !v)}
            >
              {titleExpanded ? ' less' : '...more'}
            </button>
          )}
        </div>
        <div className="vtrow-user" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <div className="uav-sm" onClick={openCreator} style={{ cursor: 'pointer' }}>
            <img src={DEFAULT_AVATAR}
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
              onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }}
              alt="" />
          </div>
          <span style={{ color: '#fff', fontSize: 10, fontWeight: 600, maxWidth: 54, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            @{currentVideo?.username || 'user'}
          </span>
        </div>
      </div>

      {/* Feed container */}
      <div
        className={`feed-container ${cmtsOpen ? 'cmts-open' : ''}`}
        ref={feedContainerRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onWheel={onWheel}
      >
        <ReactionOverlay type={reaction} key={reactionKey.current} />

        {currentVideo ? (
          <>
            {(!activeVideoReady || activeVideoErrored) && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: '#000',
                  backgroundImage: currentVideo.thumbnail_url ? `url(${currentVideo.thumbnail_url})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center center',
                  filter: activeVideoErrored ? 'none' : 'blur(2px)',
                  opacity: activeVideoErrored ? 0.95 : 0.5,
                  zIndex: 0,
                  pointerEvents: 'none',
                }}
              />
            )}
            {/*
              VIDEO BAND — one strip containing:
                • above slot  (top: -h)  — next video when swiping DOWN
                • current slot (top:  0)  — always-playing video
                • below slot  (top: +h)  — next video when swiping UP
              The strip translates as one unit, clipped by feed-container overflow:hidden.
              Two video elements swap active/inactive roles to avoid src-swap flicker.
            */}
            <div
              className="feed-strip"
              style={stripStyle}
                          >
              <video
                ref={videoRefA}
                className="feed-slot-video"
                style={videoStyle('A')}
                loop
                playsInline
                muted
                autoPlay
                onCanPlay={(e) => {
                  if (!isActiveEl(e)) return;
                  const el = e.currentTarget;
                  if (!currentVideo || el.dataset.videoId !== currentVideo.id) return;
                  setActiveVideoReady(true);
                  setActiveVideoErrored(false);
                  if (el.paused) safePlay(el);
                }}
                onLoadedData={(e) => {
                  if (!isActiveEl(e)) return;
                  const el = e.currentTarget;
                  if (!currentVideo || el.dataset.videoId !== currentVideo.id) return;
                  setActiveVideoReady(true);
                  setActiveVideoErrored(false);
                  if (el.paused) safePlay(el);
                  captureActiveFrame();
                }}
                onLoadedMetadata={(e) => {
                  if (!isActiveEl(e)) return;
                  const el = e.currentTarget;
                  if (!currentVideo || el.dataset.videoId !== currentVideo.id) return;
                  setActiveVideoReady(true);
                  setActiveVideoErrored(false);
                  if (el.paused) safePlay(el);
                  captureActiveFrame();
                }}
                onPlay={(e) => {
                  if (!isActiveEl(e)) return;
                  hidePlaybackIndicator();
                  setIsPaused(false);
                  setAutoplayBlocked(false);
                  void requestWakeLock();
                }}
                onPause={(e) => {
                  if (isActiveEl(e) && !isAnimating) setIsPaused(true);
                  if (isActiveEl(e)) void releaseWakeLock();
                }}
                onTimeUpdate={(e) => { if (isActiveEl(e)) onVideoTimeUpdate(); }}
                onEnded={(e) => { if (isActiveEl(e)) onVideoEnded(); }}
                onError={(e) => {
                  if (!isActiveEl(e)) return;
                  setActiveVideoReady(false);
                  setActiveVideoErrored(true);
                  onVideoError();
                }}
                onClick={(e) => { if (isActiveEl(e)) toggleVideoPlayback(); }}
              />
              <video
                ref={videoRefB}
                className="feed-slot-video"
                style={videoStyle('B')}
                loop
                playsInline
                muted
                autoPlay
                onCanPlay={(e) => {
                  if (!isActiveEl(e)) return;
                  const el = e.currentTarget;
                  if (!currentVideo || el.dataset.videoId !== currentVideo.id) return;
                  setActiveVideoReady(true);
                  setActiveVideoErrored(false);
                  if (el.paused) safePlay(el);
                }}
                onLoadedData={(e) => {
                  if (!isActiveEl(e)) return;
                  const el = e.currentTarget;
                  if (!currentVideo || el.dataset.videoId !== currentVideo.id) return;
                  setActiveVideoReady(true);
                  setActiveVideoErrored(false);
                  if (el.paused) safePlay(el);
                  captureActiveFrame();
                }}
                onLoadedMetadata={(e) => {
                  if (!isActiveEl(e)) return;
                  const el = e.currentTarget;
                  if (!currentVideo || el.dataset.videoId !== currentVideo.id) return;
                  setActiveVideoReady(true);
                  setActiveVideoErrored(false);
                  if (el.paused) safePlay(el);
                  captureActiveFrame();
                }}
                onPlay={(e) => {
                  if (!isActiveEl(e)) return;
                  hidePlaybackIndicator();
                  setIsPaused(false);
                  setAutoplayBlocked(false);
                  void requestWakeLock();
                }}
                onPause={(e) => {
                  if (isActiveEl(e) && !isAnimating) setIsPaused(true);
                  if (isActiveEl(e)) void releaseWakeLock();
                }}
                onTimeUpdate={(e) => { if (isActiveEl(e)) onVideoTimeUpdate(); }}
                onEnded={(e) => { if (isActiveEl(e)) onVideoEnded(); }}
                onError={(e) => {
                  if (!isActiveEl(e)) return;
                  setActiveVideoReady(false);
                  setActiveVideoErrored(true);
                  onVideoError();
                }}
                onClick={(e) => { if (isActiveEl(e)) toggleVideoPlayback(); }}
              />
            </div>
            {swipeOverlayActive && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  overflow: 'hidden',
                  background: 'transparent',
                  zIndex: 3,
                  pointerEvents: 'none',
                }}
              >
                <div style={swipeOverlayTrackStyle} >
                  <div style={swipeCurrentSurfaceStyle} />
                  <div style={swipeNextSurfaceStyle} />
                </div>
              </div>
            )}
            {autoplayBlocked && !isAnimating && (
              <div className="autoplay-fallback">
                <button
                  type="button"
                  className="autoplay-fallback-btn"
                  onClick={handleFallbackPlay}
                >
                  Tap to play
                </button>
              </div>
            )}
            {swipeTimerVisible && swipeCountdown > 0 && (
              <div className="swipe-lock-timer" aria-hidden>
                <span style={{ color: `rgba(255, 255, 255, ${swipeTimerOpacity})` }}>{swipeCountdown}</span>
              </div>
            )}
            <div className={`playback-indicator ${(!hidePlaybackDuringSwipe && (isPaused || playbackIndicator)) ? 'show' : ''}`} aria-hidden>
              {(() => {
                const isPauseState = !isPaused && playbackIndicator === 'pause';
                const iconSrc = isPauseState ? PAUSE_OVERLAY_ICON : PLAY_OVERLAY_ICON;
                const fallback = isPauseState ? '❚❚' : '▶';
                return (
                  <>
                    <img
                      key={iconSrc}
                      className="playback-indicator-icon"
                      src={iconSrc}
                      alt=""
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                        const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                        if (fb) fb.style.display = 'inline';
                      }}
                    />
                    <span className="playback-indicator-fallback" style={{ display: 'none' }}>
                      {fallback}
                    </span>
                  </>
                );
              })()}
            </div>
          </>
        ) : (
          <div className="vbg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: '#fff', padding: '0 20px' }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>No video available</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { void loadFeed(feedCat, searchTerm); }}
              >
                Reload Feed
              </button>
            </div>
          </div>
        )}

        {/* Mute button */}
        <div className="mute-btn" onClick={toggleMute} style={muteBtnTop !== null ? { top: `${muteBtnTop}px` } : undefined}>
          {feedMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
        </div>

        {/* Report button stays inside feed container */}
        {!cmtsOpen && (
          <ActionBar
            onLike={() => goNext('like')}
            onDislike={() => goNext('dislike')}
            onOpenComments={toggleComments}
            onNav={onNav}
            videoVoted={videoVoted}
            showActions={false}
            showReport
            creatorAvatarUrl={resolvedCurrentVideoAvatarUrl}
          />
        )}

      </div>

      {/* Action bar */}
      {!cmtsOpen && (
        <ActionBar
          onLike={() => goNext('like')}
          onDislike={() => goNext('dislike')}
          onOpenComments={toggleComments}
          onNav={onNav}
          videoVoted={videoVoted}
          showActions
          showReport={false}
          creatorAvatarUrl={resolvedCurrentVideoAvatarUrl}
        />
      )}

      {/* Comment bar */}
      <div className={`cib ${cmtsOpen ? 'hidden' : ''}`}>
        <input
          type="text"
          placeholder="Comment here..."
          value={mainCommentText}
          onChange={(e) => setMainCommentText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submitMainComment();
            }
          }}
        />
        <button onClick={() => { void submitMainComment(); }}>
          <img className="cib-icon" src={COMMENT_ICON} alt="Comments"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
              if (fb) fb.style.display = 'inline';
            }}
          />
          <span className="cib-icon-fallback" style={{ display: 'none' }} aria-hidden>&#128172;</span>
        </button>
      </div>

      {/* Comments drawer */}
      <Comments
        videoId={currentVideo?.id || null}
        open={cmtsOpen}
        onClose={toggleComments}
      />
    </>
  );
}
