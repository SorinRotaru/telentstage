import { Response, NextFunction } from 'express';
import { RowDataPacket } from 'mysql2';
import { v4 as uuid } from 'uuid';
import pool from '../config/database';
import { AuthRequest } from '../models/types';

const parsePage  = (p?: string) => Math.max(1, parseInt(p || '1'));
const parseLimit = (l?: string) => Math.min(100, Math.max(1, parseInt(l || '20')));
const toNum = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const safeRate = (num: number, den: number): number => (den > 0 ? num / den : 0);
const pctDelta = (cur: number, prev: number): number => {
  if (prev === 0) return cur > 0 ? 1 : 0;
  return (cur - prev) / prev;
};

const fixAvatarUrl = (avatar_url: string | null | undefined, req: AuthRequest): string | null => {
  if (!avatar_url || !avatar_url.includes('localhost')) return avatar_url ?? null;
  return avatar_url.replace(/https?:\/\/localhost(:\d+)?/, `${req.protocol}://${req.get('host')}`);
};

// GET /api/users  — list / search users (browse talents)
export const getUsers = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page = parsePage(req.query.page as string);
    const limit = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;
    const talent_type = req.query.talent_type as string | undefined;
    const talent_types = req.query.talent_types as string | undefined;
    const search = req.query.search as string | undefined;
    const creatorsOnlyRaw = String(req.query.creators_only || '').toLowerCase();
    const creatorsOnly = creatorsOnlyRaw === '1' || creatorsOnlyRaw === 'true';
    const currentId = req.user?.userId;
    const talentTypeFilters = Array.from(new Set([
      ...(talent_type ? [talent_type] : []),
      ...(talent_types ? talent_types.split(',') : []),
    ]))
      .map((t) => String(t || '').trim().toLowerCase())
      .filter(Boolean);

    let where = 'u.is_active = 1';
    const params: unknown[] = [];
    if (creatorsOnly) {
      if (talentTypeFilters.length > 0) {
        const placeholders = talentTypeFilters.map(() => '?').join(', ');
        where += `
          AND EXISTS (
            SELECT 1
            FROM videos v
            WHERE v.user_id = u.id
              AND v.is_public = 1
              AND LOWER(TRIM(COALESCE(v.talent_type, ''))) IN (${placeholders})
          )
        `;
        params.push(...talentTypeFilters);
      } else {
        where += `
          AND EXISTS (
            SELECT 1
            FROM videos v
            WHERE v.user_id = u.id
              AND v.is_public = 1
              AND TRIM(COALESCE(v.talent_type, '')) <> ''
              AND LOWER(TRIM(COALESCE(v.talent_type, ''))) <> 'viewer'
          )
        `;
      }
    } else if (talentTypeFilters.length > 0) {
      const placeholders = talentTypeFilters.map(() => '?').join(', ');
      where += ` AND LOWER(TRIM(COALESCE(u.talent_type, ''))) IN (${placeholders})`;
      params.push(...talentTypeFilters);
    }
    if (search) {
      where += ' AND (LOWER(u.username) LIKE ? OR LOWER(u.full_name) LIKE ?)';
      const like = `%${search.toLowerCase()}%`;
      params.push(like, like);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.full_name, u.avatar_url, u.talent_type, u.bio, u.website,
              (SELECT COUNT(*) FROM videos v WHERE v.user_id = u.id AND v.is_public = 1) AS video_count,
              (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count,
              (SELECT COUNT(*) FROM follows f WHERE f.follower_id  = u.id) AS following_count,
              ${currentId ? '(SELECT COUNT(*) FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id) AS is_followed' : '0 AS is_followed'}
       FROM users u WHERE ${where}
       ORDER BY follower_count DESC
       LIMIT ? OFFSET ?`,
      currentId ? [currentId, ...params, limit, offset] : [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM users u WHERE ${where}`,
      params
    );

    res.json({
      success: true,
      data: {
        items:      rows.map(r => ({ ...r, avatar_url: fixAvatarUrl(r.avatar_url, req) })),
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

// GET /api/users/:id
export const getUser = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const currentId = req.user?.userId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.full_name, u.avatar_url, u.talent_type, u.bio, u.website, u.created_at,
              (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count,
              (SELECT COUNT(*) FROM follows f WHERE f.follower_id  = u.id) AS following_count,
              (SELECT COUNT(*) FROM videos v WHERE v.user_id = u.id AND v.is_public = 1) AS video_count,
              ${currentId ? '(SELECT COUNT(*) FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id) AS is_followed' : '0 AS is_followed'}
       FROM users u WHERE u.id = ? AND u.is_active = 1`,
      currentId ? [currentId, req.params.id] : [req.params.id]
    );

    if (!(rows as any[]).length) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    const u = rows[0];
    res.json({ success: true, data: { ...u, avatar_url: fixAvatarUrl(u.avatar_url, req) } });
  } catch (err) {
    next(err);
  }
};

// GET /api/users/:id/creator-analytics
export const getCreatorAnalytics = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) {
      res.status(400).json({ success: false, error: 'Invalid user id' });
      return;
    }

    const [[creator]] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, full_name
       FROM users
       WHERE id = ? AND is_active = 1
       LIMIT 1`,
      [userId]
    ) as any;
    if (!creator) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const [[lifetime]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS videos_count,
              IFNULL(SUM(v.views), 0) AS total_views,
              IFNULL(SUM(v.unique_views), 0) AS total_unique_views,
              IFNULL(SUM(v.likes), 0) AS total_likes,
              IFNULL(SUM(v.dislikes), 0) AS total_dislikes
       FROM videos v
       WHERE v.user_id = ?`,
      [userId]
    ) as any;

    const [[eng30]] = await pool.query<RowDataPacket[]>(
      `SELECT
          SUM(CASE WHEN vee.event_type = 'impression' THEN 1 ELSE 0 END) AS impressions_30d,
          SUM(CASE WHEN vee.event_type = 'completion' THEN 1 ELSE 0 END) AS completions_30d,
          SUM(CASE WHEN vee.event_type IN ('skip', 'quick_skip') THEN 1 ELSE 0 END) AS skips_30d,
          SUM(CASE WHEN vee.event_type = 'like' THEN 1 ELSE 0 END) AS likes_30d,
          SUM(CASE WHEN vee.event_type = 'save' THEN 1 ELSE 0 END) AS saves_30d,
          SUM(CASE WHEN vee.event_type = 'share' THEN 1 ELSE 0 END) AS shares_30d,
          IFNULL(AVG(CASE WHEN vee.watch_seconds IS NOT NULL THEN vee.watch_seconds END), 0) AS avg_watch_seconds_30d,
          COUNT(DISTINCT CASE
            WHEN vee.user_id IS NOT NULL THEN CONCAT('u:', vee.user_id)
            WHEN vee.viewer_key IS NOT NULL AND TRIM(vee.viewer_key) <> '' THEN CONCAT('v:', vee.viewer_key)
            ELSE NULL
          END) AS unique_viewers_30d
       FROM video_engagement_events vee
       JOIN videos v ON v.id = vee.video_id
       WHERE v.user_id = ?
         AND vee.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [userId]
    ) as any;

    const [[comments30]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS comments_30d
       FROM comments c
       JOIN videos v ON v.id = c.video_id
       WHERE v.user_id = ?
         AND IFNULL(c.is_hidden, 0) = 0
         AND c.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [userId]
    ) as any;

    const [[reports30]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS reports_30d
       FROM reports r
       JOIN videos v
         ON v.id COLLATE utf8mb4_unicode_ci = r.entity_id COLLATE utf8mb4_unicode_ci
       WHERE r.entity_type = 'video'
         AND v.user_id = ?
         AND r.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [userId]
    ) as any;

    const [[followers30]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS new_followers_30d
       FROM follows f
       WHERE f.following_id = ?
         AND f.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [userId]
    ) as any;

    const [[last7]] = await pool.query<RowDataPacket[]>(
      `SELECT
          SUM(CASE WHEN vee.event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
          SUM(CASE WHEN vee.event_type = 'completion' THEN 1 ELSE 0 END) AS completions,
          SUM(CASE WHEN vee.event_type IN ('skip', 'quick_skip') THEN 1 ELSE 0 END) AS skips,
          IFNULL(AVG(CASE WHEN vee.watch_seconds IS NOT NULL THEN vee.watch_seconds END), 0) AS avg_watch_seconds
       FROM video_engagement_events vee
       JOIN videos v ON v.id = vee.video_id
       WHERE v.user_id = ?
         AND vee.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [userId]
    ) as any;

    const [[prev7]] = await pool.query<RowDataPacket[]>(
      `SELECT
          SUM(CASE WHEN vee.event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
          SUM(CASE WHEN vee.event_type = 'completion' THEN 1 ELSE 0 END) AS completions,
          SUM(CASE WHEN vee.event_type IN ('skip', 'quick_skip') THEN 1 ELSE 0 END) AS skips,
          IFNULL(AVG(CASE WHEN vee.watch_seconds IS NOT NULL THEN vee.watch_seconds END), 0) AS avg_watch_seconds
       FROM video_engagement_events vee
       JOIN videos v ON v.id = vee.video_id
       WHERE v.user_id = ?
         AND vee.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
         AND vee.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [userId]
    ) as any;

    const [[followersLast7]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM follows f
       WHERE f.following_id = ?
         AND f.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [userId]
    ) as any;

    const [[followersPrev7]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM follows f
       WHERE f.following_id = ?
         AND f.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
         AND f.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [userId]
    ) as any;

    const [trendRows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE(vee.created_at) AS date,
              SUM(CASE WHEN vee.event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
              SUM(CASE WHEN vee.event_type = 'completion' THEN 1 ELSE 0 END) AS completions,
              SUM(CASE WHEN vee.event_type IN ('skip', 'quick_skip') THEN 1 ELSE 0 END) AS skips,
              SUM(CASE WHEN vee.event_type = 'like' THEN 1 ELSE 0 END) AS likes,
              SUM(CASE WHEN vee.event_type = 'save' THEN 1 ELSE 0 END) AS saves,
              SUM(CASE WHEN vee.event_type = 'share' THEN 1 ELSE 0 END) AS shares,
              IFNULL(AVG(CASE WHEN vee.watch_seconds IS NOT NULL THEN vee.watch_seconds END), 0) AS avg_watch_seconds
       FROM video_engagement_events vee
       JOIN videos v ON v.id = vee.video_id
       WHERE v.user_id = ?
         AND vee.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY DATE(vee.created_at)
       ORDER BY date ASC`,
      [userId]
    );

    const [videoRows] = await pool.query<RowDataPacket[]>(
      `SELECT v.id, v.title, v.views, v.unique_views, v.likes, v.dislikes, v.created_at,
              CASE
                WHEN v.filename IS NOT NULL THEN CONCAT('/uploads/videos/', v.filename)
                ELSE NULL
              END AS file_url,
              IFNULL(e.impressions_30d, 0) AS impressions_30d,
              IFNULL(e.completions_30d, 0) AS completions_30d,
              IFNULL(e.skips_30d, 0) AS skips_30d,
              IFNULL(e.likes_30d, 0) AS likes_30d,
              IFNULL(e.saves_30d, 0) AS saves_30d,
              IFNULL(e.shares_30d, 0) AS shares_30d,
              IFNULL(e.avg_watch_seconds_30d, 0) AS avg_watch_seconds_30d,
              IFNULL(c.comments_30d, 0) AS comments_30d,
              IFNULL(r.reports_30d, 0) AS reports_30d
       FROM videos v
       LEFT JOIN (
         SELECT vee.video_id,
                SUM(CASE WHEN vee.event_type = 'impression' THEN 1 ELSE 0 END) AS impressions_30d,
                SUM(CASE WHEN vee.event_type = 'completion' THEN 1 ELSE 0 END) AS completions_30d,
                SUM(CASE WHEN vee.event_type IN ('skip', 'quick_skip') THEN 1 ELSE 0 END) AS skips_30d,
                SUM(CASE WHEN vee.event_type = 'like' THEN 1 ELSE 0 END) AS likes_30d,
                SUM(CASE WHEN vee.event_type = 'save' THEN 1 ELSE 0 END) AS saves_30d,
                SUM(CASE WHEN vee.event_type = 'share' THEN 1 ELSE 0 END) AS shares_30d,
                IFNULL(AVG(CASE WHEN vee.watch_seconds IS NOT NULL THEN vee.watch_seconds END), 0) AS avg_watch_seconds_30d
         FROM video_engagement_events vee
         WHERE vee.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY vee.video_id
       ) e ON e.video_id = v.id
       LEFT JOIN (
         SELECT c.video_id, COUNT(*) AS comments_30d
         FROM comments c
         WHERE IFNULL(c.is_hidden, 0) = 0
           AND c.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY c.video_id
       ) c ON c.video_id = v.id
       LEFT JOIN (
         SELECT r.entity_id AS video_id, COUNT(*) AS reports_30d
         FROM reports r
         WHERE r.entity_type = 'video'
           AND r.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY r.entity_id
       ) r ON r.video_id COLLATE utf8mb4_unicode_ci = v.id COLLATE utf8mb4_unicode_ci
       WHERE v.user_id = ?
       ORDER BY v.created_at DESC`,
      [userId]
    );

    const mappedVideos = (videoRows || []).map((row) => {
      const impressions = toNum(row.impressions_30d);
      const completions = toNum(row.completions_30d);
      const skips = toNum(row.skips_30d);
      const likes = toNum(row.likes_30d);
      const saves = toNum(row.saves_30d);
      const shares = toNum(row.shares_30d);
      const comments = toNum(row.comments_30d);
      const reports = toNum(row.reports_30d);
      const completionRate = safeRate(completions, impressions);
      const skipRate = safeRate(skips, impressions);
      const engagementRate = safeRate(likes + saves + shares + comments, impressions);
      const saveRate = safeRate(saves, impressions);
      const shareRate = safeRate(shares, impressions);
      const reportRate = safeRate(reports, impressions);
      const qualityScore = (
        (0.35 * completionRate) +
        (0.24 * engagementRate) +
        (0.12 * shareRate) +
        (0.1 * saveRate) -
        (0.22 * skipRate) -
        (0.18 * reportRate)
      );

      const reasons: string[] = [];
      if (completionRate < 0.28) reasons.push('Low completion');
      if (skipRate > 0.45) reasons.push('High skip');
      if (engagementRate < 0.04) reasons.push('Low engagement');
      if (reportRate > 0.01) reasons.push('High report rate');
      if (reasons.length === 0) reasons.push('Stable performance');

      return {
        id: String(row.id),
        title: String(row.title || 'Untitled'),
        file_url: row.file_url || null,
        created_at: row.created_at,
        views: toNum(row.views),
        unique_views: toNum(row.unique_views),
        likes: toNum(row.likes),
        dislikes: toNum(row.dislikes),
        impressions_30d: impressions,
        avg_watch_seconds_30d: toNum(row.avg_watch_seconds_30d),
        completion_rate_30d: completionRate,
        skip_rate_30d: skipRate,
        engagement_rate_30d: engagementRate,
        save_rate_30d: saveRate,
        share_rate_30d: shareRate,
        report_rate_30d: reportRate,
        comments_30d: comments,
        quality_score: qualityScore,
        reasons,
      };
    });

    const topVideos = [...mappedVideos]
      .sort((a, b) => b.quality_score - a.quality_score)
      .slice(0, 5);
    const bottomVideos = [...mappedVideos]
      .sort((a, b) => a.quality_score - b.quality_score)
      .slice(0, 5);

    const impressions30 = toNum(eng30?.impressions_30d);
    const completions30 = toNum(eng30?.completions_30d);
    const skips30 = toNum(eng30?.skips_30d);
    const likes30 = toNum(eng30?.likes_30d);
    const saves30 = toNum(eng30?.saves_30d);
    const shares30 = toNum(eng30?.shares_30d);
    const comments30n = toNum(comments30?.comments_30d);
    const reports30n = toNum(reports30?.reports_30d);
    const uniqueViewers30 = toNum(eng30?.unique_viewers_30d);
    const followers30n = toNum(followers30?.new_followers_30d);

    const completionRate30 = safeRate(completions30, impressions30);
    const skipRate30 = safeRate(skips30, impressions30);
    const engagementRate30 = safeRate(likes30 + saves30 + shares30 + comments30n, impressions30);
    const saveRate30 = safeRate(saves30, impressions30);
    const shareRate30 = safeRate(shares30, impressions30);
    const reportRate30 = safeRate(reports30n, impressions30);
    const followConversion30 = safeRate(followers30n, uniqueViewers30);
    const likeDislikeRatio = safeRate(toNum(lifetime?.total_likes), Math.max(1, toNum(lifetime?.total_dislikes)));

    const curImpressions = toNum(last7?.impressions);
    const prevImpressions = toNum(prev7?.impressions);
    const curCompletion = safeRate(toNum(last7?.completions), curImpressions);
    const prevCompletion = safeRate(toNum(prev7?.completions), prevImpressions);
    const curSkip = safeRate(toNum(last7?.skips), curImpressions);
    const prevSkip = safeRate(toNum(prev7?.skips), prevImpressions);
    const curAvgWatch = toNum(last7?.avg_watch_seconds);
    const prevAvgWatch = toNum(prev7?.avg_watch_seconds);
    const curFollowers7 = toNum(followersLast7?.cnt);
    const prevFollowers7 = toNum(followersPrev7?.cnt);

    const actionTips: string[] = [];
    if (completionRate30 < 0.3) actionTips.push('Low completion rate: tighten first 2-3 seconds and faster hook.');
    if (skipRate30 > 0.45) actionTips.push('High skip rate: shorten intros and reduce dead time at start.');
    if (engagementRate30 < 0.05) actionTips.push('Low engagement: add stronger CTA for comments/saves/shares.');
    if (followConversion30 < 0.01) actionTips.push('Low follower conversion: remind viewers to follow for series content.');
    if (reportRate30 > 0.01) actionTips.push('Report rate is elevated: review recent content for policy-risk patterns.');
    if (actionTips.length === 0) actionTips.push('Performance is healthy. Keep posting cadence and replicate top video patterns.');

    res.json({
      success: true,
      data: {
        creator: {
          id: creator.id,
          username: creator.username,
          full_name: creator.full_name,
        },
        overview_30d: {
          videos_count: toNum(lifetime?.videos_count),
          total_views: toNum(lifetime?.total_views),
          total_unique_views: toNum(lifetime?.total_unique_views),
          unique_viewers_30d: uniqueViewers30,
          impressions_30d: impressions30,
          avg_watch_seconds_30d: toNum(eng30?.avg_watch_seconds_30d),
          completion_rate_30d: completionRate30,
          skip_rate_30d: skipRate30,
          engagement_rate_30d: engagementRate30,
          follow_conversion_30d: followConversion30,
          save_rate_30d: saveRate30,
          share_rate_30d: shareRate30,
          like_dislike_ratio: likeDislikeRatio,
          report_rate_30d: reportRate30,
          reports_30d: reports30n,
        },
        period_compare_7d: {
          current: {
            impressions: curImpressions,
            completion_rate: curCompletion,
            skip_rate: curSkip,
            avg_watch_seconds: curAvgWatch,
            new_followers: curFollowers7,
          },
          previous: {
            impressions: prevImpressions,
            completion_rate: prevCompletion,
            skip_rate: prevSkip,
            avg_watch_seconds: prevAvgWatch,
            new_followers: prevFollowers7,
          },
          delta: {
            impressions: pctDelta(curImpressions, prevImpressions),
            completion_rate: pctDelta(curCompletion, prevCompletion),
            skip_rate: pctDelta(curSkip, prevSkip),
            avg_watch_seconds: pctDelta(curAvgWatch, prevAvgWatch),
            new_followers: pctDelta(curFollowers7, prevFollowers7),
          },
        },
        trend_7d: trendRows.map((r) => ({
          date: r.date,
          impressions: toNum(r.impressions),
          avg_watch_seconds: toNum(r.avg_watch_seconds),
          completion_rate: safeRate(toNum(r.completions), toNum(r.impressions)),
          skip_rate: safeRate(toNum(r.skips), toNum(r.impressions)),
          likes: toNum(r.likes),
          saves: toNum(r.saves),
          shares: toNum(r.shares),
        })),
        videos: mappedVideos,
        top_videos: topVideos,
        bottom_videos: bottomVideos,
        action_tips: actionTips,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/users/:id/follow
export const followUser = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const followerId  = req.user!.userId;
    const followingId = req.params.id;

    if (followerId === followingId) {
      res.status(400).json({ success: false, error: 'You cannot follow yourself' });
      return;
    }

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
      [followerId, followingId]
    );

    if ((existing as any[]).length) {
      // unfollow
      await pool.query('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [followerId, followingId]);
      res.json({ success: true, data: { following: false } });
    } else {
      // follow
      await pool.query('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)', [followerId, followingId]);
      res.json({ success: true, data: { following: true } });
    }
  } catch (err) {
    next(err);
  }
};

// GET /api/users/:id/followers
export const getFollowers = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page   = parsePage(req.query.page as string);
    const limit  = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.full_name, u.avatar_url, u.talent_type, f.created_at AS followed_at
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = ?
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.params.id, limit, offset]
    );

    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM follows WHERE following_id = ?',
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        items:      rows.map(r => ({ ...r, avatar_url: fixAvatarUrl(r.avatar_url, req) })),
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

// GET /api/users/:id/following
export const getFollowing = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page   = parsePage(req.query.page as string);
    const limit  = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.full_name, u.avatar_url, u.talent_type, f.created_at AS followed_at
       FROM follows f JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = ?
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.params.id, limit, offset]
    );

    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM follows WHERE follower_id = ?',
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        items:      rows.map(r => ({ ...r, avatar_url: fixAvatarUrl(r.avatar_url, req) })),
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

// PUT /api/users/me/avatar  (upload avatar)
export const updateAvatar = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No image file provided' });
      return;
    }
    await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [req.file.filename, req.user!.userId]);
    res.json({
      success: true,
      data: {
        avatar_url: `${req.protocol}://${req.get('host')}/uploads/avatars/${req.file.filename}`,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/users/:id/report
export const reportUser = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { reason, description } = req.body;
    if (!reason) {
      res.status(400).json({ success: false, error: 'Reason is required' });
      return;
    }

    const reporterId = req.user!.userId;
    const targetUserId = req.params.id;
    if (reporterId === targetUserId) {
      res.status(400).json({ success: false, error: 'You cannot report yourself' });
      return;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ? LIMIT 1',
      [targetUserId]
    );
    if (!(rows as any[]).length) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const id = uuid();
    await pool.query(
      `INSERT INTO reports (id, reporter_id, entity_type, entity_id, reason, description, priority)
       VALUES (?, ?, 'user', ?, ?, ?, 'medium')`,
      [id, reporterId, targetUserId, reason, description || null]
    );

    res.status(201).json({
      success: true,
      data: { id, message: 'User reported successfully. Thank you for helping keep our platform safe.' },
    });
  } catch (err) {
    next(err);
  }
};
