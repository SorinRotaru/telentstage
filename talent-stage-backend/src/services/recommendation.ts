import { v4 as uuid } from 'uuid';
import { RowDataPacket } from 'mysql2';
import pool from '../config/database';

export type RecoEventType =
  | 'impression'
  | 'watch_progress'
  | 'completion'
  | 'skip'
  | 'quick_skip'
  | 'like'
  | 'dislike'
  | 'save'
  | 'share'
  | 'report_video'
  | 'report_comment';

export interface TrackVideoEventInput {
  videoId: string;
  userId?: string | null;
  viewerKey?: string | null;
  eventType: RecoEventType;
  eventValue?: number | null;
  watchSeconds?: number | null;
  metadata?: Record<string, unknown> | null;
}

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const affinityDeltaForEvent = (
  eventType: RecoEventType,
  eventValue?: number | null
): number => {
  switch (eventType) {
    case 'impression':
      return 0.03;
    case 'watch_progress': {
      const pct = clamp(Number(eventValue || 0), 0, 100);
      if (pct >= 100) return 1.0;
      if (pct >= 75) return 0.7;
      if (pct >= 50) return 0.4;
      if (pct >= 25) return 0.15;
      if (pct <= 10) return -0.2;
      return 0;
    }
    case 'completion':
      return 1.2;
    case 'quick_skip':
      return -1.2;
    case 'skip':
      return -0.3;
    case 'like':
      return 1.0;
    case 'dislike':
      return -1.8;
    case 'save':
      return 1.8;
    case 'share':
      return 1.4;
    case 'report_video':
    case 'report_comment':
      return -2.5;
    default:
      return 0;
  }
};

const upsertAffinity = async (
  userId: string,
  talentType: string,
  delta: number
): Promise<void> => {
  if (!Number.isFinite(delta) || delta === 0) return;
  await pool.query(
    `INSERT INTO user_category_affinity (user_id, talent_type, score, event_count, last_event_at)
     VALUES (?, ?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE
       score = score + VALUES(score),
       event_count = event_count + 1,
       last_event_at = NOW()`,
    [userId, talentType, delta]
  );
};

export const trackVideoEvent = async (input: TrackVideoEventInput): Promise<void> => {
  const videoId = String(input.videoId || '').trim();
  if (!videoId) return;

  const userId = input.userId ? String(input.userId).trim() : null;
  const viewerKey = input.viewerKey ? String(input.viewerKey).trim() : null;
  const eventType = input.eventType;
  const eventValue = Number.isFinite(Number(input.eventValue)) ? Number(input.eventValue) : null;
  const watchSeconds = Number.isFinite(Number(input.watchSeconds)) ? Number(input.watchSeconds) : null;
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  const [videoRows] = await pool.query<RowDataPacket[]>(
    `SELECT id,
            CASE
              WHEN talent_type IS NULL OR TRIM(talent_type) = '' THEN 'Uncategorized'
              ELSE talent_type
            END AS talent_type
     FROM videos
     WHERE id = ?
     LIMIT 1`,
    [videoId]
  );
  const video = videoRows[0];
  if (!video) return;
  const talentType = String(video.talent_type || 'Uncategorized');

  await pool.query(
    `INSERT INTO video_engagement_events
      (id, video_id, user_id, viewer_key, event_type, event_value, watch_seconds, talent_type, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      videoId,
      userId || null,
      viewerKey || null,
      eventType,
      eventValue,
      watchSeconds,
      talentType,
      metadataJson,
    ]
  );

  if (!userId) return;
  const delta = affinityDeltaForEvent(eventType, eventValue);
  await upsertAffinity(userId, talentType, delta);
};

export const safeTrackVideoEvent = async (input: TrackVideoEventInput): Promise<void> => {
  try {
    await trackVideoEvent(input);
  } catch {
    // Signal tracking must never break user flows.
  }
};

