#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { setTimeout: sleep } = require('timers/promises');

const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.mpeg', '.mpg', '.3gp', '.ogg',
]);

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

const TALENT_TYPES = [
  'Singer', 'Musician', 'Dancer', 'Rapper', 'Comedian',
  'Magician', 'Actor', 'Acrobat', 'Martial Artist', 'Athlete',
  'Variety', 'Visual Artist', 'Impressionist', 'Ventriloquist', 'Unique Talent',
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (
      key === 'help'
      || key === 'dry-run'
      || key === 'allow-repeat-source'
      || key === 'allow-uploads-source'
    ) {
      out[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function limitText(input, max) {
  const s = String(input || '');
  return s.length <= max ? s : s.slice(0, max);
}

function runTag() {
  const now = new Date();
  const parts = [
    now.getUTCFullYear().toString().slice(-2),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ];
  return parts.join('');
}

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fileToMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.webm': return 'video/webm';
    case '.ogg': return 'video/ogg';
    case '.avi': return 'video/x-msvideo';
    case '.mpeg':
    case '.mpg': return 'video/mpeg';
    case '.3gp': return 'video/3gpp';
    case '.mkv': return 'video/x-matroska';
    default: return 'application/octet-stream';
  }
}

function imageMimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

function isVideoFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTS.has(ext);
}

async function walkFiles(rootDir) {
  const out = [];
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const children = await walkFiles(full);
      out.push(...children);
    } else if (entry.isFile() && isVideoFile(full)) {
      out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function makeUserLabel(prefix, tag, index, suffix = '') {
  const base = `${prefix}_${tag}_${String(index).padStart(4, '0')}${suffix}`.toLowerCase();
  return base.slice(0, 40);
}

function sameNameThumbnail(videoPath) {
  const dir = path.dirname(videoPath);
  const stem = path.parse(videoPath).name;
  for (const ext of IMAGE_EXTS) {
    const candidate = path.join(dir, `${stem}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function requestJson(url, opts, context) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    throw new Error(`${context} failed: cannot reach ${url} (${err.message})`);
  }

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const msg = payload?.error || payload?.message || text || `HTTP ${res.status}`;
    throw new Error(`${context} failed (${res.status}): ${msg}`);
  }

  if (!payload || payload.success !== true) {
    const msg = payload?.error || payload?.message || 'Unknown API error';
    throw new Error(`${context} failed: ${msg}`);
  }

  return payload;
}

async function createTestUser(config, index) {
  const talentType = randomPick(TALENT_TYPES);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const suffix = attempt === 1 ? '' : `_r${attempt}`;
    const username = makeUserLabel(config.prefix, config.tag, index, suffix);
    const email = `${username}@seed.local`;
    const body = {
      username,
      email,
      password: config.password,
      full_name: `Seed User ${index}`,
      talent_type: talentType,
    };

    try {
      const payload = await requestJson(
        `${config.apiBase}/api/auth/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        `Register user ${username}`
      );

      return {
        id: payload.data.user.id,
        username: payload.data.user.username,
        email: payload.data.user.email,
        talent_type: payload.data.user.talent_type,
        token: payload.data.token,
      };
    } catch (err) {
      if (!String(err.message || '').includes('already taken') || attempt === 5) {
        throw err;
      }
    }
  }

  throw new Error(`Register user ${index} failed after retries`);
}

