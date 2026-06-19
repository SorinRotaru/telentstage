import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';
import type { Video, PaginatedResponse } from '../types';

const BG = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];

interface Props {
  onNav: (page: string) => void;
}

export default function SharedVideos({ onNav }: Props) {
  const { loggedIn, setFeedVideos, setFeedIndex, setCurrentVideo } = useAppStore();
  const [videos, setVideos] = useState<Video[]>([]);

  useEffect(() => {
    if (loggedIn) loadShared();
  }, [loggedIn]);

  const loadShared = async () => {
    const data = await apiFetch<PaginatedResponse<Video>>('/videos/shared');
    if (data.success && data.data) setVideos(data.data.items || []);
  };

  const openVideo = (index: number) => {
    const selected = videos[index];
    if (!selected) return;
    setFeedVideos(videos);
    setFeedIndex(index);
    setCurrentVideo(selected);
    onNav('home');
  };

  const removeShared = async (index: number, videoId: string, shareId?: string) => {
    const endpoint = shareId
      ? '/videos/shared/' + shareId
      : '/videos/' + videoId + '/share';
    const data = await apiFetch<{ removed: boolean }>(endpoint, { method: 'DELETE' });
    if (!data.success) {
      toast('Error: ' + data.error);
      return;
    }
    setVideos((prev) => prev.filter((_, i) => i !== index));
    toast('Removed from shared');
  };

  return (
    <div className="sp">
      <div className="ph">
        <div className="bbtn" onClick={() => onNav('home')}>&#8592; Back</div>
      </div>
      <div className="pttl">Videos you shared</div>
      <div className="vg">
        {videos.length === 0 ? (
          <div style={{ gridColumn: '1/-1', padding: 24, textAlign: 'center', color: '#555', fontSize: 14 }}>Nothing here yet</div>
        ) : videos.map((v, i) => (
          <div className={`vgi ${BG[i % BG.length]}`} key={`${v.id}-${i}`} onClick={() => openVideo(i)} style={{ position: 'relative' }}>
            {v.thumbnail_url ? (
              <img src={v.thumbnail_url} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} alt="" />
            ) : (
              <video src={v.file_url} preload="metadata" muted playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0, pointerEvents: 'none' }}
                onLoadedMetadata={(e) => { (e.target as HTMLVideoElement).currentTime = 1; }} />
            )}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.6)', pointerEvents: 'none' }}>
              <img
                src="/icons/play.png"
                alt=""
                style={{ width: 34, height: 34, objectFit: 'contain' }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                  if (fb) fb.style.display = 'inline';
                }}
              />
              <span aria-hidden style={{ display: 'none', fontSize: 22 }}>&#9654;</span>
            </div>
            <div className="dw">
              <button className="delbtn" onClick={(e) => { e.stopPropagation(); void removeShared(i, v.id, v.share_id); }} aria-label="Remove shared video" title="Remove shared video">
                <img src="/icons/bin.png" alt="Delete" style={{ width: 16, height: 16, objectFit: 'contain' }} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
