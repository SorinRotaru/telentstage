import { Response, NextFunction, Request } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuid } from 'uuid';
import pool from '../config/database';
import { isFeatureFlagEnabled } from '../config/runtimeFlags';
import { AuthRequest, VideoRow } from '../models/types';
import { UPLOAD_DIR } from '../middleware/upload';
import { safeTrackVideoEvent, type RecoEventType } from '../services/recommendation';

const execFileAsync = promisify(execFile);
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 1000;
const SHORTS_WIDTH = 1080;
const SHORTS_HEIGHT = 1920;
const TARGET_SIZE_MB = 25;
const TARGET_SIZE_BYTES = TARGET_SIZE_MB * 1024 * 1024;
const TARGET_ASPECT = 9 / 16;
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg']);
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv',
  '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts', '.mts',
]);

const mimeTypeFromExt = (ext: string): string => {
  switch (ext) {
    case '.mp4':
    case '.m4v': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.webm': return 'video/webm';
    case '.avi': return 'video/x-msvideo';
    case '.mpg':
    case '.mpeg': return 'video/mpeg';
    case '.3gp': return 'video/3gpp';
    case '.mkv': return 'video/x-matroska';
    default: return 'application/octet-stream';
  }
};

const getMediaDurationSec = async (filePath: string): Promise<number> => {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const parsed = Number(String(stdout || '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  } catch {
    return 1;
  }
};

const encodeShortsMp4 = async (
  inputPath: string,
  outputPath: string,
  opts: { targetVideoBitrate?: number; audioBitrate?: number; useCrf?: boolean } = {},
): Promise<void> => {
  const {
    targetVideoBitrate,
    audioBitrate = 128_000,
    useCrf = false,
  } = opts;
  const vf = `scale=${SHORTS_WIDTH}:${SHORTS_HEIGHT}:force_original_aspect_ratio=decrease,pad=${SHORTS_WIDTH}:${SHORTS_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

  const args = [
    '-i', inputPath,
    '-vf', vf,
    '-r', '30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
  ];

  if (useCrf || !targetVideoBitrate) {
    args.push('-preset', 'medium', '-crf', '23');
  } else {
    const safeVideoBitrate = Math.max(250_000, Math.floor(targetVideoBitrate));
    args.push(
      '-preset', 'medium',
      '-b:v', String(safeVideoBitrate),
      '-maxrate', String(Math.floor(safeVideoBitrate * 1.08)),
      '-bufsize', String(Math.floor(safeVideoBitrate * 2)),
    );
  }

  args.push(
    '-c:a', 'aac',
    '-b:a', String(Math.max(48_000, Math.floor(audioBitrate))),
    '-ar', '44100',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  );

  await execFileAsync('ffmpeg', args);
};

// Always convert uploads to Shorts MP4 (1080x1920). If size is over target, compress to ~25MB.
const prepareShortsMp4 = async (
  filePath: string,
): Promise<{ filename: string; size: number; mimeType: string; transcoded: boolean }> => {
  const shortsAspect = SHORTS_WIDTH / SHORTS_HEIGHT;
  if (Math.abs(shortsAspect - TARGET_ASPECT) > 0.0001) {
    throw new Error(`Invalid shorts aspect config: ${shortsAspect} (expected ${TARGET_ASPECT})`);
  }
  const ext = path.extname(filePath).toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) {
    throw new Error('Audio-only uploads are not supported. Please upload a video file.');
  }
  if (!VIDEO_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported video extension: ${ext || '(none)'}`);
  }

  const inputSize = fs.statSync(filePath).size;
  const inputFilename = path.basename(filePath);

  try {
    const durationSec = await getMediaDurationSec(filePath);
    const initialOutName = `${uuid()}.mp4`;
    const initialOutPath = path.join(path.dirname(filePath), initialOutName);

    // Convert all uploads to a standard Shorts format for predictable playback.
    await encodeShortsMp4(filePath, initialOutPath, { useCrf: inputSize <= TARGET_SIZE_BYTES });

    let finalPath = initialOutPath;
    let finalSize = fs.statSync(finalPath).size;

    const shouldCompress = inputSize > TARGET_SIZE_BYTES || finalSize > TARGET_SIZE_BYTES;
    if (shouldCompress) {
      let workingInput = finalPath;
      let workingSize = finalSize;
      const audioBitrate = 96_000;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (workingSize <= TARGET_SIZE_BYTES) break;
        const compressOutPath = path.join(path.dirname(filePath), `${uuid()}.mp4`);
        const targetTotalBitrate = Math.floor(((TARGET_SIZE_BYTES * 8) / Math.max(1, durationSec)) * (attempt === 0 ? 0.92 : 0.82));
        const targetVideoBitrate = Math.max(250_000, targetTotalBitrate - audioBitrate);

        await encodeShortsMp4(workingInput, compressOutPath, {
          targetVideoBitrate,
          audioBitrate,
        });

        if (workingInput !== filePath && fs.existsSync(workingInput)) fs.unlinkSync(workingInput);
        workingInput = compressOutPath;
        workingSize = fs.statSync(workingInput).size;
      }

      finalPath = workingInput;
      finalSize = workingSize;
    }

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const finalFilename = path.basename(finalPath);
    return { filename: finalFilename, size: finalSize, mimeType: 'video/mp4', transcoded: true };
  } catch (err) {
    // Keep uploads working even when ffmpeg/ffprobe isn't available on host.
    const fallbackSize = fs.statSync(filePath).size;
    console.warn(
      `⚠️  Shorts conversion failed for ${inputFilename}; keeping original file.`,
      (err as Error)?.message || err
    );
    return {
      filename: inputFilename,
      size: fallbackSize,
      mimeType: mimeTypeFromExt(ext),
      transcoded: false,
    };
  }
};

