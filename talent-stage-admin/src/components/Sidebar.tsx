import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toMediaUrl, useApi } from '../hooks/useApi';
import { useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';

function buildIconCandidates(label: string): string[] {
  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '/');
  const slug = label.toLowerCase().replace(/\s+/g, '-');
  const snake = label.toLowerCase().replace(/\s+/g, '_');
  const compact = label.toLowerCase().replace(/\s+/g, '');
  const lower = label.toLowerCase();
  const exact = label;
  const values = [slug, snake, compact, lower, exact];
  const unique = Array.from(new Set(values));
  const out: string[] = [];
  for (const name of unique) {
    out.push(`${baseUrl}icons/${name}.png`);
    out.push(`/icons/${name}.png`);
  }
  return Array.from(new Set(out));
}

function SidebarIcon({ label, fallback, className = 'ic' }: {
  label: string;
  fallback: string;
  className?: string;
}) {
  const candidates = buildIconCandidates(label);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const src = candidates[candidateIndex];

  if (!src) {
    return <span className={`${className} ic-fallback`} aria-hidden>{fallback}</span>;
  }

  return (
    <img
      className={`${className} ic-img`}
      src={src}
      alt=""
      aria-hidden
      onError={() => setCandidateIndex((idx) => idx + 1)}
    />
  );
}

export default function Sidebar() {
  const { admin, logout } = useAuth();
  const api = useApi();
  const navigate = useNavigate();
  const [pendingReports, setPendingReports] = useState(0);
  const { isDarkTheme, toggleTheme } = useTheme();

  const isSuperadmin = admin?.role === 'superadmin';
  const isMod = admin?.role === 'moderator' || isSuperadmin;

  useEffect(() => {
    (async () => {
      const r = await api('GET', '/dashboard');
      if (r.success && r.data?.stats?.reports?.pending) {
        setPendingReports(r.data.stats.reports.pending);
      }
    })();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initial = (admin?.full_name || admin?.username || 'A').charAt(0).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sb-logo">
        <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="48" stroke="url(#g)" strokeWidth="4"/>
          <path d="M50 22l7 18h18l-14.5 11 5.5 18L50 58 34 69l5.5-18L25 40h18z" fill="url(#g)"/>
          <defs><linearGradient id="g" x1="0" y1="0" x2="100" y2="100"><stop stopColor="#7b3fe4"/><stop offset="1" stopColor="#c84fd8"/></linearGradient></defs>
        </svg>
        <span>Talents Stage</span>
      </div>

      <nav className="sb-nav">
        <div className="sb-section">Main</div>
        <NavLink to="/" end className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
          <SidebarIcon label="Dashboard" fallback="📊" /> Dashboard
        </NavLink>

        <div className="sb-section">Content</div>
        <NavLink to="/videos" className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
          <SidebarIcon label="Videos" fallback="🎬" /> Videos
        </NavLink>
        <NavLink to="/users" className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
          <SidebarIcon label="Users" fallback="👥" /> Users
        </NavLink>
        <NavLink to="/comments" className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
          <SidebarIcon label="Comments" fallback="💬" /> Comments
        </NavLink>

        <div className="sb-section">Moderation</div>
        <NavLink to="/reports" className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
          <SidebarIcon label="Reports Queue" fallback="🚩" /> Reports Queue
          {pendingReports > 0 && <span className="sb-badge">{pendingReports}</span>}
        </NavLink>
        <NavLink to="/reports-archive" className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
          <SidebarIcon label="Reports Archive" fallback="🗂️" /> Reports Archive
        </NavLink>

        <div className="sb-section">Analytics</div>
        <NavLink to="/analytics" className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
          <SidebarIcon label="Analytics" fallback="📈" /> Analytics
        </NavLink>
        <NavLink to="/audit" className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
          <SidebarIcon label="Audit Log" fallback="📝" /> Audit Log
        </NavLink>

        {(isSuperadmin || isMod) && (
          <>
            <div className="sb-section sb-section-with-icon">
              <SidebarIcon label="Admin" fallback="🛡️" className="sb-section-icon" />
              <span>Admin</span>
            </div>
            {isSuperadmin && (
              <NavLink to="/moderators" className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
                <SidebarIcon label="Moderators" fallback="🛡️" /> Moderators
              </NavLink>
            )}
            {isMod && (
              <NavLink to="/system" className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
                <SidebarIcon label="System" fallback="🖥️" /> System
              </NavLink>
            )}
            {isSuperadmin && (
              <NavLink to="/settings" className={({isActive}) => `sb-item ${isActive ? 'active' : ''}`}>
                <SidebarIcon label="Settings" fallback="⚙️" /> Settings
              </NavLink>
            )}
          </>
        )}
      </nav>

      <div className="sb-footer">
        <button
          type="button"
          className="sb-theme-toggle"
          onClick={toggleTheme}
          aria-label={isDarkTheme ? 'Switch to day mode' : 'Switch to night mode'}
          title={isDarkTheme ? 'Switch to day mode' : 'Switch to night mode'}
        >
          <span className="sb-theme-toggle-icon" aria-hidden>{isDarkTheme ? '🌙' : '☀️'}</span>
          <span>{isDarkTheme ? 'Switch to Day' : 'Switch to Night'}</span>
        </button>

        <div className="sb-admin">
          <div className="av">
            {admin?.avatar_url ? (
              <img className="av-img" src={toMediaUrl(admin.avatar_url)} alt={admin.full_name || admin.username} />
            ) : (
              initial
            )}
          </div>
          <div className="info">
            <div className="name">{admin?.full_name || admin?.username}</div>
            <div className="role">{admin?.role}</div>
          </div>
        </div>
        <div className="sb-logout" onClick={handleLogout}>
          <SidebarIcon label="profile-logout" fallback="🚪" className="sb-logout-icon" />
          <span>Sign out</span>
        </div>
      </div>
    </aside>
  );
}
