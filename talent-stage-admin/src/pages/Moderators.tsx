import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { toMediaUrl, useApi } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { toast } from '../hooks/useToast';
import { fmtTime } from '../utils/format';
import { confirmDialog } from '../components/ConfirmDialog';

const CROP_PREVIEW_SIZE = 280;
const CROP_EXPORT_SIZE = 512;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getCropBounds(
  naturalWidth: number,
  naturalHeight: number,
  zoom: number,
  stageSize: number
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

interface Moderator {
  id: string;
  username: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  role: 'superadmin' | 'moderator' | 'support' | string;
  is_active: number | boolean;
  last_login: string | null;
  created_at?: string;
}

interface AddModeratorForm {
  full_name: string;
  username: string;
  email: string;
  password: string;
  role: 'moderator' | 'support' | 'superadmin';
}

const emptyAddForm: AddModeratorForm = {
  full_name: '',
  username: '',
  email: '',
  password: '',
  role: 'moderator',
};

function roleBadgeClass(role: string): string {
  if (role === 'superadmin') return 'badge-purple';
  if (role === 'support') return 'badge-yellow';
  return 'badge-blue';
}

export default function Moderators() {
  const api = useApi();
  const { admin, token, login } = useAuth();

  const [moderators, setModerators] = useState<Moderator[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<AddModeratorForm>({ ...emptyAddForm });
  const [addError, setAddError] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [showPwModal, setShowPwModal] = useState(false);
  const [passwordTargetId, setPasswordTargetId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const [showMyPwModal, setShowMyPwModal] = useState(false);
  const [myCurrentPassword, setMyCurrentPassword] = useState('');
  const [myNewPassword, setMyNewPassword] = useState('');
  const [myConfirmPassword, setMyConfirmPassword] = useState('');
  const [myPwError, setMyPwError] = useState('');
  const [myPwSubmitting, setMyPwSubmitting] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editTargetId, setEditTargetId] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editError, setEditError] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [avatarTarget, setAvatarTarget] = useState<Moderator | null>(null);
  const [avatarSrc, setAvatarSrc] = useState('');
  const [avatarError, setAvatarError] = useState('');
  const [avatarSubmitting, setAvatarSubmitting] = useState(false);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [avatarNatural, setAvatarNatural] = useState({ width: 0, height: 0 });
  const cropImageRef = useRef<HTMLImageElement | null>(null);

  const loadModerators = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    const r = await api<Moderator[]>('GET', '/moderators');
    if (!r.success || !r.data) {
      setModerators([]);
      setErrorMsg(r.error || 'Failed to load');
      setLoading(false);
      return;
    }
    setModerators(r.data);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    void loadModerators();
  }, [loadModerators]);

  useEffect(() => {
    return () => {
      if (avatarSrc.startsWith('blob:')) URL.revokeObjectURL(avatarSrc);
    };
  }, [avatarSrc]);

  const cropBounds = getCropBounds(avatarNatural.width, avatarNatural.height, cropZoom, CROP_PREVIEW_SIZE);
  const maxOffsetX = cropBounds?.maxX ?? 0;
  const maxOffsetY = cropBounds?.maxY ?? 0;
  const clampedCropX = clampNumber(cropX, -maxOffsetX, maxOffsetX);
  const clampedCropY = clampNumber(cropY, -maxOffsetY, maxOffsetY);

  const toggleModerator = async (id: string) => {
    const r = await api('PUT', `/moderators/${id}/toggle`);
    if (!r.success) {
      toast(r.error || 'Failed to update moderator', 'error');
      return;
    }
    toast('Moderator updated');
    void loadModerators();
  };

  const deleteModerator = (id: string, username: string) => {
    confirmDialog('Delete Moderator', `Account for ${username} will be permanently deleted.`, async () => {
      const r = await api('DELETE', `/moderators/${id}`);
      if (!r.success) {
        toast(r.error || 'Failed to delete moderator', 'error');
        return;
      }
      toast('Moderator deleted');
      void loadModerators();
    });
  };

  const openAddModerator = () => {
    setAddForm({ ...emptyAddForm });
    setAddError('');
    setShowAddModal(true);
  };

  const closeAddModerator = () => {
    setShowAddModal(false);
    setAddSubmitting(false);
  };

  const submitAddModerator = async () => {
    setAddError('');
    setAddSubmitting(true);
    const payload = {
      full_name: addForm.full_name.trim(),
      username: addForm.username.trim(),
      email: addForm.email.trim(),
      password: addForm.password,
      role: addForm.role,
    };
    const r = await api('POST', '/moderators', payload);
    setAddSubmitting(false);
    if (!r.success) {
      setAddError(r.error || 'Failed to create moderator');
      return;
    }
    closeAddModerator();
    toast('Moderator account created');
    void loadModerators();
  };

  const openChangePassword = (id: string) => {
    setPasswordTargetId(id);
    setNewPassword('');
    setPwError('');
    setShowPwModal(true);
  };

  const closeChangePassword = () => {
    setShowPwModal(false);
    setPasswordTargetId('');
    setNewPassword('');
    setPwError('');
    setPwSubmitting(false);
  };

  const submitChangePassword = async () => {
    setPwError('');
    setPwSubmitting(true);
    const r = await api('PUT', `/moderators/${passwordTargetId}/password`, { new_password: newPassword });
    setPwSubmitting(false);
    if (!r.success) {
      setPwError(r.error || 'Failed to update password');
      return;
    }
    closeChangePassword();
    toast('Password updated');
  };

  const openMyPasswordModal = () => {
    setMyCurrentPassword('');
    setMyNewPassword('');
    setMyConfirmPassword('');
    setMyPwError('');
    setShowMyPwModal(true);
  };

  const closeMyPasswordModal = () => {
    setShowMyPwModal(false);
    setMyCurrentPassword('');
    setMyNewPassword('');
    setMyConfirmPassword('');
    setMyPwError('');
    setMyPwSubmitting(false);
  };

  const submitMyPasswordChange = async () => {
    setMyPwError('');
    if (!myCurrentPassword || !myNewPassword || !myConfirmPassword) {
      setMyPwError('All password fields are required');
      return;
    }
    if (myNewPassword.length < 8) {
      setMyPwError('New password must be at least 8 characters');
      return;
    }
    if (myNewPassword !== myConfirmPassword) {
      setMyPwError('New password and confirm password do not match');
      return;
    }

    setMyPwSubmitting(true);
    const r = await api('PUT', '/me/password', {
      current_password: myCurrentPassword,
      new_password: myNewPassword,
    });
    setMyPwSubmitting(false);
    if (!r.success) {
      setMyPwError(r.error || 'Failed to change password');
      return;
    }
    closeMyPasswordModal();
    toast('Your password was updated');
  };

  const openEditSuperadmin = (m: Moderator) => {
    setEditTargetId(m.id);
    setEditFullName(m.full_name || '');
    setEditUsername(m.username || '');
    setEditEmail(m.email || '');
    setEditError('');
    setShowEditModal(true);
  };

  const closeEditSuperadmin = () => {
    setShowEditModal(false);
    setEditTargetId('');
    setEditFullName('');
    setEditUsername('');
    setEditEmail('');
    setEditError('');
    setEditSubmitting(false);
  };

  const submitEditSuperadmin = async () => {
    setEditError('');
    const payload = {
      full_name: editFullName.trim(),
      username: editUsername.trim(),
      email: editEmail.trim(),
    };

    if (!payload.full_name || !payload.username || !payload.email) {
      setEditError('full_name, username and email are required');
      return;
    }

    setEditSubmitting(true);
    const r = await api<Moderator>('PUT', `/moderators/${editTargetId}/profile`, payload);
    setEditSubmitting(false);

    if (!r.success || !r.data) {
      setEditError(r.error || 'Failed to update superadmin profile');
      return;
    }

    // Keep sidebar/header identity in sync if current logged admin edited own profile.
    if (token && admin && r.data.id === admin.id) {
      login(token, {
        ...admin,
        username: r.data.username || admin.username,
        email: r.data.email || admin.email,
        full_name: r.data.full_name || admin.full_name,
        avatar_url: r.data.avatar_url ?? admin.avatar_url ?? null,
        role: (r.data.role as 'superadmin' | 'moderator' | 'support') || admin.role,
      });
    }

    closeEditSuperadmin();
    toast('Superadmin profile updated');
    void loadModerators();
  };

  const openAvatarModal = (m: Moderator) => {
    setAvatarTarget(m);
    setAvatarSrc('');
    setAvatarError('');
    setAvatarSubmitting(false);
    setCropZoom(1);
    setCropX(0);
    setCropY(0);
    setAvatarNatural({ width: 0, height: 0 });
    setShowAvatarModal(true);
  };

  const closeAvatarModal = () => {
    setShowAvatarModal(false);
    setAvatarTarget(null);
    setAvatarSrc('');
    setAvatarError('');
    setAvatarSubmitting(false);
    setCropZoom(1);
    setCropX(0);
    setCropY(0);
    setAvatarNatural({ width: 0, height: 0 });
  };

  const onAvatarFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError('');
    if (!file.type.startsWith('image/')) {
      setAvatarError('Please select an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAvatarError('Image must be 10MB or less');
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setAvatarSrc(nextUrl);
    setCropZoom(1);
    setCropX(0);
    setCropY(0);
    setAvatarNatural({ width: 0, height: 0 });
  };

  const submitAvatar = async () => {
    setAvatarError('');
    if (!avatarTarget) {
      setAvatarError('No moderator selected');
      return;
    }
    const imageEl = cropImageRef.current;
    if (!avatarSrc || !imageEl || !cropBounds) {
      setAvatarError('Pick an image first');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = CROP_EXPORT_SIZE;
    canvas.height = CROP_EXPORT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setAvatarError('Image processing is not available on this browser');
      return;
    }
    const ratio = CROP_EXPORT_SIZE / CROP_PREVIEW_SIZE;
    const drawX = (((CROP_PREVIEW_SIZE - cropBounds.width) / 2) + clampedCropX) * ratio;
    const drawY = (((CROP_PREVIEW_SIZE - cropBounds.height) / 2) + clampedCropY) * ratio;
    const drawWidth = cropBounds.width * ratio;
    const drawHeight = cropBounds.height * ratio;
    ctx.clearRect(0, 0, CROP_EXPORT_SIZE, CROP_EXPORT_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageEl, drawX, drawY, drawWidth, drawHeight);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    if (!blob) {
      setAvatarError('Failed to process image');
      return;
    }
    const formData = new FormData();
    formData.append('avatar', blob, `avatar-${avatarTarget.id}.jpg`);

    setAvatarSubmitting(true);
    const r = await api<Moderator>('PUT', `/moderators/${avatarTarget.id}/avatar`, formData);
    setAvatarSubmitting(false);
    if (!r.success || !r.data) {
      setAvatarError(r.error || 'Failed to upload avatar');
      return;
    }
    if (token && admin && r.data.id === admin.id) {
      login(token, {
        ...admin,
        username: r.data.username || admin.username,
        email: r.data.email || admin.email,
        full_name: r.data.full_name || admin.full_name,
        avatar_url: r.data.avatar_url ?? admin.avatar_url ?? null,
        role: (r.data.role as 'superadmin' | 'moderator' | 'support') || admin.role,
      });
    }
    closeAvatarModal();
    toast('Avatar updated');
    void loadModerators();
  };

  const getInitial = (name: string) => String(name || '?').charAt(0).toUpperCase();
  const cropImageWidth = cropBounds?.width ?? CROP_PREVIEW_SIZE;
  const cropImageHeight = cropBounds?.height ?? CROP_PREVIEW_SIZE;
  const cropImageLeft = ((CROP_PREVIEW_SIZE - cropImageWidth) / 2) + clampedCropX;
  const cropImageTop = ((CROP_PREVIEW_SIZE - cropImageHeight) / 2) + clampedCropY;

  return (
    <div className="moderators-page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1>Moderators</h1>
          <p>Manage admin, moderator and support accounts</p>
        </div>
        <div className="actions">
          {admin?.role === 'superadmin' && (
            <button className="btn btn-ghost" onClick={openMyPasswordModal}>&#x1F511; Change My Password</button>
          )}
          <button className="btn btn-primary" onClick={openAddModerator}>+ Add Moderator</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Role</th>
              <th>Last Login</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="loading-row">
                <td colSpan={5}><div className="spinner" /></td>
              </tr>
            )}
            {!loading && !!errorMsg && (
              <tr className="empty-row">
                <td colSpan={5}>Failed to load</td>
              </tr>
            )}
            {!loading && !errorMsg && moderators.map((m) => {
              const me = m.id === admin?.id;
              const isSuperadmin = String(m.role) === 'superadmin';
              const isActive = Boolean(m.is_active);
              return (
                <tr key={m.id}>
                  <td>
                    <div className="av-cell">
                      {m.avatar_url ? (
                        <img src={toMediaUrl(m.avatar_url)} alt={m.full_name || m.username} />
                      ) : (
                        <div className="av-ph">{getInitial(m.full_name || m.username)}</div>
                      )}
                      <div>
                        <div className="name">{m.full_name || m.username}</div>
                        <div className="sub">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className={`badge ${roleBadgeClass(m.role)}`}>{m.role}</span></td>
                  <td style={{ color: 'var(--muted)' }}>{fmtTime(m.last_login)}</td>
                  <td>
                    <span className={`badge ${isActive ? 'badge-green' : 'badge-red'}`}>
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openAvatarModal(m)}>
                        Avatar
                      </button>
                      {isSuperadmin && (
                        <button className="btn btn-ghost btn-sm" onClick={() => openEditSuperadmin(m)}>
                          Edit
                        </button>
                      )}
                      {!me ? (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => toggleModerator(m.id)}>
                            {isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => openChangePassword(m.id)}>
                            &#x1F511; Password
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteModerator(m.id, m.username)}>
                            Delete
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>- You -</span>
                          <button className="btn btn-ghost btn-sm" onClick={openMyPasswordModal}>
                            &#x1F511; My Password
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={`modal-overlay ${showAddModal ? 'open' : ''}`} onClick={closeAddModerator}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Add Moderator</h2>
          <div className="form-row">
            <label>Full Name</label>
            <input
              type="text"
              placeholder="John Doe"
              value={addForm.full_name}
              onChange={(e) => setAddForm((prev) => ({ ...prev, full_name: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label>Username</label>
            <input
              type="text"
              placeholder="johndoe"
              value={addForm.username}
              onChange={(e) => setAddForm((prev) => ({ ...prev, username: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label>Email</label>
            <input
              type="email"
              placeholder="john@example.com"
              value={addForm.email}
              onChange={(e) => setAddForm((prev) => ({ ...prev, email: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label>Password</label>
            <input
              type="password"
              placeholder="Min 8 characters"
              value={addForm.password}
              onChange={(e) => setAddForm((prev) => ({ ...prev, password: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label>Role</label>
            <select
              value={addForm.role}
              onChange={(e) => setAddForm((prev) => ({ ...prev, role: e.target.value as AddModeratorForm['role'] }))}
            >
              <option value="moderator">Moderator</option>
              <option value="support">Support</option>
              <option value="superadmin">Super Admin</option>
            </select>
          </div>
          <div className="modal-err">{addError}</div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={closeAddModerator}>Cancel</button>
            <button className="btn btn-primary" onClick={submitAddModerator} disabled={addSubmitting}>
              {addSubmitting ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${showPwModal ? 'open' : ''}`} onClick={closeChangePassword}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Change Password</h2>
          <input type="hidden" value={passwordTargetId} readOnly />
          <div className="form-row">
            <label>New Password</label>
            <input
              type="password"
              placeholder="Min 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitChangePassword(); }}
            />
          </div>
          <div className="modal-err">{pwError}</div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={closeChangePassword}>Cancel</button>
            <button className="btn btn-primary" onClick={submitChangePassword} disabled={pwSubmitting}>
              {pwSubmitting ? 'Saving...' : 'Update Password'}
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${showEditModal ? 'open' : ''}`} onClick={closeEditSuperadmin}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Edit Superadmin</h2>
          <input type="hidden" value={editTargetId} readOnly />
          <div className="form-row">
            <label>Full Name</label>
            <input type="text" value={editFullName} onChange={(e) => setEditFullName(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Username</label>
            <input type="text" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Email</label>
            <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
          </div>
          <div className="modal-err">{editError}</div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={closeEditSuperadmin}>Cancel</button>
            <button className="btn btn-primary" onClick={submitEditSuperadmin} disabled={editSubmitting}>
              {editSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${showAvatarModal ? 'open' : ''}`} onClick={closeAvatarModal}>
        <div className="modal avatar-crop-modal" onClick={(e) => e.stopPropagation()}>
          <h2>Upload Avatar {avatarTarget ? `- ${avatarTarget.username}` : ''}</h2>
          <div className="form-row">
            <label>Image File</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={onAvatarFileChange}
            />
          </div>
          <div className="avatar-crop-stage-wrap">
            <div className="avatar-crop-stage">
              {avatarSrc ? (
                <img
                  ref={cropImageRef}
                  className="avatar-crop-image"
                  src={avatarSrc}
                  alt="Avatar crop source"
                  style={{
                    width: `${cropImageWidth}px`,
                    height: `${cropImageHeight}px`,
                    left: `${cropImageLeft}px`,
                    top: `${cropImageTop}px`,
                  }}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    setAvatarNatural({
                      width: el.naturalWidth || 0,
                      height: el.naturalHeight || 0,
                    });
                  }}
                />
              ) : (
                <div className="avatar-crop-placeholder">Select an image to start cropping</div>
              )}
              <div className="avatar-crop-grid" aria-hidden />
            </div>
          </div>
          <div className="avatar-crop-controls">
            <div className="form-row">
              <label>Zoom ({cropZoom.toFixed(2)}x)</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={cropZoom}
                disabled={!avatarSrc}
                onChange={(e) => setCropZoom(Number(e.target.value))}
              />
            </div>
            <div className="form-row">
              <label>Horizontal</label>
                <input
                  type="range"
                  min={-maxOffsetX}
                  max={maxOffsetX}
                  step={1}
                  value={clampedCropX}
                  disabled={!avatarSrc || maxOffsetX <= 0}
                  onChange={(e) => setCropX(Number(e.target.value))}
                />
            </div>
            <div className="form-row">
              <label>Vertical</label>
                <input
                  type="range"
                  min={-maxOffsetY}
                  max={maxOffsetY}
                  step={1}
                  value={clampedCropY}
                  disabled={!avatarSrc || maxOffsetY <= 0}
                  onChange={(e) => setCropY(Number(e.target.value))}
                />
            </div>
          </div>
          <div className="modal-err">{avatarError}</div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={closeAvatarModal}>Cancel</button>
            <button className="btn btn-primary" onClick={submitAvatar} disabled={avatarSubmitting}>
              {avatarSubmitting ? 'Uploading...' : 'Save Avatar'}
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${showMyPwModal ? 'open' : ''}`} onClick={closeMyPasswordModal}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Change My Password</h2>
          <div className="form-row">
            <label>Current Password</label>
            <input
              type="password"
              value={myCurrentPassword}
              onChange={(e) => setMyCurrentPassword(e.target.value)}
              placeholder="Current password"
            />
          </div>
          <div className="form-row">
            <label>New Password</label>
            <input
              type="password"
              value={myNewPassword}
              onChange={(e) => setMyNewPassword(e.target.value)}
              placeholder="Min 8 characters"
            />
          </div>
          <div className="form-row">
            <label>Confirm New Password</label>
            <input
              type="password"
              value={myConfirmPassword}
              onChange={(e) => setMyConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              onKeyDown={(e) => { if (e.key === 'Enter') void submitMyPasswordChange(); }}
            />
          </div>
          <div className="modal-err">{myPwError}</div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={closeMyPasswordModal}>Cancel</button>
            <button className="btn btn-primary" onClick={submitMyPasswordChange} disabled={myPwSubmitting}>
              {myPwSubmitting ? 'Saving...' : 'Update Password'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