// Helpers
const parsePage  = (p?: string) => Math.max(1, parseInt(p || '1'));
const parseLimit = (l?: string) => Math.min(50, Math.max(1, parseInt(l || '20')));
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
const toNumber = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const normalizeTalentType = (v: unknown): string => {
  const s = String(v || '').trim();
  return s ? s : 'Uncategorized';
};
const buildViewerKey = (req: AuthRequest): string => {
  if (req.user?.userId) return req.user.userId;
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.socket.remoteAddress || 'anon');
  const ua = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : (req.headers['user-agent'] || '');
  return `${String(ip).split(',')[0].trim()}|${String(ua).slice(0, 80)}`;
};
const rankTieBreaker = (a: string, b: string): number => a.localeCompare(b);

export const DISLIKE_LIMIT = 1000;

interface RankedVideoRow extends VideoRow {
  affinity_score?: number;
  report_count?: number;
  pending_report_count?: number;
  impressions_30d?: number;
  completions_30d?: number;
  quick_skips_30d?: number;
  avg_watch_pct_30d?: number;
}

// Private helpers 
const deleteVideoFiles = (v: { filename: string; thumbnail_url?: string | null }): void => {
  const videoPath = path.join(UPLOAD_DIR, 'videos', v.filename);
  if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
  if (v.thumbnail_url) {
    const thumbPath = path.join(UPLOAD_DIR, 'thumbnails', path.basename(v.thumbnail_url));
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  }
};

const evaluateCycle = async (v: any): Promise<void> => {
  if (v.dislikes > v.likes) {
    await pool.query('DELETE FROM videos WHERE id = ?', [v.id]);
    deleteVideoFiles(v);
    console.log(`[DEL] Video ${v.id} deleted after cycle ${v.cycle_number} (dislikes ${v.dislikes} > likes ${v.likes})`);
  } else {
    const nextLimit = v.cycle_view_limit * 2;
    await pool.query(
      'UPDATE videos SET cycle_number = ?, cycle_view_limit = ?, cycle_views_start = ? WHERE id = ?',
      [v.cycle_number + 1, nextLimit, v.views, v.id]
    );
    console.log(`Video ${v.id} → Cycle ${v.cycle_number + 1} (${nextLimit} more views)`);
  }
};

const getRequestOrigin = (req: Request): string => {
  const explicitBase = String(process.env.API_PUBLIC_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (explicitBase) return explicitBase.replace(/\/+$/, '');

  const xfProtoRaw = req.headers['x-forwarded-proto'];
  const xfHostRaw = req.headers['x-forwarded-host'];
  const xfProto = (Array.isArray(xfProtoRaw) ? xfProtoRaw[0] : String(xfProtoRaw || ''))
    .split(',')[0]
    .trim();
  const xfHost = (Array.isArray(xfHostRaw) ? xfHostRaw[0] : String(xfHostRaw || ''))
    .split(',')[0]
    .trim();

  const proto = xfProto || req.protocol || 'http';
  const host = xfHost || req.get('host') || '';
  if (!host) return '';
  return `${proto}://${host}`;
};

// Startup helpers
export const ensureCycleColumns = async (): Promise<void> => {
  for (const col of [
    'cycle_number INT NOT NULL DEFAULT 0',
    'cycle_view_limit INT NOT NULL DEFAULT 0',
    'cycle_views_start INT NOT NULL DEFAULT 0',
  ]) {
    try {
      await pool.query(`ALTER TABLE videos ADD COLUMN ${col}`);
    } catch (e: any) {
      if (!e.message?.includes('Duplicate column')) throw e;
    }
  }
  console.log('✅  Cycle columns verified');
};

export const purgeOverLimitVideos = async (): Promise<void> => {
  // 1. Videos that hit the threshold but have no active cycle yet
  const [overLimit] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM videos WHERE dislikes >= ? AND cycle_view_limit = 0',
    [DISLIKE_LIMIT]
  );
  for (const v of overLimit as any[]) {
    if (v.likes >= v.dislikes) {
      // Start Cycle 1
      await pool.query(
        'UPDATE videos SET cycle_number = 1, cycle_view_limit = ?, cycle_views_start = ? WHERE id = ?',
        [2 * DISLIKE_LIMIT, v.views, v.id]
      );
      console.log(`🔄  Video ${v.id} entered Cycle 1 at startup (likes ${v.likes} >= dislikes ${v.dislikes})`);
    } else {
      await pool.query('DELETE FROM videos WHERE id = ?', [v.id]);
      deleteVideoFiles(v);
      console.log(`[DEL] Video ${v.id} purged at startup (dislikes ${v.dislikes} > likes ${v.likes})`);
    }
  }

  // 2. Videos already in a cycle whose window has now closed
  const [inCycle] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM videos WHERE cycle_view_limit > 0'
  );
  for (const v of inCycle as any[]) {
    if (v.views - v.cycle_views_start >= v.cycle_view_limit) {
      await evaluateCycle(v);
    }
  }
};