async function uploadOneVideo(config, users, files, uploadIndex) {
  const user = users[uploadIndex % users.length];
  const filePath = files[uploadIndex % files.length];
  const thumbnailPath = sameNameThumbnail(filePath);
  const originalName = path.basename(filePath);
  const baseName = path.parse(originalName).name.replace(/[_-]+/g, ' ').trim() || 'Seed video';
  const talentType = randomPick(TALENT_TYPES);
  const title = limitText(`${baseName} #${uploadIndex + 1}`, 200);
  const description = limitText(
    `Seed upload ${uploadIndex + 1} for testing recommendations and moderation. Source file: ${originalName}. Run: ${config.tag}.`,
    1000
  );
  const tags = `seed,test,${talentType.toLowerCase().replace(/\s+/g, '-')}`;

  let attempt = 0;
  while (attempt <= config.maxRetries) {
    attempt += 1;
    try {
      const videoBuffer = await fs.promises.readFile(filePath);
      const form = new FormData();
      form.append('video', new Blob([videoBuffer], { type: fileToMime(filePath) }), originalName);
      form.append('title', title);
      form.append('description', description);
      form.append('tags', tags);
      form.append('talent_type', talentType);
      form.append('is_public', '1');

      if (thumbnailPath) {
        const thumbBuf = await fs.promises.readFile(thumbnailPath);
        form.append(
          'thumbnail',
          new Blob([thumbBuf], { type: imageMimeFromPath(thumbnailPath) }),
          path.basename(thumbnailPath)
        );
      }

      const payload = await requestJson(
        `${config.apiBase}/api/videos`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${user.token}` },
          body: form,
        },
        `Upload #${uploadIndex + 1}`
      );

      return {
        ok: true,
        uploadIndex: uploadIndex + 1,
        user_id: user.id,
        username: user.username,
        file: filePath,
        thumbnail: thumbnailPath,
        video_id: payload.data.id,
        title,
        talent_type: talentType,
        file_url: payload.data.file_url,
      };
    } catch (err) {
      if (attempt > config.maxRetries) {
        return {
          ok: false,
          uploadIndex: uploadIndex + 1,
          user_id: user.id,
          username: user.username,
          file: filePath,
          error: err.message,
        };
      }
      await sleep(250 * attempt);
    }
  }

  return {
    ok: false,
    uploadIndex: uploadIndex + 1,
    user_id: user.id,
    username: user.username,
    file: filePath,
    error: 'Unknown upload failure',
  };
}

async function runPool(total, concurrency, worker) {
  const results = new Array(total);
  let cursor = 0;

  const runners = new Array(Math.min(concurrency, total)).fill(null).map(async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= total) return;
      // eslint-disable-next-line no-await-in-loop
      results[idx] = await worker(idx);
    }
  });

  await Promise.all(runners);
  return results;
}

function printHelp() {
  console.log(`
Seed fake users + upload videos for local/staging tests.

Usage:
  node scripts/seed-video-load.js [options]

Options:
  --api <url>             API origin (default: http://localhost:3000)
  --video-dir <path>      Folder with source videos (default: ./seed/videos)
  --videos <n>            Number of uploads to create (default: 10)
  --users <n>             Number of fake users to create (default: 3)
  --concurrency <n>       Parallel uploads (default: 2)
  --password <text>       Password for all fake users (default: Password123!)
  --prefix <text>         Username/email prefix (default: testuser)
  --max-retries <n>       Retries per upload on failure (default: 2)
  --dry-run               Validate inputs only, no API requests
  --allow-repeat-source   Allow reusing source files if --videos > number of files
  --allow-uploads-source  Allow using an uploads/videos folder as source
  --help                  Show this help

Examples:
  node scripts/seed-video-load.js --video-dir ./seed/videos --videos 10 --users 3
  node scripts/seed-video-load.js --video-dir ./seed/videos --videos 1000 --users 50 --concurrency 4
`);
}

