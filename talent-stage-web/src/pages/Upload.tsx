import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { apiFetch } from '../services/api';
import { toast } from '../components/Toast';
import type { Video, PaginatedResponse } from '../types';
import { TALENT_TYPES } from '../types';

const BG = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];
const GALLERY_UPLOAD_ICON = '/icons/upload-gallery.png';
const CAMERA_UPLOAD_ICON = '/icons/upload-camera.png';
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 1000;
const API_BASE = import.meta.env.VITE_API_URL || 'https://api.web-demo.space/api';
const USE_CLOUDFLARE_STREAM_UPLOAD = String(import.meta.env.VITE_STREAM_UPLOADS || '').toLowerCase() === 'true';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Props {
  onNav: (page: string) => void;
  openToken: number;
}

export default function Upload({ onNav, openToken }: Props) {
  const {
    user, loggedIn, setFeedVideos, setFeedIndex, setCurrentVideo,
    uploadInProgress, uploadProgress, setUploadStatus,
  } = useAppStore();
  const [myVideos, setMyVideos] = useState<Video[]>([]);
  const [showPostForm, setShowPostForm] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loggedIn && user) loadMyVideos();
  }, [loggedIn, user]);

  useEffect(() => {
    // When Upload is requested from bottom nav again, always return to main Upload screen.
    setShowPostForm(false);
  }, [openToken]);

  const loadMyVideos = async () => {
    if (!user) return;
    const data = await apiFetch<PaginatedResponse<Video>>('/videos/user/' + user.id);
    if (data.success && data.data) setMyVideos(data.data.items || []);
  };

  const resetPostDraft = () => {
    setSelectedFile(null);
    setTitle('');
    setDescription('');
    setCategory('');
  };

  const openNewPostForm = () => {
    if (!loggedIn) { toast('Sign in to post'); onNav('login'); return; }
    resetPostDraft();
    setShowPostForm(true);
  };

  const pickFile = (file: File) => {
    setSelectedFile(file);
    setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').slice(0, TITLE_MAX_LENGTH));
    setShowPostForm(true);
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!loggedIn) { toast('Sign in to upload'); onNav('login'); return; }
    pickFile(file);
    e.target.value = '';
  };

  const handleCameraPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!loggedIn) { toast('Sign in to record'); onNav('login'); return; }
    pickFile(file);
    e.target.value = '';
  };

  const doPost = async () => {
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();

    if (!cleanTitle) { toast('Add a title first'); return; }
    if (cleanTitle.length > TITLE_MAX_LENGTH) { toast(`Title max ${TITLE_MAX_LENGTH} characters`); return; }
    if (cleanDescription.length > DESCRIPTION_MAX_LENGTH) { toast(`Description max ${DESCRIPTION_MAX_LENGTH} characters`); return; }
    if (!category) { toast('Select a category first'); return; }
    if (!selectedFile) { toast('Pick a video first'); return; }
    if (!loggedIn) { toast('Sign in first'); onNav('login'); return; }
    if (uploadInProgress) return;

    toast('Uploading...');
    setUploadStatus(true, 0);

    if (USE_CLOUDFLARE_STREAM_UPLOAD) {
      const prep = await apiFetch<{
        video_id: string;
        upload_url: string;
      }>('/videos/stream/direct-upload-url', {
        method: 'POST',
        body: JSON.stringify({
          title: cleanTitle,
          description: cleanDescription,
          talent_type: category,
          original_name: selectedFile.name,
          file_size: selectedFile.size,
        }),
      });

      if (!prep.success || !prep.data?.upload_url || !prep.data?.video_id) {
        setUploadStatus(false, 0);
        toast('Error: ' + (prep.error || 'Could not create Cloudflare upload URL'));
        return;
      }

      const direct = await uploadToDirectUrlWithProgress(
        prep.data.upload_url,
        selectedFile,
        (value) => setUploadStatus(true, value),
      );

      if (!direct.success) {
        setUploadStatus(false, 0);
        toast('Error: ' + direct.error);
        return;
      }

      let ready = false;
      for (let i = 0; i < 10; i += 1) {
        const done = await apiFetch<{ ready_to_stream?: boolean }>('/videos/stream/complete', {
          method: 'POST',
          body: JSON.stringify({
            video_id: prep.data.video_id,
            publish: true,
          }),
        });

        if (!done.success) break;
        if (done.data?.ready_to_stream) {
          ready = true;
          break;
        }
        await wait(1500);
      }

      setUploadStatus(true, 100);
      await wait(180);
      resetPostDraft();
      setShowPostForm(false);
      onNav('upload');
      toast(ready ? 'Video posted!' : 'Uploaded. Video is processing...');
      loadMyVideos();
      setUploadStatus(false, 0);
      return;
    }

    const form = new FormData();
    form.append('video', selectedFile);
    form.append('title', cleanTitle);
    form.append('description', cleanDescription);
    form.append('talent_type', category);

    const data = await uploadVideoWithProgress(form, (value) => setUploadStatus(true, value));
    if (!data.success) {
      setUploadStatus(false, 0);
      toast('Error: ' + data.error);
      return;
    }

    setUploadStatus(true, 100);
    await wait(180);
    resetPostDraft();
    setShowPostForm(false);
    onNav('upload');
    toast('Video posted!');
    loadMyVideos();
    setUploadStatus(false, 0);
  };

  const encodeTusMetadata = (key: string, value: string): string => {
    return `${key} ${btoa(unescape(encodeURIComponent(value)))}`;
  };

  const resolveTusLocation = (baseUrl: string, location: string): string => {
    try {
      return new URL(location, baseUrl).toString();
    } catch {
      return location;
    }
  };

  const uploadBinaryViaXhr = (
    method: 'PUT' | 'POST',
    targetUrl: string,
    file: File,
    onProgress: (value: number) => void,
  ): Promise<{ success: boolean; status?: number; error?: string }> => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, targetUrl);
      if (file.type) xhr.setRequestHeader('Content-Type', file.type);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        onProgress(pct);
      };

      xhr.onerror = () => resolve({ success: false, error: 'Cannot reach Cloudflare upload endpoint' });
      xhr.onabort = () => resolve({ success: false, error: 'Upload cancelled' });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve({ success: true, status: xhr.status });
          return;
        }
        resolve({ success: false, status: xhr.status, error: `Direct upload failed: HTTP ${xhr.status}` });
      };

      xhr.send(file);
    });
  };

  const uploadMultipartViaPost = (
    targetUrl: string,
    file: File,
    onProgress: (value: number) => void,
  ): Promise<{ success: boolean; status?: number; error?: string }> => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', targetUrl);
      const form = new FormData();
      form.append('file', file, file.name || 'upload.mp4');

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        onProgress(pct);
      };

      xhr.onerror = () => resolve({ success: false, error: 'Cannot reach Cloudflare upload endpoint' });
      xhr.onabort = () => resolve({ success: false, error: 'Upload cancelled' });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve({ success: true, status: xhr.status });
          return;
        }
        resolve({ success: false, status: xhr.status, error: `Direct upload failed: HTTP ${xhr.status}` });
      };

      xhr.send(form);
    });
  };

  const uploadTusPatch = (
    targetUrl: string,
    file: File,
    onProgress: (value: number) => void,
  ): Promise<{ success: boolean; status?: number; error?: string }> => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PATCH', targetUrl);
      xhr.setRequestHeader('Tus-Resumable', '1.0.0');
      xhr.setRequestHeader('Upload-Offset', '0');
      xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        onProgress(pct);
      };

      xhr.onerror = () => resolve({ success: false, error: 'Cannot reach Cloudflare upload endpoint' });
      xhr.onabort = () => resolve({ success: false, error: 'Upload cancelled' });
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201 || xhr.status === 204) {
          onProgress(100);
          resolve({ success: true, status: xhr.status });
          return;
        }
        resolve({ success: false, status: xhr.status, error: 'Direct upload failed: HTTP ' + xhr.status });
      };

      xhr.send(file);
    });
  };

  const uploadToDirectUrlWithProgress = async (
    uploadUrl: string,
    file: File,
    onProgress: (value: number) => void,
  ): Promise<{ success: boolean; error?: string }> => {
    // Try protocol variants because Stream direct upload behavior can differ by account configuration.
    // Order: PUT binary -> POST multipart -> TUS.
    const putResult = await uploadBinaryViaXhr('PUT', uploadUrl, file, onProgress);
    if (putResult.success) return { success: true };

    const postMultipartResult = await uploadMultipartViaPost(uploadUrl, file, onProgress);
    if (postMultipartResult.success) return { success: true };

    // Final fallback: Cloudflare Stream direct upload URL using TUS protocol.
    return new Promise((resolve) => {
      const create = new XMLHttpRequest();
      create.open('POST', uploadUrl);
      create.setRequestHeader('Tus-Resumable', '1.0.0');
      create.setRequestHeader('Upload-Length', String(file.size));
      create.setRequestHeader(
        'Upload-Metadata',
        [
          encodeTusMetadata('filename', file.name || 'upload.mp4'),
          encodeTusMetadata('filetype', file.type || 'application/octet-stream'),
        ].join(','),
      );

      create.onerror = () => resolve({ success: false, error: 'Cannot initialize Cloudflare direct upload' });
      create.onabort = () => resolve({ success: false, error: 'Upload cancelled' });
      create.onload = async () => {
        if (create.status === 201 || create.status === 204) {
          const location = create.getResponseHeader('Location');
          const patchUrl = resolveTusLocation(uploadUrl, location || uploadUrl);
          const result = await uploadTusPatch(patchUrl, file, onProgress);
          resolve(result);
          return;
        }
        // Some deployments return an already-created TUS resource URL.
        const fallback = await uploadTusPatch(uploadUrl, file, onProgress);
        if (fallback.success) {
          resolve({ success: true });
          return;
        }
        resolve({ success: false, error: fallback.error || postMultipartResult.error || putResult.error || 'Direct upload failed' });
      };

      create.send();
    });
  };

  const uploadVideoWithProgress = (
    form: FormData,
    onProgress: (value: number) => void
  ): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', API_BASE + '/videos');
      const token = localStorage.getItem('ts_token');
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        onProgress(pct);
      };

      xhr.onerror = () => resolve({ success: false, error: 'Cannot reach server' });
      xhr.onabort = () => resolve({ success: false, error: 'Upload cancelled' });
      xhr.onload = () => {
        const text = xhr.responseText || '';
        if (!text.trim()) {
          resolve({ success: false, error: 'Empty response' });
          return;
        }
        try {
          const parsed = JSON.parse(text) as { success?: boolean; error?: string };
          if (xhr.status >= 200 && xhr.status < 300 && parsed?.success) {
            resolve({ success: true });
            return;
          }
          resolve({ success: false, error: parsed?.error || 'Upload failed' });
        } catch {
          resolve({ success: false, error: 'Server error: ' + xhr.status });
        }
      };

      xhr.send(form);
    });
  };

  const deleteVideo = async (id: string) => {
    if (!confirm('Delete this video?')) return;
    await apiFetch('/videos/' + id, { method: 'DELETE' });
    loadMyVideos();
    toast('Video deleted');
  };

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleVideos = normalizedSearch
    ? myVideos.filter((v) => {
      const haystack = [
        v.title || '',
        v.description || '',
        Array.isArray(v.tags) ? v.tags.join(' ') : '',
        v.talent_type || '',
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    : myVideos;

  const playFromGrid = (index: number) => {
    const selected = visibleVideos[index];
    if (!selected) return;
    setFeedVideos(visibleVideos);
    setFeedIndex(index);
    setCurrentVideo(selected);
    onNav('home');
  };

  if (showPostForm) {
    return (
      <div className="pfs">
        <input type="file" ref={fileInputRef} accept="video/*" style={{ display: 'none' }} onChange={handleFilePick} />
        <input
          type="file"
          ref={cameraInputRef}
          accept="video/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleCameraPick}
        />
        <div className="pfh">
          <div className="bbtn" onClick={() => setShowPostForm(false)}>&#8592; Back</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>New Post</div>
          <div style={{ width: 60 }} />
        </div>
        <div className="pfs-body">
          <div className="pfpick-row">
            <button className="pfpick-btn" type="button" onClick={() => fileInputRef.current?.click()}>Pick from Gallery</button>
            <button className="pfpick-btn" type="button" onClick={() => cameraInputRef.current?.click()}>Use Camera</button>
          </div>
          <div className="pff">
            <input
              type="text"
              placeholder="Title..."
              value={title}
              maxLength={TITLE_MAX_LENGTH}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX_LENGTH))}
            />
          </div>
          <div className="pff">
            <textarea
              placeholder="Description..."
              value={description}
              maxLength={DESCRIPTION_MAX_LENGTH}
              onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX_LENGTH))}
            />
          </div>
          <div style={{ margin: '0 14px 14px', width: 'calc(100% - 28px)' }}>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              style={{ width: '100%', background: '#fff', borderRadius: 12, padding: '13px 16px', fontFamily: 'inherit', fontSize: 14, border: 'none', outline: 'none', color: '#444' }}>
              <option value="">Select category...</option>
              {TALENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="pfr">
            <div className="fn">{selectedFile?.name || 'No file selected'}</div>
          </div>
          <button className={`bpost ${uploadInProgress ? 'is-uploading' : ''}`} onClick={doPost} disabled={uploadInProgress}>
            {uploadInProgress ? `Uploading ${uploadProgress}%` : 'Post Video'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="us">
      <input type="file" ref={fileInputRef} accept="video/*" style={{ display: 'none' }} onChange={handleFilePick} />
      <input
        type="file"
        ref={cameraInputRef}
        accept="video/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleCameraPick}
      />

      {/* Upload actions */}
      <div className="uar">
        <div className="ubtn" onClick={() => { if (!loggedIn) { toast('Sign in to upload'); onNav('login'); return; } fileInputRef.current?.click(); }}>
          <div className="uic">
            <img
              className="uic-img"
              src={GALLERY_UPLOAD_ICON}
              alt="Gallery"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                const fb = (e.currentTarget.nextElementSibling as HTMLElement | null);
                if (fb) fb.style.display = 'inline';
              }}
            />
            <span className="uic-fallback" style={{ display: 'none' }} aria-hidden>&#128193;</span>
          </div>
          <div className="ulbl">Gallery</div>
        </div>
        <div className="ubtn" onClick={() => { if (!loggedIn) { toast('Sign in to record'); onNav('login'); return; } cameraInputRef.current?.click(); }}>
          <div className="uic">
            <img
              className="uic-img"
              src={CAMERA_UPLOAD_ICON}
              alt="Camera"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                const fb = (e.currentTarget.nextElementSibling as HTMLElement | null);
                if (fb) fb.style.display = 'inline';
              }}
            />
            <span className="uic-fallback" style={{ display: 'none' }} aria-hidden>&#127909;</span>
          </div>
          <div className="ulbl">Camera</div>
        </div>
        <div className="ubtn" onClick={openNewPostForm}>
          <div className="uic">
            <span className="uic-plus" aria-hidden>+</span>
          </div>
          <div className="ulbl">Post</div>
        </div>
      </div>

      {/* Search */}
      <div className="usrch">
        <input
          type="text"
          placeholder="Search your videos..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="stitle">Your videos</div>

      {/* My videos grid */}
      <div className="vg" id="upG">
        {myVideos.length === 0 ? (
          <div style={{ gridColumn: '1/-1', padding: 24, textAlign: 'center', color: '#555', fontSize: 14 }}>Nothing here yet</div>
        ) : visibleVideos.length === 0 ? (
          <div style={{ gridColumn: '1/-1', padding: 24, textAlign: 'center', color: '#777', fontSize: 14 }}>No videos found</div>
        ) : visibleVideos.map((v, i) => (
          <div className={`vgi ${BG[i % BG.length]}`} key={v.id} style={{ position: 'relative', cursor: 'pointer' }}
            onClick={() => playFromGrid(i)}>
            <video src={v.file_url} preload="metadata" muted playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0, pointerEvents: 'none' }}
              onLoadedMetadata={(e) => { (e.target as HTMLVideoElement).currentTime = 1; }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ minWidth: 118, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 12px', color: '#fff', fontSize: 11, fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,.7)', background: 'rgba(16, 16, 16, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', backdropFilter: 'blur(6px)' }}>
                <span style={{ lineHeight: 1.1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <img
                    src="/icons/like.png"
                    alt=""
                    style={{ width: 14, height: 14, objectFit: 'contain' }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fb) fb.style.display = 'inline';
                    }}
                  />
                  <span aria-hidden style={{ display: 'none' }}>&#128077;</span>
                  <span>{v.likes || 0}</span>
                </span>
                <span style={{ lineHeight: 1.1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <img
                    src="/icons/dislike.png"
                    alt=""
                    style={{ width: 14, height: 14, objectFit: 'contain' }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fb) fb.style.display = 'inline';
                    }}
                  />
                  <span aria-hidden style={{ display: 'none' }}>&#128078;</span>
                  <span>{v.dislikes || 0}</span>
                </span>
                <span style={{ lineHeight: 1.1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <img
                    src="/icons/views.png"
                    alt=""
                    style={{ width: 14, height: 14, objectFit: 'contain' }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fb) fb.style.display = 'inline';
                    }}
                  />
                  <span aria-hidden style={{ display: 'none' }}>&#128065;</span>
                  <span>{v.views || 0}</span>
                </span>
              </span>
            </div>
            <div className="dw">
              <button className="delbtn" onClick={(e) => { e.stopPropagation(); deleteVideo(v.id); }} aria-label="Delete video" title="Delete video">
                <img src="/icons/bin.png" alt="Delete" style={{ width: 16, height: 16, objectFit: 'contain' }} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