export const purgeExpiredModerationHiddenVideos = async (): Promise<void> => {
  // 1) If linked report is already reviewed, cancel auto-delete hold.
  await pool.query(
    `UPDATE videos v
     JOIN reports r ON r.id = v.moderation_hold_report_id
     SET v.moderation_hold_set_at = NULL,
         v.moderation_hold_until = NULL,
         v.moderation_hold_report_id = NULL
     WHERE v.moderation_hold_until IS NOT NULL
       AND r.status IN ('resolved', 'dismissed')`
  );

  // 2) Auto-delete expired hidden videos only if report is still unreviewed.
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT v.id, v.filename, v.thumbnail_url, v.moderation_hold_report_id
     FROM videos v
     LEFT JOIN reports r ON r.id = v.moderation_hold_report_id
     WHERE v.moderation_hold_until IS NOT NULL
       AND v.moderation_hold_until <= NOW()
       AND (
         v.moderation_hold_report_id IS NULL
         OR r.id IS NULL
         OR r.status IN ('pending', 'reviewing')
       )`
  );

  let deletedCount = 0;
  for (const row of rows as any[]) {
    await pool.query('DELETE FROM videos WHERE id = ?', [row.id]);
    deleteVideoFiles(row);
    deletedCount += 1;
    try {
      await pool.query(
        `INSERT INTO audit_logs
           (id, admin_id, admin_username, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuid(),
          null,
          'system',
          'video_auto_deleted_unreviewed_90d',
          'video',
          row.id,
          JSON.stringify({ moderation_hold_report_id: row.moderation_hold_report_id || null }),
          null,
          null,
          'system:moderation-hold-sweeper',
        ]
      );
    } catch {
      // Ignore audit insertion errors so cleanup is never blocked.
    }
  }

  if (deletedCount > 0) {
    console.log(`🧹  Auto-deleted ${deletedCount} hidden unreviewed video(s) after 90 days`);
  }
};

const formatVideo = (v: VideoRow, req: Request) => {
  const origin = getRequestOrigin(req);
  return {
    ...v,
    tags: Array.isArray(v.tags)
      ? v.tags
      : (() => {
          try { return v.tags ? JSON.parse(v.tags) : []; }
          catch { return v.tags ? String(v.tags).split(',').map((t: string) => t.trim()).filter(Boolean) : []; }
        })(),
    file_url: `${origin}/uploads/videos/${v.filename}`,
    thumbnail_url: v.thumbnail_url
      ? `${origin}/uploads/thumbnails/${path.basename(v.thumbnail_url)}`
      : null,
  };
};

const scoreVideoForFeed = (
  row: RankedVideoRow,
  talentTypeFilter: string | undefined,
  nowTs: number,
  creatorFreq: Map<string, number>,
  talentFreq: Map<string, number>
): number => {
  const likes = toNumber(row.likes);
  const dislikes = toNumber(row.dislikes);
  const views = toNumber(row.views);
  const uniqueViews = toNumber((row as any).unique_views);
  const isFollowing = toNumber((row as any).is_following_author) > 0;
  const affinity = toNumber(row.affinity_score);
  const reportCount = toNumber(row.report_count);
  const pendingReports = toNumber(row.pending_report_count);
  const impressions = toNumber(row.impressions_30d);
  const completions = toNumber(row.completions_30d);
  const quickSkips = toNumber(row.quick_skips_30d);
  const avgWatchPct = toNumber(row.avg_watch_pct_30d, 35);

  const qualityRatio = (likes + 1) / (likes + dislikes + 2);
  const engagementQuality = clamp(qualityRatio, 0, 1);

  const completionRate = impressions > 0 ? completions / impressions : 0;
  const skipRate = impressions > 0 ? quickSkips / impressions : 0;
  const watchQuality = clamp(avgWatchPct / 100, 0, 1);

  const createdTs = new Date(row.created_at as unknown as string).getTime();
  const ageHours = Math.max(0, (nowTs - createdTs) / 36e5);
  const freshness = 1 / (1 + (ageHours / 36));

  const popularity = Math.log1p(Math.max(0, uniqueViews || views)) / 12;
  const affinityBoost = clamp((affinity + 8) / 22, 0, 1);

  const creatorKey = String(row.user_id || '');
  const talentKey = normalizeTalentType(row.talent_type);
  const creatorDiversityBoost = creatorFreq.get(creatorKey)
    ? 1 / creatorFreq.get(creatorKey)!
    : 0;
  const talentDiversityBoost = talentFreq.get(talentKey)
    ? 1 / talentFreq.get(talentKey)!
    : 0;

  const categoryBoost = talentTypeFilter && normalizeTalentType(row.talent_type) === talentTypeFilter ? 0.2 : 0;
  const followBoost = isFollowing ? 0.1 : 0;

  const reportPenalty = clamp((pendingReports * 0.18) + (reportCount * 0.03), 0, 0.6);
  const negativePenalty = clamp((skipRate * 0.35) + ((1 - engagementQuality) * 0.2), 0, 0.5);

  return (
    (0.26 * affinityBoost) +
    (0.2 * engagementQuality) +
    (0.16 * watchQuality) +
    (0.12 * completionRate) +
    (0.1 * freshness) +
    (0.06 * popularity) +
    (0.04 * creatorDiversityBoost) +
    (0.03 * talentDiversityBoost) +
    followBoost +
    categoryBoost -
    reportPenalty -
    negativePenalty
  );
};

const applyCategoryMix = (
  ranked: RankedVideoRow[],
  talentTypeFilter: string | undefined
): RankedVideoRow[] => {
  if (!talentTypeFilter) return ranked;

  const selected: RankedVideoRow[] = [];
  const exploration: RankedVideoRow[] = [];

  for (const row of ranked) {
    if (normalizeTalentType(row.talent_type) === talentTypeFilter) selected.push(row);
    else exploration.push(row);
  }

  if (selected.length === 0 || exploration.length === 0) return ranked;

  const mixed: RankedVideoRow[] = [];
  let iSel = 0;
  let iExp = 0;

  // 80/20: 4 selected + 1 exploration
  while (iSel < selected.length || iExp < exploration.length) {
    for (let i = 0; i < 4 && iSel < selected.length; i++) mixed.push(selected[iSel++]);
    if (iExp < exploration.length) mixed.push(exploration[iExp++]);
    if (iSel >= selected.length && iExp < exploration.length) {
      while (iExp < exploration.length) mixed.push(exploration[iExp++]);
    }
    if (iExp >= exploration.length && iSel < selected.length) {
      while (iSel < selected.length) mixed.push(selected[iSel++]);
    }
  }
  return mixed;
};

