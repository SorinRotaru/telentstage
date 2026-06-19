#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const TALENT_TYPES = [
  'Singer',
  'Dancer',
  'Rapper',
  'Comedian',
  'Actor',
  'Musician',
  'Magician',
  'Athlete',
  'Visual Artist',
  'Unique Talent',
  'Acrobat',
  'Impressionist',
  'Ventriloquist',
  'Martial Artist',
  'Variety',
  'Viewer',
];

const USERNAME_MAX_LEN = 30;
const TITLE_MAX_LEN = 100;

const DEFAULTS = {
  apiBase: process.env.SEED_API_BASE || 'http://localhost:3000/api',
  users: Number(process.env.SEED_USERS || 10),
  videos: Number(process.env.SEED_VIDEOS || 100),
  password: process.env.SEED_PASSWORD || 'qawsedrf',
  emailDomain: process.env.SEED_EMAIL_DOMAIN || 'seed.local',
  usernamePrefix: process.env.SEED_USERNAME_PREFIX || 'seeduser',
  videoDir: process.env.SEED_VIDEO_DIR || './uploads/videos',
  avatarDir: process.env.SEED_AVATAR_DIR || './avatars',
  avatarEndpoint: process.env.SEED_AVATAR_ENDPOINT || '/users/me/avatar',
  delayMs: Number(process.env.SEED_DELAY_MS || 120),
  uploadTimeoutMs: Number(process.env.SEED_UPLOAD_TIMEOUT_MS || 300000),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '',
  deepseekModel: process.env.SEED_DEEPSEEK_MODEL || 'deepseek-chat',
  deepseekTimeoutMs: Number(process.env.SEED_DEEPSEEK_TIMEOUT_MS || 20000),
  runStamp: process.env.SEED_RUN_STAMP || '',
  streamUploads: String(process.env.SEED_STREAM_UPLOADS || '').toLowerCase() === 'true',
  streamCompleteAttempts: Number(process.env.SEED_STREAM_COMPLETE_ATTEMPTS || 20),
  streamCompleteDelayMs: Number(process.env.SEED_STREAM_COMPLETE_DELAY_MS || 1500),
};

