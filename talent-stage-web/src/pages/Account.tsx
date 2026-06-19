import { useState, useEffect, useRef } from 'react';
import { useAppStore, DEFAULT_AVATAR } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';
import { resolveProfileAvatarSrc } from '../utils/avatar';
import type { User } from '../types';

interface Strike {
  id: string;
  reason: string;
  strike_type: 'warning' | 'strike' | 'temp_ban' | 'permanent_ban' | 'shadow_ban';
  expires_at: string | null;
  created_at: string;
  is_active: number;
}

interface CreatorOverview30d {
  videos_count: number;
  total_views: number;
  total_unique_views: number;
  unique_viewers_30d: number;
  impressions_30d: number;
  avg_watch_seconds_30d: number;
  completion_rate_30d: number;
  skip_rate_30d: number;
  engagement_rate_30d: number;
  follow_conversion_30d: number;
  save_rate_30d: number;
  share_rate_30d: number;
  like_dislike_ratio: number;
  report_rate_30d: number;
  reports_30d: number;
}

interface CreatorVideoLite {
  likes: number;
  dislikes: number;
}

interface CreatorAnalyticsPayload {
  overview_30d: CreatorOverview30d;
  videos?: CreatorVideoLite[];
}

interface ProfileUserCounts {
  follower_count?: number;
  following_count?: number;
}

interface Props {
  onNav: (page: string) => void;
}

const AVATAR_CROP_STAGE_SIZE = 280;
const AVATAR_CROP_EXPORT_SIZE = 512;

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getAvatarCropBounds(
  naturalWidth: number,
  naturalHeight: number,
  zoom: number,
  stageSize: number,
): { width: number; height: number; maxX: number; maxY: number } | null {
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;
  const safeZoom = Math.max(1, zoom);
  const baseScale = Math.max(stageSize / naturalWidth, stageSize / naturalHeight);
  const scaledWidth = naturalWidth * baseScale * safeZoom;
  const scaledHeight = naturalHeight * baseScale * safeZoom;
  return {
    width: scaledWidth,
    height: scaledHeight,
    maxX: Math.max(0, (scaledWidth - stageSize) / 2),
    maxY: Math.max(0, (scaledHeight - stageSize) / 2),
  };
}