const applyCreatorSoftCap = (
  ranked: RankedVideoRow[],
  needed: number
): RankedVideoRow[] => {
  if (ranked.length <= 2) return ranked;

  const distinctCreators = new Set(ranked.map((r) => String(r.user_id || ''))).size || 1;
  const windowSize = 20;
  const strictCap = 2;
  const relaxedCap = Math.max(strictCap, Math.ceil(windowSize / distinctCreators));

  const counts = new Map<string, number>();
  const selected: RankedVideoRow[] = [];
  const overflow: RankedVideoRow[] = [];

  for (const row of ranked) {
    const creator = String(row.user_id || '');
    const used = counts.get(creator) || 0;
    if (used < strictCap) {
      selected.push(row);
      counts.set(creator, used + 1);
    } else {
      overflow.push(row);
    }
  }

  if (selected.length >= needed || relaxedCap <= strictCap) {
    return selected.concat(overflow);
  }

  const stillOverflow: RankedVideoRow[] = [];
  for (const row of overflow) {
    const creator = String(row.user_id || '');
    const used = counts.get(creator) || 0;
    if (used < relaxedCap) {
      selected.push(row);
      counts.set(creator, used + 1);
    } else {
      stillOverflow.push(row);
    }
    if (selected.length >= needed) break;
  }

  if (selected.length < needed) {
    selected.push(...stillOverflow);
  }

  return selected;
};

