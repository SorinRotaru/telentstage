import { useAppStore } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from './Toast';

export default function ShareSheet() {
  const { shareOpen, setShareOpen, currentVideo, token } = useAppStore();

  const videoUrl  = currentVideo?.file_url  || window.location.href;
  const pageUrl   = window.location.href;
  const shareText = currentVideo?.title
    ? `Check out "${currentVideo.title}" on Talents Stage!`
    : 'Check out this video on Talents Stage!';

  const trackShare = async (platform: string) => {
    if (currentVideo && token) {
      await apiFetch('/videos/' + currentVideo.id + '/share', {
        method: 'POST',
        body: JSON.stringify({ platform }),
      }).catch(() => {});
    }
  };

  const openUrl = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(videoUrl);
    } catch {
      // Fallback for browsers without clipboard API
      const ta = document.createElement('textarea');
      ta.value = videoUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    await trackShare('copy_link');
    toast('Link copied!');
    setShareOpen(false);
  };

  const nativeShare = async (platform: string) => {
    // Use native share sheet for platforms without a web share URL
    if (navigator.share) {
      try {
        await navigator.share({ title: shareText, url: videoUrl });
        await trackShare(platform);
        setShareOpen(false);
        return;
      } catch {
        // User dismissed — don't close sheet
        return;
      }
    }
    // Fallback: copy link
    await copyLink();
  };

  const doShare = async (platform: string, url: string) => {
    await trackShare(platform);
    toast('Opening ' + platform + '…');
    openUrl(url);
    setShareOpen(false);
  };

  const enc = (s: string) => encodeURIComponent(s);

  const platforms = [
    { name: 'WhatsApp',   icon: '/icons/whatsapp.svg',  action: () => doShare('WhatsApp',  `https://wa.me/?text=${enc(shareText + ' ' + videoUrl)}`) },
    { name: 'Instagram',  icon: '/icons/instagram.svg', action: () => nativeShare('Instagram') },
    { name: 'Facebook',   icon: '/icons/facebook.svg',  action: () => doShare('Facebook',  `https://www.facebook.com/sharer/sharer.php?u=${enc(pageUrl)}`) },
    { name: 'TikTok',     icon: '/icons/tiktok.svg',    action: () => nativeShare('TikTok') },
    { name: 'X',          icon: '/icons/x.svg',         action: () => doShare('X',         `https://twitter.com/intent/tweet?url=${enc(pageUrl)}&text=${enc(shareText)}`) },
    { name: 'Snapchat',   icon: '/icons/snapchat.svg',  action: () => doShare('Snapchat',  `https://www.snapchat.com/scan?attachmentUrl=${enc(pageUrl)}`) },
    { name: 'Telegram',   icon: '/icons/telegram.svg',  action: () => doShare('Telegram',  `https://t.me/share/url?url=${enc(pageUrl)}&text=${enc(shareText)}`) },
    { name: 'Copy Link',  icon: '/icons/copylink.svg',  action: copyLink },
  ];

  if (!shareOpen) return null;

  return (
    <div className="shov open" onClick={() => setShareOpen(false)}>
      <div className="shsh" onClick={(e) => e.stopPropagation()}>
        <h3>Share</h3>
        <div className="sgg">
          {platforms.map((p) => (
            <div className="shi" key={p.name} onClick={p.action}>
              <div className="shc">
                <img
                  src={p.icon}
                  alt={p.name}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
              <span>{p.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
