import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Videos from './pages/Videos';
import Users from './pages/Users';
import UserProfile from './pages/UserProfile';
import Comments from './pages/Comments';
import Reports from './pages/Reports';
import ReportsArchive from './pages/ReportsArchive';
import Analytics from './pages/Analytics';
import AuditLog from './pages/AuditLog';
import Moderators from './pages/Moderators';
import SystemMonitor from './pages/SystemMonitor';
import Settings from './pages/Settings';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="videos" element={<Videos />} />
        <Route path="users" element={<Users />} />
        <Route path="users/:userId" element={<UserProfile />} />
        <Route path="comments" element={<Comments />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports-archive" element={<ReportsArchive />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="moderators" element={<Moderators />} />
        <Route path="system" element={<SystemMonitor />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
