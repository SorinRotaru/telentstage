import { useAppStore } from '../store/useAppStore';
import type { CSSProperties } from 'react';

type Page = 'home' | 'following' | 'upload' | 'saved' | 'account' | 'login';

interface Props {
  active: Page;
  onNav: (page: string) => void;
}

export default function BottomNav({ active, onNav }: Props) {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const uploadInProgress = useAppStore((s) => s.uploadInProgress);
  const uploadProgress = useAppStore((s) => s.uploadProgress);

  const profNav = () => onNav(loggedIn ? 'account' : 'login');

  return (
    <div className="bnav">
      <div className={`bi ${active === 'home' ? 'active' : ''}`} onClick={() => onNav('home')}>
        <div className="bc">
          <img src="/icons/home.png" style={{ width: 34, height: 34, objectFit: 'contain', filter: 'invert(1)' }} alt="Home" />
        </div>
      </div>
      <div className={`bi ${active === 'following' ? 'active' : ''}`} onClick={() => onNav('following')}>
        <div className="bc">
          <img src="/icons/following.png" style={{ width: 34, height: 34, objectFit: 'contain', filter: 'invert(1)' }} alt="Following" />
        </div>
      </div>
      <div className={`bi ${active === 'upload' ? 'active' : ''}`} onClick={() => onNav('upload')}>
        <div
          className={`bc ${uploadInProgress ? 'upload-nav-loading' : ''}`}
          style={{ ['--upload-progress' as string]: `${uploadProgress}%` } as CSSProperties}
        >
          <span className="upload-nav-inner">
            <img src="/icons/upload.png" style={{ width: 43, height: 43, objectFit: 'contain', filter: 'invert(1)' }} alt="Upload" />
          </span>
        </div>
      </div>
      <div className={`bi ${active === 'saved' ? 'active' : ''}`} onClick={() => onNav('saved')}>
        <div className="bc">
          <img src="/icons/saved.png" style={{ width: 34, height: 34, objectFit: 'contain', filter: 'invert(1)' }} alt="Saved" />
        </div>
      </div>
      <div className={`bi ${active === 'account' || active === 'login' ? 'active' : ''}`} onClick={profNav}>
        <div className="bc">
          <img src="/icons/account.png" style={{ width: 34, height: 34, objectFit: 'contain', filter: 'invert(1)' }} alt="Account" />
        </div>
      </div>
    </div>
  );
}
