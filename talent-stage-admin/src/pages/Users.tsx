import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useApi, toMediaUrl } from '../hooks/useApi';
import { toast } from '../hooks/useToast';
import { fmt, fmtDate } from '../utils/format';
import Pagination from '../components/Pagination';
import { confirmDialog } from '../components/ConfirmDialog';
import DeleteUserTransferModal from '../components/DeleteUserTransferModal';
import { useAuth } from '../context/AuthContext';

export interface StrikeModalProps {
  open: boolean;
  userId: string | number | null;
  userName?: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export function StrikeModal({ open, userId, userName, onClose, onSubmitted }: StrikeModalProps) {
  const api = useApi();
  const [reason, setReason] = useState('');
  const [strikeType, setStrikeType] = useState('strike');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setStrikeType('strike');
    setExpiresAt('');
  }, [open]);

  const handleSubmit = async () => {
    if (!userId) return;
    if (!reason.trim()) {
      toast('Reason is required', 'error');
      return;
    }

    setSubmitting(true);
    const r = await api('POST', `/users/${userId}/strikes`, {
      reason: reason.trim(),
      strike_type: strikeType,
      expires_at: expiresAt || null,
    });
    setSubmitting(false);

    if (!r.success) {
      toast(r.error || 'Failed to add strike', 'error');
      return;
    }

    toast('Strike added');
    onClose();
    onSubmitted();
  };

  if (!open) return null;

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add Strike{userName ? ` - ${userName}` : ''}</h2>

        <div className="form-row">
          <label>Strike Type</label>
          <select value={strikeType} onChange={(e) => setStrikeType(e.target.value)}>
            <option value="strike">Strike</option>
            <option value="warning">Warning</option>
            <option value="temp_ban">Temporary Ban</option>
            <option value="permanent_ban">Permanent Ban</option>
            <option value="shadow_ban">Shadow Ban</option>
          </select>
        </div>

        <div className="form-row">
          <label>Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason is required"
          />
        </div>

        <div className="form-row">
          <label>Expires At (Optional)</label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving...' : 'Add Strike'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface User {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  talent_type: string | null;
  is_active: number | boolean;
  shadow_banned: number | boolean;
  strike_count: number;
  video_count: number;
  follower_count: number;
  created_at: string;
}

interface PaginationData {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function Users() {
  const api = useApi();
  const { admin } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');

  const [strikeModal, setStrikeModal] = useState<{ open: boolean; userId: string | null; userName: string }>({
    open: false,
    userId: null,
    userName: '',
  });
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; userId: string | null; userName: string }>({
    open: false,
    userId: null,
    userName: '',
  });
  const canDelete = admin?.role !== 'support';

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(1);
  const searchRef = useRef(search);
  searchRef.current = search;

