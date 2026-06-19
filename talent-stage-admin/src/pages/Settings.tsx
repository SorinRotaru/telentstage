import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { toast } from '../hooks/useToast';

interface FeatureFlag {
  id: string;
  flag_key: string;
  flag_value: number | boolean;
  description: string;
}

interface SystemSetting {
  setting_key: string;
  setting_value: string;
}

export default function Settings() {
  const api = useApi();

  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [flagsError, setFlagsError] = useState('');
  const [settingsError, setSettingsError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [timerMsDraft, setTimerMsDraft] = useState('5000');
  const [timerOpacityDraft, setTimerOpacityDraft] = useState('0.75');
  const [timerVisibleSaving, setTimerVisibleSaving] = useState(false);
  const [timerMsSaving, setTimerMsSaving] = useState(false);
  const [timerOpacitySaving, setTimerOpacitySaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setFlagsError('');
    setSettingsError('');

    const [fr, sr] = await Promise.all([
      api<FeatureFlag[]>('GET', '/feature-flags'),
      api<SystemSetting[]>('GET', '/settings'),
    ]);

    if (fr.success && fr.data) {
      setFlags(fr.data);
    } else {
      setFlags([]);
      setFlagsError(fr.error || 'Failed to load');
    }

    if (sr.success && sr.data) {
      setSettings(sr.data);
    } else {
      setSettings([]);
      setSettingsError(sr.error || 'Failed to load');
    }

    setLoading(false);
  }, [api]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const existingMs = settings.find((s) => s.setting_key === 'feed_swipe_timer_ms')?.setting_value;
    if (existingMs !== undefined) {
      setTimerMsDraft(existingMs);
    } else {
      const existingSeconds = settings.find((s) => s.setting_key === 'feed_swipe_timer_seconds')?.setting_value;
      if (existingSeconds !== undefined) {
        const parsedSeconds = Number(existingSeconds);
        if (Number.isFinite(parsedSeconds)) {
          setTimerMsDraft(String(Math.max(0, Math.floor(parsedSeconds * 1000))));
        }
      }
    }
    const existingOpacity = settings.find((s) => s.setting_key === 'feed_swipe_timer_opacity')?.setting_value;
    if (existingOpacity !== undefined) {
      setTimerOpacityDraft(existingOpacity);
    }
  }, [settings]);

  const toggleFlag = async (key: string, value: boolean) => {
    const r = await api('PUT', `/feature-flags/${encodeURIComponent(key)}`, { flag_value: value });
    if (!r.success) {
      toast(r.error || 'Failed to update flag', 'error');
      void loadSettings();
      return;
    }
    toast(`Flag "${key}" ${value ? 'enabled' : 'disabled'}`);
    void loadSettings();
  };

  const openEditSetting = (key: string, value: string) => {
    setEditKey(key);
    setEditValue(value);
    setEditOpen(true);
  };

  const closeEditSetting = () => {
    setEditOpen(false);
    setEditKey('');
    setEditValue('');
    setEditSaving(false);
  };

  const submitEditSetting = async () => {
    if (!editKey) return;
    setEditSaving(true);
    const r = await api('PUT', `/settings/${encodeURIComponent(editKey)}`, { setting_value: editValue });
    setEditSaving(false);
    if (!r.success) {
      toast(r.error || 'Failed to update setting', 'error');
      return;
    }
    closeEditSetting();
    toast('Setting updated');
    void loadSettings();
  };

  const timerEnabled = Boolean(Number(flags.find((f) => f.flag_key === 'feed_swipe_timer_enabled')?.flag_value || 0));
  const timerVisible = Number(settings.find((s) => s.setting_key === 'feed_swipe_timer_visible')?.setting_value || '1') === 1;
  const timerMsCurrent = settings.find((s) => s.setting_key === 'feed_swipe_timer_ms')?.setting_value
    || String(Math.max(
      0,
      Math.floor(Number(settings.find((s) => s.setting_key === 'feed_swipe_timer_seconds')?.setting_value || '5') * 1000),
    ));
  const timerOpacityCurrent = settings.find((s) => s.setting_key === 'feed_swipe_timer_opacity')?.setting_value || '0.75';
  const timerVisibleCurrent = timerVisible ? 'Visible' : 'Hidden';

  const submitTimerVisible = async (nextVisible: boolean) => {
    setTimerVisibleSaving(true);
    const r = await api('PUT', '/settings/feed_swipe_timer_visible', { setting_value: nextVisible ? '1' : '0' });
    setTimerVisibleSaving(false);
    if (!r.success) {
      toast(r.error || 'Failed to save timer visibility', 'error');
      return;
    }
    toast(`Swipe timer on-screen display ${nextVisible ? 'enabled' : 'hidden'}`);
    void loadSettings();
  };

  const submitTimerMs = async () => {
    const parsed = Number(timerMsDraft);
    if (!Number.isFinite(parsed)) {
      toast('Milliseconds must be a valid number', 'error');
      return;
    }
    const valueMs = Math.max(0, Math.min(60000, Math.floor(parsed)));
    const valueSecondsCompat = Math.floor(valueMs / 1000);
    setTimerMsSaving(true);
    const [msRes, secondsRes] = await Promise.all([
      api('PUT', '/settings/feed_swipe_timer_ms', { setting_value: String(valueMs) }),
      api('PUT', '/settings/feed_swipe_timer_seconds', { setting_value: String(valueSecondsCompat) }),
    ]);
    setTimerMsSaving(false);
    if (!msRes.success || !secondsRes.success) {
      toast(msRes.error || secondsRes.error || 'Failed to save timer milliseconds', 'error');
      return;
    }
    setTimerMsDraft(String(valueMs));
    toast('Swipe timer milliseconds updated');
    void loadSettings();
  };

  const submitTimerOpacity = async () => {
    const parsed = Number(timerOpacityDraft);
    if (!Number.isFinite(parsed)) {
      toast('Opacity must be a valid number', 'error');
      return;
    }
    const value = Math.max(0.05, Math.min(1, parsed));
    setTimerOpacitySaving(true);
    const r = await api('PUT', '/settings/feed_swipe_timer_opacity', { setting_value: String(value) });
    setTimerOpacitySaving(false);
    if (!r.success) {
      toast(r.error || 'Failed to save timer opacity', 'error');
      return;
    }
    setTimerOpacityDraft(String(value));
    toast('Swipe timer opacity updated');
    void loadSettings();
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Settings</h1>
        <p>Feature flags, system settings and operational tools</p>
      </div>

      <h3 style={{ marginBottom: 16 }}>Feature Flags</h3>
      <div className="table-wrap" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Feed Swipe Timer</div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Lock swipe for a few seconds when a new video starts.
            </div>
            <div style={{ marginTop: 8 }}>
              <span className={`badge ${timerEnabled ? 'badge-green' : 'badge-red'}`}>
                {timerEnabled ? 'ACTIVE' : 'OFF'}
              </span>
              <span style={{ color: 'var(--muted)', marginLeft: 10, fontSize: 12 }}>
                Current duration (ms): {timerMsCurrent}
              </span>
              <span style={{ color: 'var(--muted)', marginLeft: 10, fontSize: 12 }}>
                Current opacity: {timerOpacityCurrent}
              </span>
              <span style={{ color: 'var(--muted)', marginLeft: 10, fontSize: 12 }}>
                On-screen timer: {timerVisibleCurrent}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              className={`btn ${timerEnabled ? 'btn-danger' : 'btn-primary'} btn-sm`}
              onClick={() => { void toggleFlag('feed_swipe_timer_enabled', !timerEnabled); }}
            >
              {timerEnabled ? 'Deactivate Timer' : 'Activate Timer'}
            </button>
            <input
              type="number"
              min={0}
              max={60000}
              step={100}
              value={timerMsDraft}
              onChange={(e) => setTimerMsDraft(e.target.value)}
              style={{ width: 108 }}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { void submitTimerMs(); }}
              disabled={timerMsSaving}
            >
              {timerMsSaving ? 'Saving...' : 'Save Milliseconds'}
            </button>
            <input
              type="number"
              min={0.05}
              max={1}
              step={0.05}
              value={timerOpacityDraft}
              onChange={(e) => setTimerOpacityDraft(e.target.value)}
              style={{ width: 88 }}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { void submitTimerOpacity(); }}
              disabled={timerOpacitySaving}
            >
              {timerOpacitySaving ? 'Saving...' : 'Save Opacity'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { void submitTimerVisible(!timerVisible); }}
              disabled={timerVisibleSaving}
            >
              {timerVisibleSaving
                ? 'Saving...'
                : (timerVisible ? 'Hide On-Screen Timer' : 'Show On-Screen Timer')}
            </button>
          </div>
        </div>
      </div>
      <div className="table-wrap" style={{ marginBottom: 28 }}>
        <table>
          <thead>
            <tr><th>Flag</th><th>Description</th><th>Status</th><th>Toggle</th></tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="loading-row"><td colSpan={4}><div className="spinner" /></td></tr>
            )}
            {!loading && !!flagsError && (
              <tr className="empty-row"><td colSpan={4}>Failed to load</td></tr>
            )}
            {!loading && !flagsError && flags.map((f) => {
              const isOn = Boolean(Number(f.flag_value));
              return (
                <tr key={f.id || f.flag_key}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{f.flag_key}</td>
                  <td style={{ color: 'var(--muted)' }}>{f.description || '-'}</td>
                  <td><span className={`badge ${isOn ? 'badge-green' : 'badge-red'}`}>{isOn ? 'ON' : 'OFF'}</span></td>
                  <td>
                    <label className="toggle">
                      <input type="checkbox" checked={isOn} onChange={(e) => toggleFlag(f.flag_key, e.target.checked)} />
                      <span className="slider" />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginBottom: 16 }}>System Settings</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Setting</th><th>Value</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="loading-row"><td colSpan={3}><div className="spinner" /></td></tr>
            )}
            {!loading && !!settingsError && (
              <tr className="empty-row"><td colSpan={3}>Failed to load</td></tr>
            )}
            {!loading && !settingsError && settings.map((s) => (
              <tr key={s.setting_key}>
                <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{s.setting_key}</td>
                <td style={{ color: 'var(--muted)' }}>{s.setting_value || '-'}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => openEditSetting(s.setting_key, s.setting_value || '')}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={`modal-overlay ${editOpen ? 'open' : ''}`} onClick={closeEditSetting}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Edit Setting</h2>
          <input type="hidden" value={editKey} readOnly />
          <div className="form-row">
            <label>{editKey || 'Setting'}</label>
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitEditSetting(); }}
            />
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={closeEditSetting}>Cancel</button>
            <button className="btn btn-primary" onClick={submitEditSetting} disabled={editSaving}>
              {editSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
