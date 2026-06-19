import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi, toMediaUrl } from '../hooks/useApi';
import { toast } from '../hooks/useToast';

type AssigneeUser = {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  video_count: number;
};

interface DeleteUserTransferModalProps {
  open: boolean;
  sourceUserId: string | null;
  sourceUsername: string;
  onClose: () => void;
  onDeleted: () => void;
}

const CANDIDATE_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export default function DeleteUserTransferModal({
  open,
  sourceUserId,
  sourceUsername,
  onClose,
  onDeleted,
}: DeleteUserTransferModalProps) {
  const api = useApi();
  const [searchText, setSearchText] = useState('');
  const [candidateUsers, setCandidateUsers] = useState<AssigneeUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<AssigneeUser | null>(null);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestCounterRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setSearchText('');
      setCandidateUsers([]);
      setSelectedUser(null);
      setIsLoadingUsers(false);
      setLoadError('');
      setIsSubmitting(false);
      return;
    }

    setSearchText('');
    setCandidateUsers([]);
    setSelectedUser(null);
    setLoadError('');
    setIsSubmitting(false);
  }, [open, sourceUserId]);

  useEffect(() => {
    if (!open || !sourceUserId) return;

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    searchTimerRef.current = setTimeout(() => {
      const requestId = ++requestCounterRef.current;
      const loadCandidates = async () => {
        setIsLoadingUsers(true);
        setLoadError('');

        const params = new URLSearchParams();
        params.set('page', '1');
        params.set('limit', String(CANDIDATE_LIMIT));

        const trimmedSearch = searchText.trim();
        if (trimmedSearch) params.set('search', trimmedSearch);

        const result = await api<any>('GET', `/users?${params.toString()}`);
        if (requestId !== requestCounterRef.current) return;

        if (!result.success || !result.data) {
          setCandidateUsers([]);
          setLoadError(result.error || 'Failed to load users');
          setIsLoadingUsers(false);
          return;
        }

        const filteredUsers: AssigneeUser[] = (result.data.items || [])
          .filter((user: AssigneeUser) => String(user.id) !== String(sourceUserId))
          .map((user: AssigneeUser) => ({
            ...user,
            video_count: Number(user.video_count || 0),
          }));

        setCandidateUsers(filteredUsers);
        setIsLoadingUsers(false);
      };

      void loadCandidates();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [api, open, searchText, sourceUserId]);

  const selectedUserLabel = useMemo(() => {
    if (!selectedUser) return '';
    const labelParts = [`@${selectedUser.username}`];
    if (selectedUser.full_name) labelParts.push(selectedUser.full_name);
    return labelParts.join(' • ');
  }, [selectedUser]);

  const handleDeleteUser = async () => {
    if (!sourceUserId) return;
    if (!selectedUser) {
      toast('Pick a user to receive the videos first', 'error');
      return;
    }
    if (String(selectedUser.id) === String(sourceUserId)) {
      toast('You cannot assign videos back to the same user', 'error');
      return;
    }

    setIsSubmitting(true);
    const response = await api('DELETE', `/users/${sourceUserId}`, {
      reassign_to_user_id: selectedUser.id,
    });
    setIsSubmitting(false);

    if (!response.success) {
      toast(response.error || 'Failed to delete user', 'error');
      return;
    }

    onDeleted();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640, width: 'min(640px, calc(100vw - 32px))' }} onClick={(e) => e.stopPropagation()}>
        <h2>Delete User and Keep Videos</h2>

        <div className="form-row">
          <label>Source user</label>
          <input value={`@${sourceUsername}`} readOnly />
        </div>

        <div className="form-row">
          <label>Transfer videos to</label>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search user by username, email or name..."
          />
        </div>

        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--input-bg)',
            maxHeight: 280,
            overflowY: 'auto',
            padding: 8,
          }}
        >
          {isLoadingUsers ? (
            <div style={{ padding: 12, color: 'var(--muted)', fontSize: 14 }}>Loading users...</div>
          ) : loadError ? (
            <div style={{ padding: 12, color: '#ef4444', fontSize: 14 }}>{loadError}</div>
          ) : candidateUsers.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--muted)', fontSize: 14 }}>
              No users found. Search by username or email to pick the target account.
            </div>
          ) : (
            candidateUsers.map((user) => {
              const isSelected = String(selectedUser?.id || '') === String(user.id);
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUser(user)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    marginBottom: 8,
                    borderRadius: 10,
                    border: isSelected ? '1px solid var(--acc)' : '1px solid var(--border)',
                    background: isSelected ? 'rgba(123, 63, 228, 0.12)' : 'transparent',
                    color: 'var(--text)',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {user.avatar_url ? (
                    <img
                      src={toMediaUrl(user.avatar_url)}
                      alt=""
                      style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'rgba(123,63,228,0.15)',
                        color: '#7b3fe4',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        fontWeight: 700,
                      }}
                    >
                      {(user.full_name || user.username || '?').charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
                      @{user.username}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.2, marginTop: 2 }}>
                      {user.full_name || 'No display name'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.2, marginTop: 2 }}>
                      {user.email || 'No email'} · {Number(user.video_count || 0)} videos
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="form-row" style={{ marginTop: 16 }}>
          <label>Selected transfer target</label>
          <input
            value={selectedUserLabel || 'No user selected yet'}
            readOnly
          />
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={handleDeleteUser} disabled={isSubmitting}>
            {isSubmitting ? 'Deleting...' : 'Delete user and keep videos'}
          </button>
        </div>
      </div>
    </div>
  );
}