// POST /api/videos  (upload)
export const uploadVideo = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    if (!(await isFeatureFlagEnabled('uploads_enabled', true))) {
      res.status(503).json({ success: false, error: 'Video uploads are currently disabled' });
      return;
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const videoFile = files?.['video']?.[0] ?? (req.file as Express.Multer.File | undefined);
    if (!videoFile) {
      res.status(400).json({ success: false, error: 'No video file provided' });
      return;
    }

    const thumbFile = files?.['thumbnail']?.[0];
    const cleanupRejectedUpload = () => {
      if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
      if (thumbFile && fs.existsSync(thumbFile.path)) fs.unlinkSync(thumbFile.path);
    };

    const { title, description, tags, talent_type, is_public } = req.body;
    const cleanTitle = String(title || '').trim();
    const cleanDescription = String(description || '').trim();

    if (!cleanTitle) {
      cleanupRejectedUpload();
      res.status(400).json({ success: false, error: 'title is required' });
      return;
    }

    if (cleanTitle.length > TITLE_MAX_LENGTH) {
      cleanupRejectedUpload();
      res.status(400).json({ success: false, error: `title must be at most ${TITLE_MAX_LENGTH} characters` });
      return;
    }

    if (cleanDescription.length > DESCRIPTION_MAX_LENGTH) {
      cleanupRejectedUpload();
      res.status(400).json({ success: false, error: `description must be at most ${DESCRIPTION_MAX_LENGTH} characters` });
      return;
    }

    const thumbFilename = thumbFile ? thumbFile.filename : null;

    const tagsArray: string[] = tags
      ? (typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()) : tags)
      : [];

    const id = uuid();

    // Convert to standardized Shorts MP4 and compress if >25MB.
    const processed = await prepareShortsMp4(videoFile.path);
    const finalFilename = processed.filename;
    const finalSize     = processed.size;
    const finalMimeType = processed.mimeType;
    const finalPath     = path.join(path.dirname(videoFile.path), finalFilename);

    await pool.query(
      `INSERT INTO videos
         (id, user_id, title, description, tags, filename, original_name,
          file_path, file_size, mime_type, thumbnail_url, talent_type, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user!.userId,
        cleanTitle,
        cleanDescription || null,
        JSON.stringify(tagsArray),
        finalFilename,
        videoFile.originalname,
        finalPath,
        finalSize,
        finalMimeType,
        thumbFilename,
        talent_type || null,
        is_public === 'false' || is_public === '0' ? 0 : 1,
      ]
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT v.*, u.username, u.full_name, u.avatar_url
       FROM videos v JOIN users u ON u.id = v.user_id
       WHERE v.id = ?`,
      [id]
    );

    res.status(201).json({
      success: true,
      data: formatVideo(rows[0] as VideoRow, req),
      message: 'Video uploaded successfully',
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/videos  (feed / browse)
export const getVideos = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page = parsePage(req.query.page as string);
    const limit = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;
    const rawTalentType = req.query.talent_type as string | undefined;
    const talentTypeFilter = rawTalentType ? normalizeTalentType(rawTalentType) : undefined;
    const search = req.query.search as string | undefined;
    const userId = req.user?.userId;
    const hybridEnabled = await isFeatureFlagEnabled('hybrid_recommendation_enabled', true);

    const baseWhereParts: string[] = ['v.is_public = 1', '(u.shadow_banned = 0 OR u.id = ?)'];
    const baseParams: unknown[] = [userId || ''];
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      baseWhereParts.push("(LOWER(v.title) LIKE ? OR LOWER(COALESCE(v.description, '')) LIKE ? OR LOWER(CAST(v.tags AS CHAR)) LIKE ?)");
      baseParams.push(like, like, like);
    }
    const baseWhere = baseWhereParts.join(' AND ');

    // Fallback keeps old deterministic ordering for quick rollback.
    if (!hybridEnabled) {
      const whereParts = [...baseWhereParts];
      const params = [...baseParams];
      if (talentTypeFilter) {
        whereParts.push('v.talent_type = ?');
        params.push(talentTypeFilter);
      }
      const where = whereParts.join(' AND ');

      const [[{ total }]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM videos v JOIN users u ON u.id = v.user_id WHERE ${where}`,
        params
      ) as any;

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT v.*,
                u.username, u.full_name, u.avatar_url,
                ${userId ? `(SELECT COUNT(*) FROM saved_videos sv WHERE sv.user_id = ? AND sv.video_id = v.id) AS is_saved,
                (SELECT COUNT(*) FROM follows f WHERE f.follower_id = ? AND f.following_id = v.user_id) AS is_following_author,
                (SELECT type FROM video_likes vl WHERE vl.user_id = ? AND vl.video_id = v.id) AS is_liked` : '0 AS is_saved, 0 AS is_following_author, NULL AS is_liked'}
         FROM videos v
         JOIN users u ON u.id = v.user_id
         WHERE ${where}
         ORDER BY v.created_at DESC
         LIMIT ? OFFSET ?`,
        userId
          ? [userId, userId, userId, ...params, limit, offset]
          : [...params, limit, offset]
      );

      res.json({
        success: true,
        data: {
          items: (rows as VideoRow[]).map((v) => formatVideo(v, req)),
          total: Number(total),
          page,
          limit,
          totalPages: Math.ceil(Number(total) / limit),
        },
      });
      return;
    }

    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM videos v JOIN users u ON u.id = v.user_id WHERE ${baseWhere}`,
      baseParams
    ) as any;

    // Pull a larger recent pool, then rank in memory for personalization + safety + diversity.
    const candidateLimit = Math.max(120, Math.min(900, (offset + limit) * 12));
    const userSignalsSelect = userId
      ? `(SELECT COUNT(*) FROM saved_videos sv WHERE sv.user_id = ? AND sv.video_id = v.id) AS is_saved,
         (SELECT COUNT(*) FROM follows f WHERE f.follower_id = ? AND f.following_id = v.user_id) AS is_following_author,
         (SELECT type FROM video_likes vl WHERE vl.user_id = ? AND vl.video_id = v.id) AS is_liked`
      : '0 AS is_saved, 0 AS is_following_author, NULL AS is_liked';

    const candidateParams: unknown[] = [userId || ''];
    if (userId) candidateParams.push(userId, userId, userId);
    candidateParams.push(...baseParams, candidateLimit);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT v.*,
              u.username, u.full_name, u.avatar_url,
              ${userSignalsSelect},
              IFNULL(uca.score, 0) AS affinity_score,
              IFNULL(vr.report_count, 0) AS report_count,
              IFNULL(vr.pending_report_count, 0) AS pending_report_count,
              IFNULL(es.impressions_30d, 0) AS impressions_30d,
              IFNULL(es.completions_30d, 0) AS completions_30d,
              IFNULL(es.quick_skips_30d, 0) AS quick_skips_30d,
              IFNULL(es.avg_watch_pct_30d, 0) AS avg_watch_pct_30d
       FROM videos v
       JOIN users u ON u.id = v.user_id
       LEFT JOIN user_category_affinity uca
              ON uca.user_id = ? AND uca.talent_type = CASE
                WHEN v.talent_type IS NULL OR TRIM(v.talent_type) = '' THEN 'Uncategorized'
                ELSE v.talent_type
              END
       LEFT JOIN (
         SELECT entity_id AS video_id,
                COUNT(*) AS report_count,
                SUM(CASE WHEN status IN ('pending','reviewing') THEN 1 ELSE 0 END) AS pending_report_count
         FROM reports
         WHERE entity_type = 'video'
           AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY entity_id
       ) vr ON vr.video_id = v.id
       LEFT JOIN (
         SELECT video_id,
                SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END) AS impressions_30d,
                SUM(CASE WHEN event_type = 'completion' THEN 1 ELSE 0 END) AS completions_30d,
                SUM(CASE WHEN event_type = 'quick_skip' THEN 1 ELSE 0 END) AS quick_skips_30d,
                AVG(CASE
                      WHEN event_type = 'watch_progress' THEN event_value
                      WHEN event_type = 'completion' THEN 100
                      ELSE NULL
                    END) AS avg_watch_pct_30d
         FROM video_engagement_events
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY video_id
       ) es ON es.video_id = v.id
       WHERE ${baseWhere}
       ORDER BY v.created_at DESC
       LIMIT ?`,
      candidateParams
    );

    const dedup = new Map<string, RankedVideoRow>();
    for (const raw of rows as RankedVideoRow[]) {
      const id = String(raw.id || '');
      if (!id || dedup.has(id)) continue;
      dedup.set(id, raw);
    }
    const candidates = Array.from(dedup.values());

    const creatorFreq = new Map<string, number>();
    const talentFreq = new Map<string, number>();
    for (const row of candidates) {
      const creator = String(row.user_id || '');
      const talent = normalizeTalentType(row.talent_type);
      creatorFreq.set(creator, (creatorFreq.get(creator) || 0) + 1);
      talentFreq.set(talent, (talentFreq.get(talent) || 0) + 1);
    }

    const nowTs = Date.now();
    const ranked = candidates
      .map((row) => ({
        row,
        score: scoreVideoForFeed(row, talentTypeFilter, nowTs, creatorFreq, talentFreq),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const at = new Date(a.row.created_at as unknown as string).getTime();
        const bt = new Date(b.row.created_at as unknown as string).getTime();
        if (bt !== at) return bt - at;
        return rankTieBreaker(String(a.row.id || ''), String(b.row.id || ''));
      })
      .map((x) => x.row);

    const mixed = applyCategoryMix(ranked, talentTypeFilter);
    const neededCount = offset + limit;
    const withSoftCap = applyCreatorSoftCap(mixed, neededCount);
    const paged = withSoftCap.slice(offset, offset + limit);

    res.json({
      success: true,
      data: {
        items: paged.map((v) => formatVideo(v, req)),
        total: Number(total),
        page,
        limit,
        totalPages: Math.ceil(Number(total) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/videos/:id
export const getVideo = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT v.*,
              u.username, u.full_name, u.avatar_url,
              ${userId ? `(SELECT COUNT(*) FROM saved_videos sv WHERE sv.user_id = ? AND sv.video_id = v.id) AS is_saved,
              (SELECT COUNT(*) FROM follows f WHERE f.follower_id = ? AND f.following_id = v.user_id) AS is_following_author,
              (SELECT type FROM video_likes vl WHERE vl.user_id = ? AND vl.video_id = v.id) AS is_liked` : '0 AS is_saved, 0 AS is_following_author, NULL AS is_liked'}
       FROM videos v JOIN users u ON u.id = v.user_id
       WHERE v.id = ? AND (v.is_public = 1 AND (u.shadow_banned = 0 OR u.id = ?) ${userId ? 'OR v.user_id = ?' : ''})`,
      userId
        ? [userId, userId, userId, req.params.id, userId, userId]
        : [req.params.id, '']
    );

    if (!(rows as any[]).length) {
      res.status(404).json({ success: false, error: 'Video not found' });
      return;
    }

    res.json({ success: true, data: formatVideo((rows as VideoRow[])[0], req) });
  } catch (err) {
    next(err);
  }
};

// POST /api/videos/:id/view 
export const recordView = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT views, cycle_view_limit, cycle_views_start FROM videos WHERE id = ? AND is_public = 1',
      [req.params.id]
    );
    if (!(rows as any[]).length) { res.json({ success: true }); return; }
    const vid = (rows as any[])[0];

    // Viewer key: logged-in userId, else IP address
    const viewerKey = req.user?.userId ||
      (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'anon');

    // INSERT IGNORE deduplicates by (video_id, viewer_key)
    const [ins] = await pool.query(
      'INSERT IGNORE INTO video_views (video_id, viewer_key) VALUES (?, ?)',
      [req.params.id, viewerKey]
    );
    const isUnique = (ins as any).affectedRows > 0;

    // Always bump total views; bump unique_views only on first visit
    await pool.query(
      isUnique
        ? 'UPDATE videos SET views = views + 1, unique_views = unique_views + 1 WHERE id = ?'
        : 'UPDATE videos SET views = views + 1 WHERE id = ?',
      [req.params.id]
    );

    await safeTrackVideoEvent({
      videoId: req.params.id,
      userId: req.user?.userId || null,
      viewerKey,
      eventType: 'impression',
      metadata: { unique_view: isUnique ? 1 : 0 },
    });

    if (vid.cycle_view_limit > 0) {
      const newViews = vid.views + 1;
      if (newViews - vid.cycle_views_start >= vid.cycle_view_limit) {
        const [[fresh]] = await pool.query<RowDataPacket[]>('SELECT * FROM videos WHERE id = ?', [req.params.id]);
        if (fresh) await evaluateCycle(fresh);
      }
    }
    res.json({ success: true });
  } catch (err) { next(err); }
};

// POST /api/videos/:id/event
export const trackVideoSignal = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const videoId = String(req.params.id || '').trim();
    const rawEventType = String(req.body?.event_type || '').trim().toLowerCase();
    const eventValue = Number(req.body?.event_value);
    const watchSeconds = Number(req.body?.watch_seconds);
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object'
      ? (req.body.metadata as Record<string, unknown>)
      : null;

    const allowed = new Set<RecoEventType>([
      'watch_progress',
      'completion',
      'skip',
      'quick_skip',
      'like',
      'dislike',
      'save',
      'share',
      'report_video',
      'report_comment',
    ]);
    if (!allowed.has(rawEventType as RecoEventType)) {
      res.status(400).json({ success: false, error: 'Invalid event_type' });
      return;
    }

    await safeTrackVideoEvent({
      videoId,
      userId: req.user?.userId || null,
      viewerKey: buildViewerKey(req),
      eventType: rawEventType as RecoEventType,
      eventValue: Number.isFinite(eventValue) ? eventValue : null,
      watchSeconds: Number.isFinite(watchSeconds) ? watchSeconds : null,
      metadata,
    });

    res.json({ success: true, data: { tracked: true } });
  } catch (err) {
    next(err);
  }
};

// PUT /api/videos/:id
export const updateVideo = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { title, description, tags, talent_type, is_public } = req.body;
    const cleanTitle = typeof title === 'string' ? title.trim() : null;
    const cleanDescription = typeof description === 'string' ? description.trim() : null;

    if (cleanTitle !== null && cleanTitle.length > TITLE_MAX_LENGTH) {
      res.status(400).json({ success: false, error: `title must be at most ${TITLE_MAX_LENGTH} characters` });
      return;
    }

    if (cleanDescription !== null && cleanDescription.length > DESCRIPTION_MAX_LENGTH) {
      res.status(400).json({ success: false, error: `description must be at most ${DESCRIPTION_MAX_LENGTH} characters` });
      return;
    }

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM videos WHERE id = ? AND user_id = ?',
      [req.params.id, req.user!.userId]
    );
    if (!(existing as any[]).length) {
      res.status(404).json({ success: false, error: 'Video not found or not yours' });
      return;
    }

    const tagsArray = tags
      ? (typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()) : tags)
      : undefined;

    await pool.query(
      `UPDATE videos SET
         title       = COALESCE(?, title),
         description = COALESCE(?, description),
         tags        = COALESCE(?, tags),
         talent_type = COALESCE(?, talent_type),
         is_public   = COALESCE(?, is_public)
       WHERE id = ?`,
      [
        cleanTitle || null,
        cleanDescription || null,
        tagsArray ? JSON.stringify(tagsArray) : null,
        talent_type || null,
        is_public !== undefined ? (is_public ? 1 : 0) : null,
        req.params.id,
      ]
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT v.*, u.username, u.full_name, u.avatar_url FROM videos v JOIN users u ON u.id = v.user_id WHERE v.id = ?',
      [req.params.id]
    );

    res.json({ success: true, data: formatVideo((rows as VideoRow[])[0], req) });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/videos/:id
export const deleteVideo = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT filename, thumbnail_url, user_id FROM videos WHERE id = ?',
      [req.params.id]
    );
    const video = (rows as VideoRow[])[0];

    if (!video || video.user_id !== req.user!.userId) {
      res.status(404).json({ success: false, error: 'Video not found or not yours' });
      return;
    }

    // Delete DB row (cascades to saved_videos, comments, likes, shares)
    await pool.query('DELETE FROM videos WHERE id = ?', [req.params.id]);

    // Delete files from disk
    const videoPath = path.join(UPLOAD_DIR, 'videos', video.filename);
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (video.thumbnail_url) {
      const thumbPath = path.join(UPLOAD_DIR, 'thumbnails', path.basename(video.thumbnail_url));
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }

    res.json({ success: true, data: null, message: 'Video deleted' });
  } catch (err) {
    next(err);
  }
};

// GET /api/videos/user/:userId  (user's own videos)
export const getUserVideos = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page   = parsePage(req.query.page as string);
    const limit  = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;
    const requesterId = req.user?.userId || '';
    const targetUserId = String(req.params.userId || '');
    const isOwnerView = requesterId && requesterId === targetUserId;

    let where = 'v.user_id = ?';
    const params: unknown[] = [targetUserId];
    if (!isOwnerView) {
      where += ' AND v.is_public = 1';
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT v.*, u.username, u.full_name, u.avatar_url
       FROM videos v JOIN users u ON u.id = v.user_id
       WHERE ${where}
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM videos v WHERE ${where}`,
      params
    );

    res.json({
      success: true,
      data: {
        items:      (rows as VideoRow[]).map(v => formatVideo(v, req)),
        total:      Number((total as any)),
        page,
        limit,
        totalPages: Math.ceil(Number((total as any)) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/videos/:id/like  or  /dislike 
export const likeVideo = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const type: 'like' | 'dislike' = req.path.endsWith('dislike') ? 'dislike' : 'like';
    const userId  = req.user!.userId;
    const videoId = req.params.id;

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT type FROM video_likes WHERE user_id = ? AND video_id = ?',
      [userId, videoId]
    );

    if ((existing as any[]).length) {
      // Already voted — locked, cannot change or remove
      const prev = (existing as any[])[0].type;
      res.status(409).json({ success: false, error: 'already_voted', data: { existing: prev } });
      return;
    } else {
      await pool.query('INSERT INTO video_likes (user_id, video_id, type) VALUES (?, ?, ?)', [userId, videoId, type]);
      await pool.query(`UPDATE videos SET ${type}s = ${type}s + 1 WHERE id = ?`, [videoId]);
      await safeTrackVideoEvent({
        videoId,
        userId,
        viewerKey: buildViewerKey(req),
        eventType: type as RecoEventType,
      });
    }

    const [[counts]] = await pool.query<RowDataPacket[]>(
      'SELECT likes, dislikes, views, filename, thumbnail_url, cycle_view_limit, cycle_number FROM videos WHERE id = ?',
      [videoId]
    );

    // Check threshold: only act if cycle not yet active
    if (type === 'dislike'
        && (counts as any).dislikes >= DISLIKE_LIMIT
        && (counts as any).cycle_view_limit === 0) {
      if ((counts as any).likes >= (counts as any).dislikes) {
        // Likes hold their own — enter Cycle 1
        await pool.query(
          'UPDATE videos SET cycle_number = 1, cycle_view_limit = ?, cycle_views_start = ? WHERE id = ?',
          [2 * DISLIKE_LIMIT, (counts as any).views, videoId]
        );
        console.log(`🔄  Video ${videoId} entered Cycle 1 (likes ${(counts as any).likes} >= dislikes ${(counts as any).dislikes})`);
        res.json({ success: true, data: { action: type, ...(counts as object), cycle: 1 } });
      } else {
        // Dislikes dominate — delete
        deleteVideoFiles(counts as any);
        await pool.query('DELETE FROM videos WHERE id = ?', [videoId]);
        console.log(`[DEL] Video ${videoId} deleted at threshold (dislikes ${(counts as any).dislikes} > likes ${(counts as any).likes})`);
        res.json({ success: true, data: { action: type, removed: true } });
      }
      return;
    }

    res.json({ success: true, data: { action: type, ...(counts as object) } });
  } catch (err) {
    next(err);
  }
};

// POST /api/videos/:id/save
export const saveVideo = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const userId  = req.user!.userId;
    const videoId = req.params.id;

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT 1 FROM saved_videos WHERE user_id = ? AND video_id = ?',
      [userId, videoId]
    );

    if ((existing as any[]).length) {
      await pool.query('DELETE FROM saved_videos WHERE user_id = ? AND video_id = ?', [userId, videoId]);
      res.json({ success: true, data: { saved: false } });
    } else {
      await pool.query('INSERT INTO saved_videos (user_id, video_id) VALUES (?, ?)', [userId, videoId]);
      await safeTrackVideoEvent({
        videoId,
        userId,
        viewerKey: buildViewerKey(req),
        eventType: 'save',
      });
      res.json({ success: true, data: { saved: true } });
    }
  } catch (err) {
    next(err);
  }
};

// GET /api/videos/saved  (my saved videos)
export const getSavedVideos = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page   = parsePage(req.query.page as string);
    const limit  = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT v.*, u.username, u.full_name, u.avatar_url, 1 AS is_saved
       FROM saved_videos sv
       JOIN videos v ON v.id = sv.video_id
       JOIN users u ON u.id = v.user_id
       WHERE sv.user_id = ?
         AND (v.is_public = 1 OR v.user_id = ?)
       ORDER BY sv.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user!.userId, req.user!.userId, limit, offset]
    );

    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM saved_videos sv
       JOIN videos v ON v.id = sv.video_id
       WHERE sv.user_id = ?
         AND (v.is_public = 1 OR v.user_id = ?)`,
      [req.user!.userId, req.user!.userId]
    );

    res.json({
      success: true,
      data: {
        items:      (rows as VideoRow[]).map(v => formatVideo(v, req)),
        total:      Number((total as any)),
        page,
        limit,
        totalPages: Math.ceil(Number((total as any)) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/videos/:id/share
export const shareVideo = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { platform } = req.body;
    await pool.query(
      'INSERT INTO shared_videos (id, user_id, video_id, platform) VALUES (?, ?, ?, ?)',
      [uuid(), req.user!.userId, req.params.id, platform || 'app']
    );
    await safeTrackVideoEvent({
      videoId: req.params.id,
      userId: req.user!.userId,
      viewerKey: buildViewerKey(req),
      eventType: 'share',
      metadata: { platform: platform || 'app' },
    });
    res.json({ success: true, data: { shared: true, platform: platform || 'app' } });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/videos/:id/share  (remove from my shared list)
export const unshareVideo = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    // Keep backward compatibility: remove only one shared entry for this video.
    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM shared_videos
       WHERE id = (
         SELECT id FROM (
           SELECT id
           FROM shared_videos
           WHERE user_id = ? AND video_id = ?
           ORDER BY created_at DESC
           LIMIT 1
         ) AS t
       )`,
      [req.user!.userId, req.params.id]
    );
    res.json({ success: true, data: { removed: result.affectedRows > 0 } });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/videos/shared/:shareId  (remove one exact shared row)
