import { useAppStore } from '../store/useAppStore';

interface Props {
  onNav: (page: string) => void;
}

export default function SideDrawer({ onNav }: Props) {
  const { drawerOpen, setDrawerOpen, loggedIn } = useAppStore();

  const close = () => setDrawerOpen(false);
  const go = (pg: string) => { close(); onNav(pg); };

  return (
    <>
      <div className={`dov ${drawerOpen ? 'open' : ''}`} onClick={close} />
      <div className={`sd ${drawerOpen ? 'open' : ''}`}>
        <div className="dhd">
          <div className="dbrnd">
            <img
              className="db-logo-inline"
              src="/icons/logo-inline.png"
              alt="Menu logo"
              onError={(e) => {
                const el = e.currentTarget as HTMLImageElement;
                if (el.dataset.fallbackApplied === '1') return;
                el.dataset.fallbackApplied = '1';
                el.src = '/icons/logo.png';
              }}
            />
          </div>
          <button className="dx" onClick={close}>&times;</button>
        </div>
        <div className="dsep" />
        <div className="ditem" onClick={() => go('home')}>Home</div>
        {loggedIn && <div className="ditem" onClick={() => go('followers')}>Followers</div>}
        {loggedIn && <div className="ditem" onClick={() => go('following')}>Following</div>}
        {loggedIn && <div className="ditem" onClick={() => go('saved')}>Saved Videos</div>}
        {loggedIn && <div className="ditem" onClick={() => go('shared')}>Shared Videos</div>}
        {loggedIn && <div className="ditem" onClick={() => go('account')}>Account</div>}
        {!loggedIn && <div className="ditem" onClick={() => go('login')}>Sign In</div>}
      </div>
    </>
  );
}
