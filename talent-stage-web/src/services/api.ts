import type { ApiResponse } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.web-demo.space/api';
export const MAINTENANCE_EVENT = 'ts:maintenance-mode';
const LOCALHOST_URL_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
const ABSOLUTE_HTTP_URL_RE = /^https?:\/\//i;
const DATA_OR_BLOB_URL_RE = /^(?:data|blob):/i;
const MEDIA_URL_KEYS = new Set(['file_url', 'thumbnail_url', 'avatar_url']);
const STREAM_MANIFEST_RE = /^https?:\/\/(?:iframe\.)?videodelivery\.net\/[^?#]+\/manifest\/video\.m3u8(?:[?#].*)?$/i;
const CFSTREAM_REL_RE = /^\/?uploads\/videos\/cfstream:([a-z0-9_-]+)(?:[?#].*)?$/i;
const CFSTREAM_ABS_RE = /^https?:\/\/[^/]+\/uploads\/videos\/cfstream:([a-z0-9_-]+)(?:[?#].*)?$/i;
const CFSTREAM_DIRECT_RE = /^cfstream:([a-z0-9_-]+)$/i;

interface NetworkConnectionLike {
  type?: string;
  effectiveType?: string;
}

const getBandwidthHintByNetwork = (): string | null => {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & {
    connection?: NetworkConnectionLike;
    mozConnection?: NetworkConnectionLike;
    webkitConnection?: NetworkConnectionLike;
  };
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (!connection) return null;

  const type = String(connection.type || '').toLowerCase();
  const effectiveType = String(connection.effectiveType || '').toLowerCase();

  // Requested mapping:
  // Wi-Fi -> 2.4 Mbps (480p range)
  // 5G   -> 1.0 Mbps (360p range)
  // 4G   -> 0.8 Mbps (Stream often still picks 360p)
  if (type === 'wifi') return '2.4';
  if (effectiveType === '5g') return '1.0';
  if (effectiveType === '4g') return '0.8';
  return null;
};

const applyStreamBandwidthHint = (url: string | null | undefined): string | null | undefined => {
  if (!url || !STREAM_MANIFEST_RE.test(url)) return url;
  const hint = getBandwidthHintByNetwork();
  if (!hint) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('clientBandwidthHint', hint);
    return parsed.toString();
  } catch {
    return url;
  }
};

const normalizeCfstreamUrl = (url: string | null | undefined): string | null | undefined => {
  if (!url) return url;
  const clean = String(url).trim();
  const direct = clean.match(CFSTREAM_DIRECT_RE)?.[1];
  if (direct) return `https://videodelivery.net/${direct}/manifest/video.m3u8`;
  const rel = clean.match(CFSTREAM_REL_RE)?.[1];
  if (rel) return `https://videodelivery.net/${rel}/manifest/video.m3u8`;
  const abs = clean.match(CFSTREAM_ABS_RE)?.[1];
  if (abs) return `https://videodelivery.net/${abs}/manifest/video.m3u8`;
  return url;
};

const getMediaBase = (): string => {
  if (ABSOLUTE_HTTP_URL_RE.test(API_BASE)) {
    return API_BASE.replace(/\/api\/?$/, '');
  }
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
};

export const normalizeMediaUrl = (url: string | null | undefined): string | null | undefined => {
  if (!url) return url;
  if (DATA_OR_BLOB_URL_RE.test(url)) return url;
  const normalizedCfstream = normalizeCfstreamUrl(url);
  if (normalizedCfstream !== url) return normalizedCfstream;
  if (!ABSOLUTE_HTTP_URL_RE.test(url)) {
    const mediaBase = getMediaBase();
    if (!mediaBase) return url;
    const rel = url.startsWith('/') ? url : '/' + url;
    return mediaBase + rel;
  }
  if (!LOCALHOST_URL_RE.test(url)) return url;
  const mediaBase = getMediaBase();
  if (!mediaBase) return url;
  return url.replace(LOCALHOST_URL_RE, mediaBase);
};

const normalizeMediaUrlsInPayload = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizeMediaUrlsInPayload);

  const record = value as Record<string, unknown>;
  for (const [key, fieldValue] of Object.entries(record)) {
    if (MEDIA_URL_KEYS.has(key) && typeof fieldValue === 'string') {
      let normalizedFieldValue = fieldValue.trim();
      if (
        key === 'avatar_url'
        && normalizedFieldValue
      ) {
        record[key] = null;
        continue;
      }
      const mediaUrl = normalizeMediaUrl(normalizedFieldValue);
      record[key] = key === 'file_url'
        ? applyStreamBandwidthHint(mediaUrl)
        : mediaUrl;
      continue;
    }
    if (fieldValue && typeof fieldValue === 'object') {
      record[key] = normalizeMediaUrlsInPayload(fieldValue);
    }
  }
  return record;
};

const emitMaintenanceMode = (active: boolean, message = ''): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT, { detail: { active, message } }));
};

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit & { body?: BodyInit | Record<string, unknown> | null } = {},
): Promise<ApiResponse<T>> {
  const isForm = opts.body instanceof FormData;
  const headers: Record<string, string> = isForm ? {} : { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('ts_token');
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const fetchOpts: RequestInit = {
    ...opts,
    headers: { ...headers, ...(opts.headers as Record<string, string> || {}) },
  };

  if (opts.body && !isForm && typeof opts.body === 'object' && !(opts.body instanceof Blob)) {
    fetchOpts.body = JSON.stringify(opts.body);
  }

  try {
    const res = await fetch(API_BASE + path, fetchOpts);
    const text = await res.text();
    if (!text || text.trim() === '') return { success: false, error: 'Empty response' };
    try {
      const parsed = JSON.parse(text) as ApiResponse<T>;
      if (res.status === 503) {
        emitMaintenanceMode(true, parsed.error || 'We are currently doing maintenance. Please try again later.');
      }
      return normalizeMediaUrlsInPayload(parsed) as ApiResponse<T>;
    } catch {
      console.error('Non-JSON response from', path, ':', text.slice(0, 200));
      if (res.status === 503) {
        emitMaintenanceMode(true, 'We are currently doing maintenance. Please try again later.');
      }
      return { success: false, error: 'Server error: ' + res.status };
    }
  } catch (e) {
    console.error('Network error:', (e as Error).message);
    return { success: false, error: 'Cannot reach server' };
  }
}
