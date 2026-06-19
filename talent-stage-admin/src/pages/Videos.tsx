import { useState, useEffect, useRef, useCallback } from 'react';
import { useApi, toMediaUrl } from '../hooks/useApi';
import { toast } from '../hooks/useToast';
import { fmt, fmtDate } from '../utils/format';
import Pagination from '../components/Pagination';
import { confirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';

const TALENT_TYPES = [
  'Singer',
  'Musician',
  'Dancer',
  'Rapper',
  'Comedian',
  'Magician',
  'Actor',
  'Acrobat',
  'Martial Artist',
  'Athlete',
  'Variety',
  'Visual Artist',
  'Impressionist',
  'Ventriloquist',
  'Unique Talent',
];

interface Video {
  id: string;
  title: string;
  talent_type: string | null;
  views: number;
  unique_views: number;
  likes: number;
  dislikes: number;
  is_public: number | boolean;
  file_size: number | null;
  thumbnail_url: string | null;
  file_url: string | null;
  created_at: string;
  user_id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
}

interface PaginationData {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const TITLE_TRUNCATE = 30;

export default function Videos() {
  const api = useApi();
  const { admin } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [talentType, setTalentType] = useState('');
  const [visibility, setVisibility] = useState('');
  const [expandedTitles, setExpandedTitles] = useState<Set<string>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  const fetchVideos = useCallback(async (page: number, searchVal?: string) => {
    setLoading(true);
    setErrorMsg('');
    const s = searchVal !== undefined ? searchVal : searchRef.current;
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '20');
    if (s) params.set('search', s);
    if (talentType) params.set('talent_type', talentType);
    if (visibility) params.set('visibility', visibility);

    const r = await api<any>('GET', `/videos?${params.toString()}`);
    if (!r.success || !r.data) {
      setVideos([]);
      setPagination({ total: 0, page: 1, limit: 20, totalPages: 0 });
      setErrorMsg(r.error || 'Failed to load');
      setLoading(false);
      return;
    }

    setVideos(r.data.items || []);
    setSelectedVideoIds(new Set());
    setPagination({
      total: r.data.total,
      page: r.data.page,
      limit: r.data.limit,
      totalPages: r.data.totalPages,
    });
    setLoading(false);
  }, [api, talentType, visibility]);

  /* initial load + filter changes */
  useEffect(() => {
    fetchVideos(1);
  }, [talentType, visibility]);

  /* debounced search */
  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchVideos(1, val);
    }, 400);
  };

  /* page change */
  const handlePage = (p: number) => {
    fetchVideos(p);
  };

  /* toggle visibility inline */
  const toggleVisibility = async (video: Video) => {
    const r = await api<{ is_public: boolean }>('PUT', `/videos/${video.id}/visibility`);
    if (r.success && r.data !== undefined) {
      setVideos((prev) =>
        prev.map((v) =>
          v.id === video.id ? { ...v, is_public: r.data!.is_public ? 1 : 0 } : v
        )
      );
      toast(r.data.is_public ? 'Video set to public' : 'Video hidden', 'success');
    } else {
      toast(r.error || 'Failed to toggle visibility', 'error');
    }
  };

  /* delete video */
  const deleteVideo = (video: Video) => {
    confirmDialog(
      'Delete Video',
      'This will permanently remove the video and all its data.',
      async () => {
        const r = await api('DELETE', `/videos/${video.id}`);
        if (r.success) {
          setVideos((prev) => prev.filter((v) => v.id !== video.id));
          toast('Video deleted', 'success');
        } else {
          toast(r.error || 'Failed to delete video', 'error');
        }
      }
    );
  };

  /* toggle title expand */
  const toggleTitle = (id: string) => {
    setExpandedTitles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isPublic = (v: Video) => Boolean(v.is_public);
  const canDelete = admin?.role !== 'support';
  const allVisibleSelected = videos.length > 0 && videos.every((v) => selectedVideoIds.has(v.id));

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = selectedVideoIds.size > 0 && !allVisibleSelected;
  }, [selectedVideoIds, allVisibleSelected]);

  const toggleVideoSelection = (videoId: string) => {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedVideoIds((prev) => {
      if (allVisibleSelected) return new Set();
      const next = new Set(prev);
      videos.forEach((v) => next.add(v.id));
      return next;
    });
  };

  const deleteSelectedVideos = () => {
    if (!selectedVideoIds.size) return;
    const selected = videos.filter((v) => selectedVideoIds.has(v.id));
    if (!selected.length) return;

    confirmDialog(
      'Delete Selected Videos',
      `This will permanently remove ${selected.length} selected videos.`,
      async () => {
        let deletedCount = 0;
        const deletedIds = new Set<string>();
        const failedTitles: string[] = [];

        for (const video of selected) {
          // eslint-disable-next-line no-await-in-loop
          const r = await api('DELETE', `/videos/${video.id}`);
          if (r.success) {
            deletedCount += 1;
            deletedIds.add(video.id);
          } else {
            failedTitles.push(video.title || video.id);
          }
        }

        if (deletedCount > 0) {
          setVideos((prev) => prev.filter((v) => !deletedIds.has(v.id)));
          setSelectedVideoIds((prev) => {
            const next = new Set(prev);
            deletedIds.forEach((id) => next.delete(id));
            return next;
          });
          toast(`Deleted ${deletedCount} video${deletedCount === 1 ? '' : 's'}`, 'success');
        }

        if (failedTitles.length > 0) {
          toast(`Failed to delete ${failedTitles.length} video${failedTitles.length === 1 ? '' : 's'}`, 'error');
        }
      }
    );
  };

  const renderTitle = (video: Video) => {
    const raw = String(video.title || 'Untitled');
    const expanded = expandedTitles.has(video.id);
    if (raw.length <= TITLE_TRUNCATE) return raw;

    return (
      <span className="v-title-expand">
        {!expanded && <span>{raw.slice(0, TITLE_TRUNCATE)}</span>}
        {expanded && <span>{raw}</span>}
        <button
          type="button"
          className="v-title-toggle"
          onClick={() => toggleTitle(video.id)}
        >
          {expanded ? '...less' : '...more'}
        </button>
      </span>
    );
  };

  return (
    <div className="videos-page">
      <div className="page-header">
        <h1>Video Moderation</h1>
        <p>Review, hide or delete videos on the platform</p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <span>&#x1F50D;</span>
          <input
            type="text"
            placeholder="Search by title or uploader..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={talentType}
          onChange={(e) => setTalentType(e.target.value)}
        >
          <option value="">All categories</option>
          {TALENT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="">All visibility</option>
          <option value="public">Public</option>
          <option value="hidden">Hidden</option>
        </select>
        {canDelete && (
          <div className="videos-bulk-actions">
            <span className="videos-bulk-count">
              {selectedVideoIds.size} selected
            </span>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={deleteSelectedVideos}
              disabled={selectedVideoIds.size === 0}
            >
              Delete Selected
            </button>
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="bulk-col">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  aria-label="Select all videos on page"
                />
              </th>
              <th>Video</th>
              <th>Category</th>
              <th>Views</th>
              <th>Unique</th>
              <th>Likes</th>
              <th>Dislikes</th>
              <th>Status</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="loading-row"><div className="spinner" /></td>
              </tr>
            )}
            {!loading && !!errorMsg && (
              <tr>
                <td colSpan={10} className="empty-row">Failed to load</td>
              </tr>
            )}
            {!loading && !errorMsg && videos.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-row">No videos found</td>
              </tr>
            )}
            {!loading && !errorMsg && videos.map((v) => (
              <tr key={v.id}>
                <td className="bulk-col">
                  <input
                    type="checkbox"
                    checked={selectedVideoIds.has(v.id)}
                    onChange={() => toggleVideoSelection(v.id)}
                    aria-label={`Select video ${v.title || v.id}`}
                  />
                </td>
                <td>
                  <div className="thumb-cell">
                    {v.thumbnail_url ? (
                      <img
                        src={toMediaUrl(v.thumbnail_url)}
                        alt=""
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : null}
                    <div>
                      <div className="name">{renderTitle(v)}</div>
                      <div className="sub">@{v.username}</div>
                    </div>
                  </div>
                </td>
                <td><span className="badge badge-purple">{v.talent_type || '-'}</span></td>
                <td>{fmt(v.views)}</td>
                <td style={{ color: 'var(--blue)' }}>{fmt(v.unique_views)}</td>
                <td style={{ color: 'var(--green)' }}>{fmt(v.likes)}</td>
                <td style={{ color: 'var(--red)' }}>{fmt(v.dislikes)}</td>
                <td>
                  <span className={`badge ${isPublic(v) ? 'badge-green' : 'badge-yellow'}`}>
                    {isPublic(v) ? 'Public' : 'Hidden'}
                  </span>
                </td>
                <td>{fmtDate(v.created_at)}</td>
                <td>
                  <div className="actions actions-nowrap">
                    {v.file_url && (
                      <a
                        className="btn btn-ghost btn-sm"
                        href={toMediaUrl(v.file_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open video
                      </a>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => toggleVisibility(v)}
                    >
                      {isPublic(v) ? 'Hide' : 'Show'}
                    </button>
                    {canDelete && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => deleteVideo(v)}
                      >
                        Delete
                      </button>
                    )}
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
