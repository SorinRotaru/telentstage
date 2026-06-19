import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from './store/useAppStore';
import Toast from './components/Toast';
import BottomNav from './components/BottomNav';
import SideDrawer from './components/SideDrawer';
import ShareSheet from './components/ShareSheet';
import { apiFetch, MAINTENANCE_EVENT } from './services/api';
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Account from './pages/Account';
import Upload from './pages/Upload';
import SavedVideos from './pages/SavedVideos';
import SharedVideos from './pages/SharedVideos';
import Followers from './pages/Followers';
import Following from './pages/Following';
import Creator from './pages/Creator';
import Talent from './pages/Talent';
import ForgotPassword from './pages/ForgotPassword';
import Maintenance from './pages/Maintenance';
import VideoAnalytics from './pages/VideoAnalytics';
import './styles/app.css';

type Page = 'home' | 'login' | 'signup' | 'forgot' | 'account' | 'upload' | 'saved' | 'shared' | 'followers' | 'following' | 'creator' | 'talent' | 'video-analytics';

function App() {
  const [page, setPage] = useState<Page>('home');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [uploadNavTick, setUploadNavTick] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [creatorData, setCreatorData] = useState<any>(null);
  const [talentType, setTalentType] = useState('');
  const [talentTypes, setTalentTypes] = useState<string[]>([]);
  const { restoreSession } = useAppStore();

  useEffect(() => {
    const checkMaintenance = async () => {
      const res = await apiFetch<{ maintenance: boolean; message?: string }>('/maintenance');
      if (!res.success || !res.data) return;
      setMaintenanceMode(!!res.data.maintenance);
      setMaintenanceMessage(res.data.message || '');
    };

    restoreSession();
    void checkMaintenance();
    const interval = window.setInterval(() => { void checkMaintenance(); }, 30000);

    const onMaintenance = (ev: Event) => {
      const detail = (ev as CustomEvent<{ active?: boolean; message?: string }>).detail;
      if (!detail?.active) return;
      setMaintenanceMode(true);
      setMaintenanceMessage(detail.message || 'We are currently doing maintenance. Please try again later.');
    };
    window.addEventListener(MAINTENANCE_EVENT, onMaintenance);

    const saved = localStorage.getItem('ts_page') as Page;
    if (saved && saved !== 'home') setPage(saved);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener(MAINTENANCE_EVENT, onMaintenance);
    };
  }, []);

  const onNav = useCallback((pg: string, data?: unknown) => {
    const skip = ['login', 'signup', 'forgot', 'creator'];
    if (!skip.includes(pg)) localStorage.setItem('ts_page', pg);
    if (pg === 'upload') setUploadNavTick((n) => n + 1);

    if (pg === 'creator' && data) {
      setCreatorData(data);
    }
    if (pg === 'talent') {
      let nextTypes: string[] = [];
      if (typeof data === 'string') {
        const one = data.trim();
        if (one) nextTypes = [one];
      } else if (data && typeof data === 'object' && Array.isArray((data as { categories?: unknown }).categories)) {
        nextTypes = (data as { categories: unknown[] }).categories
          .map((v) => String(v || '').trim())
          .filter((v) => !!v);
      }
      setTalentTypes(nextTypes);
      setTalentType(nextTypes.length === 1 ? nextTypes[0] : '');
    }
    setPage(pg as Page);
  }, []);

  const getActiveNav = (): 'home' | 'following' | 'upload' | 'saved' | 'account' | 'login' => {
    if (page === 'home') return 'home';
    if (page === 'following') return 'following';
    if (page === 'upload') return 'upload';
    if (page === 'saved') return 'saved';
    if (page === 'account' || page === 'login' || page === 'signup' || page === 'forgot' || page === 'video-analytics') return 'account';
    return 'home';
  };

  const renderPage = () => {
    switch (page) {
      case 'home': return <Home onNav={onNav} />;
      case 'login': return <Login onNav={onNav} />;
      case 'signup': return <Signup onNav={onNav} />;
      case 'forgot': return <ForgotPassword onNav={onNav} />;
      case 'account': return <Account onNav={onNav} />;
      case 'video-analytics': return <VideoAnalytics onNav={onNav} />;
      case 'upload': return <Upload onNav={onNav} openToken={uploadNavTick} />;
      case 'saved': return <SavedVideos onNav={onNav} />;
      case 'shared': return <SharedVideos onNav={onNav} />;
      case 'followers': return <Followers onNav={onNav} />;
      case 'following': return <Following onNav={onNav} />;
      case 'creator': return <Creator data={creatorData} onNav={onNav} />;
      case 'talent': return <Talent talentType={talentType} talentTypes={talentTypes} onNav={onNav} />;
      default: return <Home onNav={onNav} />;
    }
  };

  return (
    <div id="app" className={page === 'home' ? 'home-layout' : ''}>
      {maintenanceMode ? (
        <Maintenance message={maintenanceMessage} />
      ) : (
        <>
          <div className={`page active ${page === 'home' ? 'home-page' : ''}`}>
            {renderPage()}
            <BottomNav active={getActiveNav()} onNav={onNav} />
          </div>
          <SideDrawer onNav={onNav} />
          <ShareSheet />
        </>
      )}
      <Toast />
    </div>
  );
}

export default App;