  const fetchUsers = useCallback(async (page: number, searchVal?: string) => {
    setLoading(true);
    setErrorMsg('');

    const s = (searchVal !== undefined ? searchVal : searchRef.current).trim();
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '20');
    if (s) params.set('search', s);
    if (role) params.set('role', role);
    if (status) params.set('status', status);

    const r = await api<any>('GET', `/users?${params.toString()}`);
    if (!r.success || !r.data) {
      setUsers([]);
      setPagination({ total: 0, page: 1, limit: 20, totalPages: 0 });
      setErrorMsg(r.error || 'Failed to load');
      setLoading(false);
      return;
    }

    setUsers(r.data.items || []);
    setPagination({
      total: Number(r.data.total || 0),
      page: Number(r.data.page || page),
      limit: Number(r.data.limit || 20),
      totalPages: Number(r.data.totalPages || 0),
    });
    setLoading(false);
  }, [api, role, status]);

  useEffect(() => {
    pageRef.current = 1;
    void fetchUsers(1);
  }, [fetchUsers]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pageRef.current = 1;
      void fetchUsers(1, val);
    }, 400);
  };

  const handlePage = (p: number) => {
    pageRef.current = p;
    void fetchUsers(p);
  };

  const reload = () => {
    void fetchUsers(pageRef.current);
  };

  const handleBan = (user: User) => {
    confirmDialog('Ban User', 'This user will no longer be able to log in.', async () => {
      const r = await api('PUT', `/users/${user.id}/ban`);
      if (!r.success) { toast(r.error || 'Failed to ban user', 'error'); return; }
      toast('User banned');
      reload();
    });
  };

  const handleUnban = async (user: User) => {
    const r = await api('PUT', `/users/${user.id}/unban`);
    if (!r.success) { toast(r.error || 'Failed to unban user', 'error'); return; }
    toast('User unbanned');
    reload();
  };

  const handleShadowBan = async (user: User) => {
    const r = await api<{ shadow_banned: boolean }>('PUT', `/users/${user.id}/shadow-ban`);
    if (!r.success) { toast(r.error || 'Failed to toggle shadow ban', 'error'); return; }
    toast(r.data?.shadow_banned ? 'User shadow banned' : 'Shadow ban removed');
    reload();
  };

  const handleDelete = (user: User) => {
    setDeleteModal({
      open: true,
      userId: user.id,
      userName: user.username,
    });
  };

  const openStrikeModal = (user: User) => {
    setStrikeModal({ open: true, userId: user.id, userName: user.username });
  };

  return (
    <div className="users-page">
      <div className="page-header">
        <h1>User Management</h1>
        <p>Ban, shadow-ban, add strikes or remove accounts</p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <span>&#x1F50D;</span>
          <input
            type="text"
            placeholder="Search by username, email or name..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <select className="filter-select" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All categories</option>
          <option value="creator">Creators</option>
          <option value="viewer">Viewers</option>
        </select>
        <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All users</option>
          <option value="active">Active</option>
          <option value="banned">Banned</option>
          <option value="shadow">Shadow Banned</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>User ID</th>
              <th>Category</th>
              <th>Videos</th>
              <th>Followers</th>
              <th>Strikes</th>
              <th>Status</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="loading-row"><div className="spinner" /></td>
              </tr>
            )}
            {!loading && !!errorMsg && (
              <tr>
                <td colSpan={9} className="empty-row">Failed to load</td>
              </tr>
            )}
            {!loading && !errorMsg && users.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-row">No users found</td>
              </tr>
            )}
            {!loading && !errorMsg && users.map((u) => {
              const isActive = Boolean(u.is_active);
              const shadowBanned = Boolean(u.shadow_banned);
              return (
                <tr key={u.id}>
                  <td>
                    <div className="av-cell">
                      {u.avatar_url ? (
                        <img
                          src={toMediaUrl(u.avatar_url)}
                          alt=""
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="av-ph">{(u.full_name || u.username || '?').charAt(0).toUpperCase()}</div>
                      )}
                      <div>
                        <div className="name">{u.username}</div>
                        <div className="sub">{u.email || ''}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ maxWidth: 190, wordBreak: 'break-all' }}>
                    <Link to={`/users/${encodeURIComponent(u.id)}`} className="profile-id-link">{u.id}</Link>
                  </td>
                  <td>
                    <span className={`badge ${Number(u.video_count) > 0 ? 'badge-green' : 'badge-blue'}`}>
                      {Number(u.video_count) > 0 ? 'Creator' : 'Viewer'}
                    </span>
                  </td>
                  <td>{fmt(u.video_count)}</td>
                  <td>{fmt(u.follower_count)}</td>
                  <td>
                    <span style={{ color: u.strike_count > 0 ? 'var(--red)' : 'var(--muted)', fontWeight: 700 }}>
                      {fmt(u.strike_count)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${isActive ? 'badge-green' : 'badge-red'}`}>
                      {isActive ? 'Active' : 'Banned'}
                    </span>
                    {shadowBanned && <span className="badge badge-orange" style={{ marginLeft: 4 }}>Shadow</span>}
                  </td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td>
                    <div className="actions">
                      {isActive ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleBan(u)}>Ban</button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleUnban(u)}>Unban</button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => handleShadowBan(u)} title="Toggle shadow ban">
                        &#x1F441;
                      </button>
                      <button className="btn btn-warn btn-sm" onClick={() => openStrikeModal(u)}>Strike</button>
                      {canDelete && (
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u)}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination data={pagination} onPage={handlePage} />
      </div>

      <StrikeModal
        open={strikeModal.open}
        userId={strikeModal.userId}
        userName={strikeModal.userName}
        onClose={() => setStrikeModal({ open: false, userId: null, userName: '' })}
        onSubmitted={reload}
      />

      <DeleteUserTransferModal
        open={deleteModal.open}
        sourceUserId={deleteModal.userId}
        sourceUsername={deleteModal.userName}
        onClose={() => setDeleteModal({ open: false, userId: null, userName: '' })}
        onDeleted={() => {
          toast('User deleted');
          reload();
        }}
      />
    </div>
  );
}