export const unshareVideoByShareId = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM shared_videos WHERE id = ? AND user_id = ?',
      [req.params.shareId, req.user!.userId]
    );
    res.json({ success: true, data: { removed: result.affectedRows > 0 } });
  } catch (err) {
    next(err);
  }
};

// GET /api/videos/shared  (my shared videos)
export const getSharedVideos = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page   = parsePage(req.query.page as string);
    const limit  = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT v.*, u.username, u.full_name, u.avatar_url,
              shv.id AS share_id, shv.platform, shv.created_at AS shared_at
       FROM shared_videos shv
       JOIN videos v ON v.id = shv.video_id
       JOIN users u ON u.id = v.user_id
       WHERE shv.user_id = ?
         AND (v.is_public = 1 OR v.user_id = ?)
       ORDER BY shv.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user!.userId, req.user!.userId, limit, offset]
    );

    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM shared_videos shv
       JOIN videos v ON v.id = shv.video_id
       WHERE shv.user_id = ?
         AND (v.is_public = 1 OR v.user_id = ?)`,
      [req.user!.userId, req.user!.userId]
    );

    res.json({
      success: true,
      data: {
        items:      (rows as VideoRow[]).map(v => formatVideo(v, req)),
        total:      Number((total as any)),
        page,
        limit,
        totalPages: Math.ceil(Number((total as any)) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

// User-Facing: Report Video
export const reportVideo = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { reason, description } = req.body;
    if (!reason) {
      res.status(400).json({ success: false, error: 'Reason is required' });
      return;
    }
    const id = uuid();
    await pool.query(
      `INSERT INTO reports (id, reporter_id, entity_type, entity_id, reason, description, priority)
       VALUES (?, ?, 'video', ?, ?, ?, 'medium')`,
      [id, req.user!.userId, req.params.id, reason, description || null]
    );
    await safeTrackVideoEvent({
      videoId: req.params.id,
      userId: req.user!.userId,
      viewerKey: buildViewerKey(req),
      eventType: 'report_video',
      metadata: { reason: String(reason) },
    });
    res.status(201).json({
      success: true,
      data: { id, message: 'Report submitted. Thank you for helping keep our platform safe.' },
    });
  } catch (err) {
    next(err);
  }
};

// User-Facing: Get My Strikes
export const getMyStrikes = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, reason, strike_type, expires_at, created_at, is_active FROM user_strikes
       WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC`,
      [req.user!.userId]
    );
    res.json({
      success: true,
      data: {
        strikes: rows,
        totalStrikes: rows.length,
        message: rows.length > 0 
          ? `You have ${rows.length} active strike(s). Accumulating too many strikes may result in account suspension.`
          : 'You have no active strikes. Keep up the good behavior!',
      },
    });
  } catch (err) {
    next(err);
  }
};

// Helper: Check if video uploader is shadow banned
const isUploaderShadowBanned = async (userId: string): Promise<boolean> => {
  try {
    const [[u]] = await pool.query<RowDataPacket[]>(
      'SELECT shadow_banned FROM users WHERE id = ? LIMIT 1',
      [userId]
    ) as any;
    return Boolean(u?.shadow_banned);
  } catch {
    return false;
  }
};