export default function Account({ onNav }: Props) {
  const { user, setUser, logout, setDrawerOpen } = useAppStore();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [pwdModal, setPwdModal] = useState(false);
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [strikes, setStrikes] = useState<Strike[]>([]);
  const [strikesLoading, setStrikesLoading] = useState(false);
  const [creatorAnalytics, setCreatorAnalytics] = useState<CreatorAnalyticsPayload | null>(null);
  const [creatorAnalyticsLoading, setCreatorAnalyticsLoading] = useState(false);
  const [profileStats, setProfileStats] = useState({
    followingCount: 0,
    followerCount: 0,
    likesCount: 0,
    dislikesCount: 0,
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarCropImageRef = useRef<HTMLImageElement>(null);
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [avatarCropSrc, setAvatarCropSrc] = useState('');
  const [avatarCropZoom, setAvatarCropZoom] = useState(1);
  const [avatarCropX, setAvatarCropX] = useState(0);
  const [avatarCropY, setAvatarCropY] = useState(0);
  const [avatarCropNatural, setAvatarCropNatural] = useState({ width: 0, height: 0 });
  const [avatarCropSaving, setAvatarCropSaving] = useState(false);
  const [avatarCropError, setAvatarCropError] = useState('');

  useEffect(() => {
    if (user) {
      setUsername(user.username || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      setWebsite(user.website || '');
    }
  }, [user]);

  useEffect(() => {
    const fetchProfileCounts = async () => {
      if (!user?.id) return;
      const data = await apiFetch<ProfileUserCounts>('/users/' + user.id);
      const profileData = data.data;
      if (!data.success || !profileData) return;
      setProfileStats((prev) => ({
        ...prev,
        followerCount: Number(profileData.follower_count || 0),
        followingCount: Number(profileData.following_count || 0),
      }));
    };

    if (user?.id) {
      void fetchProfileCounts();
    } else {
      setProfileStats({
        followingCount: 0,
        followerCount: 0,
        likesCount: 0,
        dislikesCount: 0,
      });
    }
  }, [user?.id]);

  useEffect(() => {
    const fetchCreatorAnalytics = async () => {
      if (!user?.id) return;
      setCreatorAnalyticsLoading(true);
      const data = await apiFetch<CreatorAnalyticsPayload>('/users/' + user.id + '/creator-analytics');
      setCreatorAnalyticsLoading(false);
      if (!data.success || !data.data) {
        setCreatorAnalytics(null);
        setProfileStats((prev) => ({ ...prev, likesCount: 0, dislikesCount: 0 }));
        return;
      }
      setCreatorAnalytics(data.data);
      const videos = data.data.videos || [];
      const likesCount = videos.reduce((sum, v) => sum + Number(v.likes || 0), 0);
      const dislikesCount = videos.reduce((sum, v) => sum + Number(v.dislikes || 0), 0);
      setProfileStats((prev) => ({ ...prev, likesCount, dislikesCount }));
    };

    if (user?.id) {
      void fetchCreatorAnalytics();
    } else {
      setCreatorAnalytics(null);
      setProfileStats((prev) => ({ ...prev, likesCount: 0, dislikesCount: 0 }));
    }
  }, [user?.id]);

  // Fetch user's strikes on mount
  useEffect(() => {
    const fetchStrikes = async () => {
      setStrikesLoading(true);
      try {
        const data = await apiFetch<{ strikes: Strike[] }>('/videos/me/strikes');
        if (data.success && data.data?.strikes) {
          setStrikes(data.data.strikes);
        }
      } catch (err) {
        console.error('Failed to fetch strikes:', err);
      } finally {
        setStrikesLoading(false);
      }
    };

    if (user) {
      fetchStrikes();
    }
  }, [user]);

  useEffect(() => {
    return () => {
      if (avatarCropSrc.startsWith('blob:')) URL.revokeObjectURL(avatarCropSrc);
    };
  }, [avatarCropSrc]);

  const getAvatarSrc = () => {
    if (!user) return DEFAULT_AVATAR;
    return resolveProfileAvatarSrc(user.id, user.avatar_url);
  };

  const pickAvatar = () => avatarInputRef.current?.click();

  const handleAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) {
      toast('Please select an image file');
      e.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('Image must be 10MB or less');
      e.target.value = '';
      return;
    }
    if (avatarCropSrc.startsWith('blob:')) URL.revokeObjectURL(avatarCropSrc);
    const src = URL.createObjectURL(file);
    setAvatarCropSrc(src);
    setAvatarCropOpen(true);
    setAvatarCropZoom(1);
    setAvatarCropX(0);
    setAvatarCropY(0);
    setAvatarCropNatural({ width: 0, height: 0 });
    setAvatarCropError('');
    setAvatarCropSaving(false);
    e.target.value = '';
  };

  const closeAvatarCrop = () => {
    setAvatarCropOpen(false);
    setAvatarCropSaving(false);
    setAvatarCropError('');
    setAvatarCropZoom(1);
    setAvatarCropX(0);
    setAvatarCropY(0);
    setAvatarCropNatural({ width: 0, height: 0 });
    setAvatarCropSrc('');
  };

  const saveAvatarCrop = async () => {
    if (!user) return;
    const imageEl = avatarCropImageRef.current;
    const bounds = getAvatarCropBounds(avatarCropNatural.width, avatarCropNatural.height, avatarCropZoom, AVATAR_CROP_STAGE_SIZE);
    if (!avatarCropSrc || !imageEl || !bounds) {
      setAvatarCropError('Pick an image first');
      return;
    }
    const clampedX = clampValue(avatarCropX, -bounds.maxX, bounds.maxX);
    const clampedY = clampValue(avatarCropY, -bounds.maxY, bounds.maxY);

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_CROP_EXPORT_SIZE;
    canvas.height = AVATAR_CROP_EXPORT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setAvatarCropError('Image processing unavailable');
      return;
    }

    const ratio = AVATAR_CROP_EXPORT_SIZE / AVATAR_CROP_STAGE_SIZE;
    const drawX = (((AVATAR_CROP_STAGE_SIZE - bounds.width) / 2) + clampedX) * ratio;
    const drawY = (((AVATAR_CROP_STAGE_SIZE - bounds.height) / 2) + clampedY) * ratio;
    const drawWidth = bounds.width * ratio;
    const drawHeight = bounds.height * ratio;
    ctx.clearRect(0, 0, AVATAR_CROP_EXPORT_SIZE, AVATAR_CROP_EXPORT_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageEl, drawX, drawY, drawWidth, drawHeight);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    if (!blob) {
      setAvatarCropError('Failed to process image');
      return;
    }

    setAvatarCropSaving(true);
    setAvatarCropError('');
    const form = new FormData();
    form.append('avatar', blob, `avatar-${user.id}.jpg`);
    const data = await apiFetch<User>('/auth/me/avatar', { method: 'POST', body: form });
    setAvatarCropSaving(false);
    if (!data.success) {
      setAvatarCropError(data.error || 'Could not update photo');
      return;
    }

    const nextUser = data.data || { ...user };
    setUser(nextUser);
    const nextAvatar = nextUser.avatar_url || canvas.toDataURL('image/jpeg', 0.9);
    localStorage.setItem('ts_avatar_' + user.id, nextAvatar);
    closeAvatarCrop();
    toast('Avatar updated!');
  };

  const deleteAvatar = async () => {
    if (!user) return;
    const data = await apiFetch<User>('/auth/me/avatar', { method: 'DELETE' });
    if (!data.success) {
      toast('Error: ' + (data.error || 'Could not remove photo'));
      return;
    }

    localStorage.removeItem('ts_avatar_' + user.id);
    if (data.data) setUser(data.data);
    else setUser({ ...user, avatar_url: null });
    toast('Photo removed');
  };

  const saveProfile = async () => {
    if (!user) return;
    const uname = username.trim().toLowerCase();
    const mail = email.trim().toLowerCase();
    const site = website.trim();

    if (!uname) { toast('Username cannot be empty'); return; }
    if (!mail) { toast('Email cannot be empty'); return; }
    if (site.length > 500) { toast('Website link is too long (max 500 chars)'); return; }

    const data = await apiFetch<User>('/auth/me', {
      method: 'PUT',
      body: JSON.stringify({
        full_name: user.full_name || '',
        username: uname,
        email: mail,
        phone: phone || null,
        website: site || null,
        bio: user.bio || null,
        talent_type: user.talent_type || 'Viewer',
      }),
    });

    if (!data.success || !data.data) {
      if (data.error) {
        toast('Error: ' + data.error);
      }
      return;
    }

    setUser(data.data);
    setUsername(data.data.username || '');
    setEmail(data.data.email || '');
    setPhone(data.data.phone || '');
    setWebsite(data.data.website || '');
    toast('Profile updated!');
  };

  const doLogout = () => {
    logout();
    toast('Logged out');
    onNav('home');
  };

  const delAcct = async () => {
    if (!confirm('Delete your account? This cannot be undone.')) return;
    await apiFetch('/auth/me', { method: 'DELETE' });
    logout();
    toast('Account deleted');
    onNav('home');
  };

  const changePassword = async () => {
    if (!curPwd || !newPwd || !confirmPwd) { toast('Please fill all fields'); return; }
    if (newPwd.length < 8) { toast('Min 8 characters'); return; }
    if (newPwd !== confirmPwd) { toast('Passwords do not match'); return; }
    const data = await apiFetch('/auth/me/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password: curPwd, new_password: newPwd }),
    });
    if (!data.success) { toast('Error: ' + data.error); return; }
    setPwdModal(false);
    toast('Password updated!');
  };

  const formatStrikeType = (type: string) => {
    const types: Record<string, { label: string; color: string; icon: string }> = {
      'warning': { label: '⚠️ Warning', color: '#ffa500', icon: '⚠️' },
      'strike': { label: '❌ Strike', color: '#ff6b6b', icon: '❌' },
      'temp_ban': { label: '🚫 Temporary Ban', color: '#ff4444', icon: '🚫' },
      'permanent_ban': { label: '🔒 Permanent Ban', color: '#cc0000', icon: '🔒' },
      'shadow_ban': { label: '👁️ Shadow Ban', color: '#ff9999', icon: '👁️' },
    };
    return types[type] || { label: type, color: '#999', icon: '•' };
  };

  const formatExpiryDate = (expiresAt: string | null) => {
    if (!expiresAt) return 'Permanent';
    const date = new Date(expiresAt);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const avatarSrc = getAvatarSrc();
  const isRealAvatar = avatarSrc !== DEFAULT_AVATAR;
  const activeStrikes = strikes.filter((s) => (s.is_active ?? 1) && !isExpired(s.expires_at));
  const fmt = (n: number) => new Intl.NumberFormat().format(Number(n || 0));
  const pct = (n: number) => `${(Number(n || 0) * 100).toFixed(1)}%`;
  const sec = (n: number) => `${Number(n || 0).toFixed(2)}s`;
  const ca = creatorAnalytics?.overview_30d || null;
  const cropBounds = getAvatarCropBounds(
    avatarCropNatural.width,
    avatarCropNatural.height,
    avatarCropZoom,
    AVATAR_CROP_STAGE_SIZE,
  );
  const cropMaxX = cropBounds?.maxX ?? 0;
  const cropMaxY = cropBounds?.maxY ?? 0;
  const cropX = clampValue(avatarCropX, -cropMaxX, cropMaxX);
  const cropY = clampValue(avatarCropY, -cropMaxY, cropMaxY);
  const cropImageWidth = cropBounds?.width ?? AVATAR_CROP_STAGE_SIZE;
  const cropImageHeight = cropBounds?.height ?? AVATAR_CROP_STAGE_SIZE;
  const cropImageLeft = ((AVATAR_CROP_STAGE_SIZE - cropImageWidth) / 2) + cropX;
  const cropImageTop = ((AVATAR_CROP_STAGE_SIZE - cropImageHeight) / 2) + cropY;

  return (
    <div className="acct-body" style={{ alignItems: 'center', textAlign: 'center' }}>
      <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />

      {/* Top menu */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', maxWidth: 500, padding: '12px 16px 0', flexShrink: 0 }}>
        <div className="amenu" onClick={() => setDrawerOpen(true)}><span /><span /><span /></div>
      </div>

      {/* Avatar + name */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 20px 24px', width: '100%', maxWidth: 500, borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0, marginBottom: 14 }}>
          <div className="abigav">
            <img src={avatarSrc} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
              onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }} alt="" />
          </div>
          <button type="button" onClick={pickAvatar}
            style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: '50%', background: 'var(--acc)', border: '2px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, cursor: 'pointer' }}>
            &#9999;&#65039;
          </button>
          {isRealAvatar && (
            <button type="button" onClick={deleteAvatar}
              style={{ position: 'absolute', bottom: 0, left: 0, width: 26, height: 26, borderRadius: '50%', background: '#e53935', border: '2px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, cursor: 'pointer', color: '#fff', fontWeight: 'bold' }}>
              &#10005;
            </button>
          )}
        </div>
        <div style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{user?.full_name || user?.username || '-'}</div>
        <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 14 }}>@{user?.username || '-'}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8, color: 'rgba(255,255,255,.82)', fontSize: 12, fontWeight: 600, marginTop: 6 }}>
          <span>Following {fmt(profileStats.followingCount)}</span>
          <span style={{ opacity: 0.55 }}>•</span>
          <span>Followers {fmt(profileStats.followerCount)}</span>
          <span style={{ opacity: 0.55 }}>•</span>
          <span>Likes {fmt(profileStats.likesCount)}</span>
          <span style={{ opacity: 0.55 }}>•</span>
          <span>Dislikes {fmt(profileStats.dislikesCount)}</span>
        </div>
      </div>

      {/* Edit fields */}
      <div style={{ width: '100%', maxWidth: 500, padding: '20px 24px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.3)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 14 }}>Edit Profile</div>

        <div style={{ marginBottom: 10, textAlign: 'left' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Full name</div>
          <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: '11px 14px', color: 'rgba(255,255,255,.5)', fontSize: 15, textAlign: 'center' }}>
            {user?.full_name || '-'}
          </div>
        </div>

        <div style={{ marginBottom: 20, textAlign: 'left' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Username</div>
          <input type="text" placeholder="@username..." value={username} onChange={(e) => setUsername(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '11px 14px', color: 'rgba(255,255,255,.7)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box', textAlign: 'center' }} />
        </div>
      </div>

      {/* Account details */}
      <div style={{ width: '100%', maxWidth: 500, padding: '0 24px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.3)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12, textAlign: 'left' }}>Account Details</div>

        <div style={{ padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Email</div>
          <input type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '11px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box', textAlign: 'center' }} />
        </div>

        <div style={{ padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Phone</div>
          <input type="tel" placeholder="e.g. +44 7911 123456" value={phone} onChange={(e) => setPhone(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '11px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box', textAlign: 'center' }} />
        </div>

        <div style={{ padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Website</div>
          <input type="url" placeholder="https://your-site.com" value={website} onChange={(e) => setWebsite(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '11px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box', textAlign: 'center' }} />
        </div>
      </div>

      {/* Save button */}
      <div style={{ width: '100%', maxWidth: 500, padding: '16px 24px 4px' }}>
        <button className="profile-save-btn" onClick={saveProfile}
          style={{ width: '100%', background: 'var(--acc)', border: 'none', borderRadius: 12, color: '#fff', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, padding: 14, cursor: 'pointer' }}>Save</button>
      </div>

      {/* Creator analytics (profile quick view) */}
      <div style={{ width: '100%', maxWidth: 500, padding: '16px 24px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.3)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12, textAlign: 'left' }}>
          My Creator Analytics
        </div>

        {creatorAnalyticsLoading && (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', padding: 12, textAlign: 'left' }}>Loading analytics...</div>
        )}

        {!creatorAnalyticsLoading && !ca && (
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 14, fontSize: 12, color: 'rgba(255,255,255,.55)', textAlign: 'left' }}>
            Analytics unavailable right now.
          </div>
        )}

        {!creatorAnalyticsLoading && ca && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 10, textAlign: 'left' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 5 }}>Videos</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{fmt(ca.videos_count)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 10, textAlign: 'left' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 5 }}>Impressions (30d)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{fmt(ca.impressions_30d)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 10, textAlign: 'left' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 5 }}>Unique Viewers (30d)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{fmt(ca.unique_viewers_30d)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 10, textAlign: 'left' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 5 }}>Avg Watch (30d)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{sec(ca.avg_watch_seconds_30d)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 10, textAlign: 'left' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 5 }}>Completion</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{pct(ca.completion_rate_30d)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 10, textAlign: 'left' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 5 }}>Skip</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#ff6b6b' }}>{pct(ca.skip_rate_30d)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 10, textAlign: 'left' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 5 }}>Engagement</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{pct(ca.engagement_rate_30d)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 10, textAlign: 'left' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 5 }}>Follow Conversion</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{pct(ca.follow_conversion_30d)}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNav('video-analytics')}
              style={{
                width: '100%',
                border: '1px solid rgba(255,255,255,.15)',
                background: 'rgba(255,255,255,.06)',
                borderRadius: 12,
                padding: '12px 14px',
                color: '#fff',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 700,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              Open full video analytics
            </button>
          </div>
        )}
      </div>

      {/* My Strikes Section */}
      {strikes.length > 0 && (
        <div style={{ width: '100%', maxWidth: 500, padding: '16px 24px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.3)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12, textAlign: 'left' }}>My Account Status</div>

          {activeStrikes.length > 0 ? (
            <div style={{ background: 'rgba(255,100,100,.08)', border: '1px solid rgba(255,100,100,.2)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ff6b6b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                ⚠️ You have active strikes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeStrikes.map((strike) => {
                  const strikeInfo = formatStrikeType(strike.strike_type);
                  return (
                    <div key={strike.id} style={{ background: 'rgba(0,0,0,.3)', borderRadius: 8, padding: 12, borderLeft: `3px solid ${strikeInfo.color}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: strikeInfo.color }}>
                          {strikeInfo.label}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
                          {strike.expires_at ? `Expires: ${formatExpiryDate(strike.expires_at)}` : 'Permanent'}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', lineHeight: 1.4 }}>
                        {strike.reason || 'No reason provided'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginTop: 12, lineHeight: 1.5 }}>
                Accumulating strikes may result in temporary or permanent suspension. If you believe this is in error, please contact support.
              </div>
            </div>
          ) : strikesLoading ? (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', padding: 12 }}>Loading...</div>
          ) : (
            <div style={{ background: 'rgba(100,255,100,.08)', border: '1px solid rgba(100,255,100,.2)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#4caf50', display: 'flex', alignItems: 'center', gap: 8 }}>
                ✓ You're in good standing
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 8 }}>
                No active strikes on your account.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Danger zone */}
      <div style={{ width: '100%', maxWidth: 500, padding: '12px 24px 8px', marginTop: 'auto' }}>
        <div onClick={() => { setCurPwd(''); setNewPwd(''); setConfirmPwd(''); setPwdModal(true); }}
          style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,.7)', cursor: 'pointer', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <img
            src="/icons/profile-change-password.png"
            alt="Change password"
            style={{ width: 18, height: 18, objectFit: 'contain' }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const fb = (e.currentTarget.nextElementSibling as HTMLElement | null);
              if (fb) fb.style.display = 'inline';
            }}
          />
          <span style={{ display: 'none' }} aria-hidden>&#128274;</span>
          <span>Change Password</span>
        </div>
        <div onClick={doLogout}
          style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,100,100,.85)', cursor: 'pointer', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <img
            src="/icons/profile-logout.png"
            alt="Log out"
            style={{ width: 18, height: 18, objectFit: 'contain' }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const fb = (e.currentTarget.nextElementSibling as HTMLElement | null);
              if (fb) fb.style.display = 'inline';
            }}
          />
          <span style={{ display: 'none' }} aria-hidden>&#128682;</span>
          <span>Log out</span>
        </div>
        <div onClick={delAcct}
          style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,50,50,.6)', cursor: 'pointer', padding: '13px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <img
            src="/icons/bin.png"
            alt="Delete account"
            style={{ width: 18, height: 18, objectFit: 'contain' }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          <span>Delete Account</span>
        </div>
      </div>

      {/* Avatar crop modal */}
      {avatarCropOpen && (
        <div style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20, padding: '24px 20px', width: '100%', maxWidth: 420 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 14 }}>Crop Profile Photo</div>

            <div style={{ width: AVATAR_CROP_STAGE_SIZE, height: AVATAR_CROP_STAGE_SIZE, margin: '0 auto 14px', borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#0b0b0b', border: '1px solid rgba(255,255,255,.15)' }}>
              {avatarCropSrc ? (
                <img
                  ref={avatarCropImageRef}
                  src={avatarCropSrc}
                  alt="Avatar crop"
                  style={{
                    position: 'absolute',
                    width: `${cropImageWidth}px`,
                    height: `${cropImageHeight}px`,
                    left: `${cropImageLeft}px`,
                    top: `${cropImageTop}px`,
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    setAvatarCropNatural({ width: el.naturalWidth || 0, height: el.naturalHeight || 0 });
                  }}
                />
              ) : null}
              <div style={{ position: 'absolute', inset: 0, border: '2px solid rgba(255,255,255,.42)', borderRadius: 14, pointerEvents: 'none' }} />
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 5 }}>Zoom ({avatarCropZoom.toFixed(2)}x)</div>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={avatarCropZoom}
                onChange={(e) => setAvatarCropZoom(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 5 }}>Horizontal</div>
              <input
                type="range"
                min={-cropMaxX}
                max={cropMaxX}
                step={1}
                value={cropX}
                disabled={cropMaxX <= 0}
                onChange={(e) => setAvatarCropX(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 5 }}>Vertical</div>
              <input
                type="range"
                min={-cropMaxY}
                max={cropMaxY}
                step={1}
                value={cropY}
                disabled={cropMaxY <= 0}
                onChange={(e) => setAvatarCropY(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            {!!avatarCropError && (
              <div style={{ fontSize: 12, color: '#ff6b6b', marginBottom: 10, textAlign: 'center' }}>{avatarCropError}</div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={closeAvatarCrop}
                style={{ flex: 1, padding: 13, borderRadius: 12, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.65)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAvatarCrop}
                disabled={avatarCropSaving}
                style={{ flex: 2, padding: 13, borderRadius: 12, border: 'none', background: 'var(--acc)', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: avatarCropSaving ? 'default' : 'pointer', opacity: avatarCropSaving ? 0.7 : 1 }}
              >
                {avatarCropSaving ? 'Saving...' : 'Save Photo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change password modal */}
      {pwdModal && (
        <div style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 400 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 20 }}>Change Password</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Current password</div>
              <input type="password" placeholder="Enter current password..." value={curPwd} onChange={(e) => setCurPwd(e.target.value)}
                style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>New password</div>
              <input type="password" placeholder="Min. 8 characters..." value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Confirm new password</div>
              <input type="password" placeholder="Repeat new password..." value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
                style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPwdModal(false)}
                style={{ flex: 1, padding: 13, borderRadius: 12, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.6)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={changePassword}
                style={{ flex: 2, padding: 13, borderRadius: 12, border: 'none', background: 'var(--acc)', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Update Password</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
