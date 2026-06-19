import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

const ABS_HTTP_URL_RE = /^https?:\/\//i;
const DATA_OR_BLOB_URL_RE = /^(?:data|blob):/i;
const IMAGE_EXT_RE = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const CFSTREAM_DIRECT_RE = /^cfstream:([a-z0-9_-]+)$/i;
const CFSTREAM_UPLOAD_PATH_RE = /\/uploads\/videos\/cfstream:([a-z0-9_-]+)(?:[/?#].*)?$/i;

const getDefaultAdminApiBase = (): string => {
  if (typeof window !== 'undefined') {
    const host = String(window.location.hostname || '').toLowerCase();
    if (host === 'admin.web-demo.space') {
      return 'https://api.web-demo.space/api/admin';
    }
  }
  return '/api/admin';
};

const rawApiBase = String(import.meta.env.VITE_API_URL || getDefaultAdminApiBase()).trim();

const withAdminSegment = (path: string): string => {
  const clean = path.replace(/\/+$/, '');
  if (clean === '' || clean === '/') return '/api/admin';
  if (clean === '/api' || clean === '/api/') return '/api/admin';
  if (clean.endsWith('/api/admin')) return clean;
  return clean;
};

const normalizeApiBase = (base: string): string => {
  if (ABS_HTTP_URL_RE.test(base)) {
    try {
      const parsed = new URL(base);
      parsed.pathname = withAdminSegment(parsed.pathname);
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return base.replace(/\/+$/, '');
    }
  }
  const clean = '/' + base.replace(/^\/+/, '').replace(/\/+$/, '');
  return withAdminSegment(clean);
};

export const ADMIN_API_BASE = normalizeApiBase(rawApiBase);

const getApiOrigin = (): string => {
  if (ABS_HTTP_URL_RE.test(ADMIN_API_BASE)) {
    try {
      return new URL(ADMIN_API_BASE).origin;
    } catch {
      return '';
    }
  }
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
};

export const API_ORIGIN = getApiOrigin();

function toCloudflareStreamUrl(raw: string): string {
  const clean = raw.trim();
  const directMatch = clean.match(CFSTREAM_DIRECT_RE);
  if (directMatch?.[1]) return `https://iframe.videodelivery.net/${directMatch[1]}`;

  const pathMatch = clean.match(CFSTREAM_UPLOAD_PATH_RE);
  if (pathMatch?.[1]) return `https://iframe.videodelivery.net/${pathMatch[1]}`;

  return '';
}

export function toMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  const clean = url.trim();
  const cfUrl = toCloudflareStreamUrl(clean);
  if (cfUrl) return cfUrl;

  if (ABS_HTTP_URL_RE.test(clean) || DATA_OR_BLOB_URL_RE.test(clean)) return clean;
  let rel = clean.startsWith('/') ? clean : '/' + clean;

  // Backend may return avatar filename only (without uploads path).
  if (!clean.startsWith('/') && !clean.includes('/') && IMAGE_EXT_RE.test(clean)) {
    rel = '/uploads/avatars/' + clean;
  }

  return API_ORIGIN ? API_ORIGIN + rel : rel;
}

export function useApi() {
  const { token, logout } = useAuth();

  const api = useCallback(async <T = any>(method: string, path: string, body?: any): Promise<{ success: boolean; data?: T; error?: string }> => {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers: Record<string, string> = {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    };
    if (!isFormData) headers['Content-Type'] = 'application/json';
    const opts: RequestInit = {
      method,
      headers,
    };
    if (body !== undefined && body !== null) {
      opts.body = isFormData ? body : JSON.stringify(body);
    }
    try {
      const r = await fetch(ADMIN_API_BASE + path, opts);
      if (r.status === 401) { logout(); return { success: false, error: 'Session expired' }; }
      const j = await r.json();
      return j;
    } catch {
      return { success: false, error: 'Network error' };
    }
  }, [token, logout]);

  return api;
}