function parseArgs(argv) {
  const out = {
    ...DEFAULTS,
    dryRun: false,
    help: false,
    loginOnly: false,
    streamUploads: DEFAULTS.streamUploads,
    streamCompleteAttempts: DEFAULTS.streamCompleteAttempts,
    streamCompleteDelayMs: DEFAULTS.streamCompleteDelayMs,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--api-base') out.apiBase = argv[++i];
    else if (a === '--users') out.users = Number(argv[++i]);
    else if (a === '--videos') out.videos = Number(argv[++i]);
    else if (a === '--password') out.password = argv[++i];
    else if (a === '--email-domain') out.emailDomain = argv[++i];
    else if (a === '--username-prefix') out.usernamePrefix = argv[++i];
    else if (a === '--video-dir') out.videoDir = argv[++i];
    else if (a === '--avatar-dir') out.avatarDir = argv[++i];
    else if (a === '--avatar-endpoint') out.avatarEndpoint = argv[++i];
    else if (a === '--delay-ms') out.delayMs = Number(argv[++i]);
    else if (a === '--upload-timeout-ms') out.uploadTimeoutMs = Number(argv[++i]);
    else if (a === '--deepseek-api-key') out.deepseekApiKey = argv[++i];
    else if (a === '--deepseek-model') out.deepseekModel = argv[++i];
    else if (a === '--deepseek-timeout-ms') out.deepseekTimeoutMs = Number(argv[++i]);
    else if (a === '--run-stamp') out.runStamp = argv[++i];
    else if (a === '--login-only') out.loginOnly = true;
    else if (a === '--stream') out.streamUploads = true;
    else if (a === '--stream-complete-attempts') out.streamCompleteAttempts = Number(argv[++i]);
    else if (a === '--stream-complete-delay-ms') out.streamCompleteDelayMs = Number(argv[++i]);
    // Backward compatibility aliases (deprecated)
    else if (a === '--openai-api-key') out.deepseekApiKey = argv[++i];
    else if (a === '--openai-model') out.deepseekModel = argv[++i];
    else if (a === '--openai-timeout-ms') out.deepseekTimeoutMs = Number(argv[++i]);
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

function printHelp() {
  console.log(`Seed users and videos

Usage:
  node scripts/seed-users-videos.mjs [options]

Options:
  --api-base <url>         API base URL (default: ${DEFAULTS.apiBase})
  --users <n>              Number of users to create (default: ${DEFAULTS.users})
  --videos <n>             Number of videos to upload (default: ${DEFAULTS.videos})
  --password <text>        Password for seeded users (default: ${DEFAULTS.password})
  --email-domain <domain>  Email domain for users (default: ${DEFAULTS.emailDomain})
  --username-prefix <txt>  Username prefix (default: ${DEFAULTS.usernamePrefix})
  --video-dir <path>       Folder with source videos (default: ${DEFAULTS.videoDir})
  --avatar-dir <path>      Folder with source avatars (default: ${DEFAULTS.avatarDir})
  --avatar-endpoint <path> Avatar upload endpoint (default: ${DEFAULTS.avatarEndpoint})
  --delay-ms <n>           Delay between uploads (default: ${DEFAULTS.delayMs})
  --upload-timeout-ms <n>  Timeout per upload request (default: ${DEFAULTS.uploadTimeoutMs})
  --deepseek-api-key <key> DeepSeek API key for AI title/tags (default: env DEEPSEEK_API_KEY)
  --deepseek-model <name>  DeepSeek model (default: ${DEFAULTS.deepseekModel})
  --deepseek-timeout-ms <n> DeepSeek request timeout (default: ${DEFAULTS.deepseekTimeoutMs})
  --run-stamp <stamp>      Reuse existing seed usernames for this run stamp (example: 202603051557)
  --login-only             Login existing users only (do not create users)
  --stream                 Upload videos via Cloudflare Stream direct-upload endpoints
  --stream-complete-attempts <n> Poll attempts for /videos/stream/complete (default: ${DEFAULTS.streamCompleteAttempts})
  --stream-complete-delay-ms <n> Delay between complete polls in ms (default: ${DEFAULTS.streamCompleteDelayMs})
  --openai-*               Backward-compatible aliases for deepseek flags
  --dry-run                Validate inputs and show plan only
  --help                   Show this help

Example:
  npm run seed:users-videos -- --api-base https://api.web-demo.space/api --users 10 --videos 100 --video-dir ./uploads/videos
`);
}

function normalizeApiBase(raw) {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Missing --api-base');
  if (trimmed.endsWith('/api')) return trimmed;
  return `${trimmed}/api`;
}

function normalizePathSuffix(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
}

function normalizeUsernamePrefix(raw) {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'seeduser';
}

function makeUsername(prefix, runStamp, seq) {
  const suffix = `${runStamp}${seq}`; // Always unique per run/index.
  const maxPrefixLen = Math.max(1, USERNAME_MAX_LEN - suffix.length - 1);
  const safePrefix = normalizeUsernamePrefix(prefix).slice(0, maxPrefixLen);
  return `${safePrefix}_${suffix}`.slice(0, USERNAME_MAX_LEN);
}

function limitText(input, maxChars) {
  const text = String(input || '').trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trim();
}

function extractWords(input) {
  return String(input || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => /[a-z]/i.test(word))
    .filter((word) => word.length > 1)
    .filter((word) => !/^[a-f0-9]{8,}$/i.test(word))
    .filter((word) => !/^\d+$/.test(word));
}

function dedupeWords(words) {
  const out = [];
  const seen = new Set();
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

function toTitleCase(phrase) {
  return String(phrase || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ')
    .trim();
}

function buildPhraseTitle({ rawTitle, baseName, talentType }) {
  const fallbackWords = ['creative', 'talent', 'showcase', 'performance', 'moment'];
  const words = dedupeWords([
    ...extractWords(rawTitle),
    ...extractWords(baseName),
    ...extractWords(talentType),
    ...fallbackWords,
  ]).slice(0, 14);

  const minWords = 5;
  while (words.length < minWords) {
    words.push(fallbackWords[words.length % fallbackWords.length]);
  }

  const phrase = toTitleCase(words.join(' '));
  const limited = limitText(phrase, TITLE_MAX_LEN);
  if (limited.length >= 8) return limited;
  return 'Creative Talent Showcase Performance Moment';
}

function sanitizeTags(inputTags, talentType) {
  const fallback = ['seed', 'talent', String(talentType || '').toLowerCase().replace(/\s+/g, '-')].filter(Boolean);
  const source = Array.isArray(inputTags) ? inputTags : String(inputTags || '').split(',');
  const tags = source
    .map((tag) => String(tag || '').trim().toLowerCase())
    .filter(Boolean)
    .map((tag) => tag.replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, '-'))
    .filter(Boolean);
  const deduped = [];
  for (const t of [...tags, ...fallback]) {
    if (!deduped.includes(t)) deduped.push(t);
    if (deduped.length >= 8) break;
  }
  return deduped;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectVideoFiles(videoDir) {
  const allowed = new Set(['.mp4', '.mov', '.m4v', '.webm']);
  const names = await fs.readdir(videoDir);
  const files = names
    .map((name) => path.join(videoDir, name))
    .filter((p) => allowed.has(path.extname(p).toLowerCase()));
  files.sort();
  return files;
}

async function collectAvatarFiles(avatarDir) {
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  try {
    const names = await fs.readdir(avatarDir);
    const files = names
      .map((name) => path.join(avatarDir, name))
      .filter((p) => allowed.has(path.extname(p).toLowerCase()));
    files.sort();
    return files;
  } catch {
    return [];
  }
}

function getMimeTypeForVideo(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  return 'application/octet-stream';
}

function getMimeTypeForImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

async function fileToBlob(filePath, mime) {
  if (typeof fs.openAsBlob === 'function') {
    return fs.openAsBlob(filePath, { type: mime });
  }
  const buf = await fs.readFile(filePath);
  return new Blob([buf], { type: mime });
}

async function fetchJson(url, options = {}) {
  const { timeoutMs: timeoutOption, ...fetchOptions } = options;
  const timeoutMs = Number(timeoutOption || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  let timer = null;
  if (controller) {
    timer = setTimeout(() => controller.abort(`timeout_${timeoutMs}ms`), timeoutMs);
  }

  let res;
  try {
    res = await fetch(url, {
      ...fetchOptions,
      signal: controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

async function generateMetadataWithDeepSeek({
  apiKey,
  model,
  timeoutMs,
  baseName,
  talentType,
}) {
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`deepseek_timeout_${timeoutMs}ms`), timeoutMs);

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        messages: [
          {
            role: 'system',
            content: 'You generate short, catchy video metadata. Return strict JSON only.',
          },
          {
            role: 'user',
            content: `Create metadata for a ${talentType} video named "${baseName}".
Rules:
- title must be a natural phrase made of words only (no IDs, no filenames, no hashtags, no emojis)
- title max ${TITLE_MAX_LEN} chars
- title should be 5-12 words
- tags: 4-8 concise lowercase tags
Return JSON: {"title":"...", "tags":["tag1","tag2"]}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`DeepSeek HTTP ${res.status}: ${text}`);
    }
    const parsed = text ? JSON.parse(text) : null;
    const content = parsed?.choices?.[0]?.message?.content;
    if (!content) return null;
    const payload = JSON.parse(content);
    const title = buildPhraseTitle({
      rawTitle: payload?.title || '',
      baseName,
      talentType,
    });
    const tags = sanitizeTags(payload?.tags || [], talentType);
    if (!title) return null;
    return { title, tags };
  } catch (err) {
    console.warn(`[ai] metadata fallback: ${err?.message || err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fallbackMetadata({ baseName, uploadIndex, talentType }) {
  void uploadIndex;
  const title = buildPhraseTitle({
    rawTitle: `${talentType} ${baseName}`,
    baseName,
    talentType,
  });
  const tags = sanitizeTags(
    ['seed', 'test', String(talentType || '').toLowerCase().replace(/\s+/g, '-')],
    talentType
  );
  return { title, tags };
}

async function registerOrLoginUser({
  apiBase,
  index,
  total,
  password,
  emailDomain,
  usernamePrefix,
  runStamp,
  loginOnly,
}) {
  const seq = String(index + 1).padStart(2, '0');
  const username = makeUsername(usernamePrefix, runStamp, seq);
  const email = `${username}@${emailDomain}`.toLowerCase();
  const talent_type = TALENT_TYPES[index % TALENT_TYPES.length];
  const full_name = `Seed User ${index + 1}`;

  if (loginOnly) {
    const login = await fetchJson(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (login.ok && login.data?.data?.token) {
      console.log(`[user ${index + 1}/${total}] reused ${email}`);
      return {
        id: login.data?.data?.user?.id,
        username,
        email,
        token: login.data.data.token,
        talent_type,
      };
    }
    const loginErrText = login.data?.error || login.data?.message || JSON.stringify(login.data);
    throw new Error(`User ${index + 1} login failed (${email}): ${loginErrText}`);
  }

  const registerBody = JSON.stringify({
    username,
    email,
    password,
    full_name,
    talent_type,
  });

  const reg = await fetchJson(`${apiBase}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: registerBody,
  });

  if (reg.ok && reg.data?.data?.token) {
    console.log(`[user ${index + 1}/${total}] created ${email}`);
    return {
      id: reg.data?.data?.user?.id,
      username,
      email,
      token: reg.data.data.token,
      talent_type,
    };
  }

  if (reg.status === 409) {
    const login = await fetchJson(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (login.ok && login.data?.data?.token) {
      console.log(`[user ${index + 1}/${total}] reused ${email}`);
      return {
        id: login.data?.data?.user?.id,
        username,
        email,
        token: login.data.data.token,
        talent_type,
      };
    }
  }

  const errText = reg.data?.error || reg.data?.message || JSON.stringify(reg.data);
  throw new Error(`User ${index + 1} failed (${email}): ${errText}`);
}

async function uploadAvatarForUser({ apiBase, avatarEndpoint, token, avatarPath }) {
  if (!avatarPath || !token) return { ok: false, skipped: true };

  const normalized = normalizePathSuffix(avatarEndpoint || '/users/me/avatar') || '/users/me/avatar';
  const endpointCandidates = normalized === '/users/me/avatar'
    ? ['/users/me/avatar', '/auth/me/avatar']
    : [normalized];
  const methods = ['POST', 'PUT'];

  let lastResponse = { ok: false, data: { error: 'Avatar upload failed' } };

  for (const endpoint of endpointCandidates) {
    for (const method of methods) {
      const avatarUrl = `${apiBase}${endpoint}`;
      const form = new FormData();
      const blob = await fileToBlob(avatarPath, getMimeTypeForImage(avatarPath));
      form.append('avatar', blob, path.basename(avatarPath));

      // eslint-disable-next-line no-await-in-loop
      const response = await fetchJson(avatarUrl, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (response.ok) return response;

      lastResponse = response;
      const msg = String(response.data?.error || response.data?.message || '');
      const isRouteOrMethodIssue =
        response.status === 404
        || response.status === 405
        || /route not found/i.test(msg)
        || /cannot .* (post|put)/i.test(msg);
      if (!isRouteOrMethodIssue) return response;
    }
  }

  return lastResponse;
}

async function uploadOneVideo({ apiBase, token, title, description, tags, talent_type, filePath, timeoutMs }) {
  const form = new FormData();
  form.append('title', title);
  form.append('description', description);
  form.append('tags', tags);
  form.append('talent_type', talent_type);
  const blob = await fileToBlob(filePath, getMimeTypeForVideo(filePath));
  form.append('video', blob, path.basename(filePath));

  return fetchJson(`${apiBase}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    timeoutMs,
  });
}

function toBase64Utf8(input) {
  return Buffer.from(String(input || ''), 'utf8').toString('base64');
}

async function uploadBinary(url, blob, mime, timeoutMs, method = 'PUT') {
  return fetchJson(url, {
    method,
    headers: mime ? { 'Content-Type': mime } : undefined,
    body: blob,
    timeoutMs,
  });
}

async function uploadMultipart(url, blob, filePath, timeoutMs) {
  const form = new FormData();
  form.append('file', blob, path.basename(filePath));
  return fetchJson(url, {
    method: 'POST',
    body: form,
    timeoutMs,
  });
}

async function uploadTus(url, blob, filePath, mime, timeoutMs) {
  const create = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(blob.size || 0),
      'Upload-Metadata': `filename ${toBase64Utf8(path.basename(filePath))},filetype ${toBase64Utf8(mime || 'application/octet-stream')}`,
    },
    timeoutMs,
  });

  let patchUrl = url;
  const location = create?.data?.location || create?.data?.Location;
  if (location && typeof location === 'string') {
    patchUrl = new URL(location, url).toString();
  }

  return fetchJson(patchUrl, {
    method: 'PATCH',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
    },
    body: blob,
    timeoutMs,
  });
}

async function uploadOneVideoViaStream({
  apiBase,
  token,
  title,
  description,
  tags,
  talent_type,
  filePath,
  timeoutMs,
  completeAttempts,
  completeDelayMs,
}) {
  const mime = getMimeTypeForVideo(filePath);
  const blob = await fileToBlob(filePath, mime);
  const direct = await fetchJson(`${apiBase}/videos/stream/direct-upload-url`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      description,
      tags,
      talent_type,
      original_name: path.basename(filePath),
      file_size: blob.size || 0,
    }),
    timeoutMs,
  });

  if (!direct.ok) return direct;
  const uploadUrl = direct.data?.data?.upload_url;
  const videoId = direct.data?.data?.video_id;
  if (!uploadUrl || !videoId) {
    return { ok: false, status: 502, data: { error: 'Missing upload_url/video_id from direct upload response' } };
  }

  // Try multiple protocols to match account/direct-upload behavior.
  let uploaded = await uploadBinary(uploadUrl, blob, mime, timeoutMs, 'PUT');
  if (!uploaded.ok) uploaded = await uploadMultipart(uploadUrl, blob, filePath, timeoutMs);
  if (!uploaded.ok) uploaded = await uploadTus(uploadUrl, blob, filePath, mime, timeoutMs);
  if (!uploaded.ok) return uploaded;

  let lastComplete = null;
  const attempts = Math.max(1, Number(completeAttempts || 1));
  const delayMs = Math.max(0, Number(completeDelayMs || 0));
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const complete = await fetchJson(`${apiBase}/videos/stream/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_id: videoId,
        publish: true,
      }),
      timeoutMs,
    });
    lastComplete = complete;
    if (!complete.ok) return complete;

    const ready =
      complete.data?.data?.ready_to_stream === true
      || complete.data?.data?.is_public === true
      || complete.data?.data?.status === 'ready';
    if (ready) return complete;

    if (i < attempts - 1 && delayMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }
  }

  return {
    ok: false,
    status: 408,
    data: {
      error: `Stream upload completed but not ready after ${attempts} checks`,
      last_complete_response: lastComplete?.data || null,
      video_id: videoId,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!Number.isInteger(args.users) || args.users <= 0) throw new Error('--users must be > 0');
  if (!Number.isInteger(args.videos) || args.videos <= 0) throw new Error('--videos must be > 0');
  if (String(args.password).length < 8) throw new Error('--password must be at least 8 characters');
  if (!args.emailDomain.includes('.')) throw new Error('--email-domain must be a domain');
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) throw new Error('--delay-ms must be >= 0');
  if (!Number.isFinite(args.uploadTimeoutMs) || args.uploadTimeoutMs <= 0) {
    throw new Error('--upload-timeout-ms must be > 0');
  }
  if (!Number.isFinite(args.streamCompleteAttempts) || args.streamCompleteAttempts <= 0) {
    throw new Error('--stream-complete-attempts must be > 0');
  }
  if (!Number.isFinite(args.streamCompleteDelayMs) || args.streamCompleteDelayMs < 0) {
    throw new Error('--stream-complete-delay-ms must be >= 0');
  }
  if (!Number.isFinite(args.deepseekTimeoutMs) || args.deepseekTimeoutMs <= 0) {
    throw new Error('--deepseek-timeout-ms must be > 0');
  }
  if (args.runStamp && !/^[0-9]{8,20}$/.test(String(args.runStamp))) {
    throw new Error('--run-stamp must be digits only (example: 202603051557)');
  }
  if (args.loginOnly && !String(args.runStamp || '').trim()) {
    throw new Error('--login-only requires --run-stamp so the script can target existing users');
  }

  const apiBase = normalizeApiBase(args.apiBase);
  const avatarEndpoint = normalizePathSuffix(args.avatarEndpoint);
  const videoDir = path.resolve(process.cwd(), args.videoDir);
  const avatarDir = path.resolve(process.cwd(), args.avatarDir);
  const sourceVideos = await collectVideoFiles(videoDir);
  const avatarFiles = await collectAvatarFiles(avatarDir);
  if (sourceVideos.length === 0) {
    throw new Error(`No source videos found in ${videoDir}`);
  }
  if (avatarFiles.length === 0) {
    console.warn(`[seed] no avatars found in ${avatarDir}; users will be created without avatar upload.`);
  }

  const runStamp = String(args.runStamp || '').trim()
    || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);

  console.log('Seed config');
  console.log(`- API base:      ${apiBase}`);
  console.log(`- Users:         ${args.users}`);
  console.log(`- Videos:        ${args.videos}`);
  console.log(`- Password:      ${'*'.repeat(Math.min(String(args.password).length, 12))}`);
  console.log(`- Video dir:     ${videoDir}`);
  console.log(`- Source videos: ${sourceVideos.length}`);
  console.log(`- Avatar dir:    ${avatarDir}`);
  console.log(`- Avatars:       ${avatarFiles.length}`);
  console.log(`- Avatar API:    ${avatarEndpoint || '(disabled)'}`);
  console.log(`- DeepSeek model: ${args.deepseekModel}`);
  console.log(`- DeepSeek:      ${args.deepseekApiKey ? 'enabled' : 'disabled (fallback titles/tags)'}`);
  console.log(`- Run stamp:     ${runStamp}`);
  console.log(`- Users mode:    ${args.loginOnly ? 'login-only (reuse existing)' : 'create-or-reuse'}`);
  console.log(`- Upload mode:   ${args.streamUploads ? 'cloudflare-stream' : 'api-multipart'}`);
  if (args.streamUploads) {
    console.log(`- Stream checks: ${args.streamCompleteAttempts} attempts x ${args.streamCompleteDelayMs}ms`);
  }
  console.log(`- Delay:         ${args.delayMs} ms`);
  console.log(`- Timeout:       ${args.uploadTimeoutMs} ms/upload`);

  if (args.dryRun) {
    console.log('\nDry run complete. No users/videos were created.');
    return;
  }

  const users = [];
  for (let i = 0; i < args.users; i += 1) {
    const user = await registerOrLoginUser({
      apiBase,
      index: i,
      total: args.users,
      password: args.password,
      emailDomain: args.emailDomain,
      usernamePrefix: args.usernamePrefix,
      runStamp,
      loginOnly: args.loginOnly,
    });
    const avatarPath = avatarFiles.length > 0 ? avatarFiles[i % avatarFiles.length] : null;
    if (avatarPath) {
      try {
        const avatarRes = await uploadAvatarForUser({
          apiBase,
          avatarEndpoint,
          token: user.token,
          avatarPath,
        });
        if (avatarRes.ok) {
          console.log(`[avatar ${i + 1}/${args.users}] ok (${path.basename(avatarPath)})`);
        } else if (!avatarRes.skipped) {
          const msg = avatarRes.data?.error || avatarRes.data?.message || JSON.stringify(avatarRes.data);
          console.warn(`[avatar ${i + 1}/${args.users}] failed (${path.basename(avatarPath)}): ${msg}`);
        }
      } catch (err) {
        console.warn(`[avatar ${i + 1}/${args.users}] failed (${path.basename(avatarPath)}): ${err?.message || err}`);
      }
    }
    users.push(user);
  }

  let success = 0;
  let failed = 0;
  for (let i = 0; i < args.videos; i += 1) {
    const user = users[i % users.length];
    const videoPath = sourceVideos[i % sourceVideos.length];
    const baseName = path.parse(path.basename(videoPath)).name.replace(/[_-]+/g, ' ').trim() || 'video';
    const aiMeta = await generateMetadataWithDeepSeek({
      apiKey: args.deepseekApiKey,
      model: args.deepseekModel,
      timeoutMs: args.deepseekTimeoutMs,
      baseName,
      talentType: user.talent_type,
    });
    const meta = aiMeta || fallbackMetadata({
      baseName,
      uploadIndex: i,
      talentType: user.talent_type,
    });
    const title = buildPhraseTitle({
      rawTitle: meta.title,
      baseName,
      talentType: user.talent_type,
    });
    const tags = sanitizeTags(meta.tags, user.talent_type).join(',');
    const description = `Auto-seeded by script for load/testing (${path.basename(videoPath)})`;
    console.log(`[upload ${i + 1}/${args.videos}] start user=${user.username} file=${path.basename(videoPath)}`);
    let res;
    try {
      if (args.streamUploads) {
        res = await uploadOneVideoViaStream({
          apiBase,
          token: user.token,
          title,
          description,
          tags,
          talent_type: user.talent_type,
          filePath: videoPath,
          timeoutMs: args.uploadTimeoutMs,
          completeAttempts: args.streamCompleteAttempts,
          completeDelayMs: args.streamCompleteDelayMs,
        });
      } else {
        res = await uploadOneVideo({
          apiBase,
          token: user.token,
          title,
          description,
          tags,
          talent_type: user.talent_type,
          filePath: videoPath,
          timeoutMs: args.uploadTimeoutMs,
        });
      }
    } catch (err) {
      failed += 1;
      console.error(`[upload ${i + 1}/${args.videos}] failed: ${err?.message || err}`);
      if (args.delayMs > 0) await sleep(args.delayMs);
      continue;
    }

    if (res.ok) {
      success += 1;
      console.log(`[upload ${i + 1}/${args.videos}] ok (success=${success}, failed=${failed})`);
    } else {
      failed += 1;
      const errText = res.data?.error || res.data?.message || JSON.stringify(res.data);
      console.error(`[upload ${i + 1}/${args.videos}] failed: ${errText}`);
    }

    if (args.delayMs > 0) await sleep(args.delayMs);
  }

  console.log('\nDone');
  console.log(`- Users processed:  ${users.length}`);
  console.log(`- Videos uploaded:  ${success}`);
  console.log(`- Upload failures:  ${failed}`);
}

main().catch((err) => {
  console.error('Seed script failed:', err?.message || err);
  process.exit(1);
});