async function main() {
  if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw new Error('Node fetch/FormData/Blob APIs are unavailable. Use Node.js 18+.');
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const tag = runTag();
  const config = {
    apiBase: (args.api || process.env.SEED_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    videoDir: path.resolve(args['video-dir'] || process.env.SEED_VIDEO_DIR || 'seed/videos'),
    videosTarget: toInt(args.videos || process.env.SEED_VIDEOS, 10),
    usersTarget: toInt(args.users || process.env.SEED_USERS, 3),
    concurrency: toInt(args.concurrency || process.env.SEED_CONCURRENCY, 2),
    password: String(args.password || process.env.SEED_PASSWORD || 'Password123!'),
    prefix: String(args.prefix || process.env.SEED_PREFIX || 'testuser').replace(/[^a-zA-Z0-9_]/g, ''),
    maxRetries: toInt(args['max-retries'] || process.env.SEED_MAX_RETRIES, 2),
    allowRepeatSource: Boolean(args['allow-repeat-source']),
    allowUploadsSource: Boolean(args['allow-uploads-source']),
    tag,
    dryRun: Boolean(args['dry-run']),
  };

  if (!config.prefix) config.prefix = 'testuser';
  if (config.videosTarget < 1) throw new Error('--videos must be >= 1');
  if (config.usersTarget < 1) throw new Error('--users must be >= 1');
  if (config.concurrency < 1) throw new Error('--concurrency must be >= 1');
  if (config.password.length < 8) throw new Error('Password must be at least 8 characters');

  if (!fs.existsSync(config.videoDir) || !fs.statSync(config.videoDir).isDirectory()) {
    throw new Error(`Video folder not found: ${config.videoDir}`);
  }

  const files = await walkFiles(config.videoDir);
  if (files.length === 0) {
    throw new Error(`No video files found under: ${config.videoDir}`);
  }

  const normalizedVideoDir = config.videoDir.replace(/\\/g, '/').toLowerCase();
  if (normalizedVideoDir.includes('/uploads/videos') && !config.allowUploadsSource) {
    throw new Error(
      'Refusing source folder under uploads/videos by default. Use a separate source folder (recommended), or pass --allow-uploads-source.'
    );
  }

  if (config.videosTarget > files.length && !config.allowRepeatSource) {
    throw new Error(
      `Requested ${config.videosTarget} uploads but only ${files.length} source files were found. Add more files or pass --allow-repeat-source.`
    );
  }

  console.log('\nSeed load config');
  console.log(`- API:          ${config.apiBase}`);
  console.log(`- Video folder: ${config.videoDir}`);
  console.log(`- Source files: ${files.length}`);
  console.log(`- Users:        ${config.usersTarget}`);
  console.log(`- Uploads:      ${config.videosTarget}`);
  console.log(`- Concurrency:  ${config.concurrency}`);
  console.log(`- Repeat src:   ${config.allowRepeatSource ? 'allowed' : 'blocked'}`);
  console.log(`- uploads src:  ${config.allowUploadsSource ? 'allowed' : 'blocked'}`);
  console.log(`- Dry run:      ${config.dryRun ? 'yes' : 'no'}`);
  console.log('');

  if (config.dryRun) {
    console.log('Dry run complete. No users/videos created.');
    return;
  }

  const startedAt = new Date().toISOString();
  const users = [];

  for (let i = 1; i <= config.usersTarget; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const user = await createTestUser(config, i);
    users.push(user);
    console.log(`[user ${i}/${config.usersTarget}] created ${user.username}`);
  }

  const results = await runPool(
    config.videosTarget,
    config.concurrency,
    async (uploadIdx) => uploadOneVideo(config, users, files, uploadIdx)
  );

  const successes = results.filter((r) => r && r.ok);
  const failures = results.filter((r) => r && !r.ok);

  let printed = 0;
  for (const item of results) {
    printed += 1;
    if (item.ok) {
      console.log(`[upload ${printed}/${config.videosTarget}] ok   ${item.video_id} (${path.basename(item.file)}) via ${item.username}`);
    } else {
      console.log(`[upload ${printed}/${config.videosTarget}] fail ${path.basename(item.file)} via ${item.username} -> ${item.error}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const report = {
    started_at: startedAt,
    finished_at: finishedAt,
    run_tag: config.tag,
    config: {
      api: config.apiBase,
      video_dir: config.videoDir,
      source_files: files.length,
      users_target: config.usersTarget,
      uploads_target: config.videosTarget,
      concurrency: config.concurrency,
      max_retries: config.maxRetries,
      prefix: config.prefix,
    },
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      talent_type: u.talent_type,
    })),
    uploads: {
      success_count: successes.length,
      failure_count: failures.length,
      success_items: successes,
      failed_items: failures,
    },
    checksum: crypto.createHash('sha256').update(JSON.stringify({
      users: users.map((u) => u.id),
      successes: successes.map((s) => s.video_id),
      failures: failures.map((f) => f.uploadIndex),
    })).digest('hex'),
  };

  const outDir = path.resolve(process.cwd(), 'seed-output');
  await fs.promises.mkdir(outDir, { recursive: true });
  const reportPath = path.join(outDir, `seed-video-load-${config.tag}.json`);
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nSeed load complete');
  console.log(`- Created users: ${users.length}`);
  console.log(`- Uploaded:      ${successes.length}/${config.videosTarget}`);
  console.log(`- Failed:        ${failures.length}`);
  console.log(`- Report:        ${reportPath}`);

  if (failures.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('\nSeed load failed:', err.message || err);
  process.exit(1);
});
