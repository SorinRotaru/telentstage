import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import type { Video, PaginatedResponse } from '../types';

const BG = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];

interface Props {
  onNav: (page: string) => void;
}

export default function SavedVideos({ onNav }: Props) {
  const {
    loggedIn,
    setFeedVideos,
    setFeedIndex,
    setCurrentVideo,
    setFeedSavedContext,
    setFeedCreatorContext,
  } = useAppStore();
  const [videos, setVideos] = useState<Video[]>([]);

  useEffect(() => {
    if (loggedIn) loadSaved();
  }, [loggedIn]);

  const loadSaved = async () => {
    const data = await apiFetch<PaginatedResponse<Video>>('/videos/saved');
    if (data.success && data.data) setVideos(data.data.items || []);
  };

  const unsave = async (id: string) => {
    await apiFetch('/videos/' + id + '/save', { method: 'POST' });
    loadSaved();
  };

  const openVideo = (index: number) => {
    const selected = videos[index];
    if (!selected) return;
    setFeedVideos(videos);
    setFeedIndex(index);
    setCurrentVideo(selected);
    setFeedCreatorContext(null);
    setFeedSavedContext(true);
    onNav('home');
  };

  return (
    <div className="sp">
      <div className="ph">
        <div className="bbtn" onClick={() => onNav('home')}>&#8592; Back</div>
      </div>
      <div className="pttl">Saved videos</div>
      <div className="vg">
        {videos.length === 0 ? (
          <div style={{ gridColumn: '1/-1', padding: 24, textAlign: 'center', color: '#555', fontSize: 14 }}>Nothing here yet</div>
        ) : videos.map((v, i) => (
          <div className={`vgi ${BG[i % BG.length]}`} key={v.id} onClick={() => openVideo(i)} style={{ position: 'relative' }}>
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
              <button className="delbtn" onClick={(e) => { e.stopPropagation(); unsave(v.id); }} aria-label="Remove saved video" title="Remove saved video">
                <img src="/icons/bin.png" alt="Delete" style={{ width: 16, height: 16, objectFit: 'contain' }} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
