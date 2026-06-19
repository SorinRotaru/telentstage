import { Response, NextFunction } from 'express';
import { RowDataPacket } from 'mysql2';
import { v4 as uuid } from 'uuid';
import pool from '../config/database';
import { isFeatureFlagEnabled } from '../config/runtimeFlags';
import { AuthRequest, CommentRow } from '../models/types';
import { safeTrackVideoEvent } from '../services/recommendation';

const parsePage  = (p?: string) => Math.max(1, parseInt(p || '1'));
const parseLimit = (l?: string) => Math.min(100, Math.max(1, parseInt(l || '30')));

// GET /api/videos/:id/comments
export const getComments = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page   = parsePage(req.query.page as string);
    const limit  = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;
    const userId = req.user?.userId;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.video_id, c.user_id, c.parent_comment_id, c.body, c.likes_count, c.created_at,
              u.username, u.full_name, u.avatar_url,
              (SELECT COUNT(*) FROM comments rc WHERE rc.parent_comment_id = c.id AND IFNULL(rc.is_hidden, 0) = 0) AS reply_count,
              ${userId
                ? '(SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) AS is_liked'
                : '0 AS is_liked'}
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.video_id = ? AND IFNULL(c.is_hidden, 0) = 0
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      userId ? [userId, req.params.id, limit, offset] : [req.params.id, limit, offset]
    );

    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM comments WHERE video_id = ? AND IFNULL(is_hidden, 0) = 0',
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        items:      rows as CommentRow[],
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

// POST /api/videos/:id/comments
export const addComment = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    if (!(await isFeatureFlagEnabled('comments_enabled', true))) {
      res.status(503).json({ success: false, error: 'Comments are currently disabled' });
      return;
    }

    const { body, parent_comment_id } = req.body as { body?: string; parent_comment_id?: string | null };
    if (!body?.trim()) {
      res.status(400).json({ success: false, error: 'Comment body is required' });
      return;
    }

    let parentCommentId: string | null = null;
    if (parent_comment_id) {
      const [parentRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, video_id, is_hidden FROM comments WHERE id = ? LIMIT 1',
        [parent_comment_id]
      );
      const parent = parentRows[0];
      if (!parent) {
        res.status(404).json({ success: false, error: 'Parent comment not found' });
        return;
      }
      if (Number(parent.is_hidden || 0) === 1) {
        res.status(404).json({ success: false, error: 'Parent comment not found' });
        return;
      }
      if (String(parent.video_id) !== String(req.params.id)) {
        res.status(400).json({ success: false, error: 'Parent comment must belong to the same video' });
        return;
      }
      parentCommentId = String(parent.id);
    }

    const id = uuid();
    await pool.query(
      'INSERT INTO comments (id, video_id, user_id, parent_comment_id, body, likes_count) VALUES (?, ?, ?, ?, ?, 0)',
      [id, req.params.id, req.user!.userId, parentCommentId, body.trim()]
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.video_id, c.user_id, c.parent_comment_id, c.body, c.likes_count, c.created_at,
              u.username, u.full_name, u.avatar_url,
              0 AS reply_count,
              0 AS is_liked
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`,
      [id]
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/videos/:videoId/comments/:commentId
export const deleteComment = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM comments WHERE id = ? AND user_id = ?',
      [req.params.commentId, req.user!.userId]
    );
    if (!(existing as any[]).length) {
      res.status(404).json({ success: false, error: 'Comment not found or not yours' });
      return;
    }
    await pool.query(
      'DELETE FROM comments WHERE id = ? OR parent_comment_id = ?',
      [req.params.commentId, req.params.commentId]
    );
    res.json({ success: true, data: null, message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
};

// POST /api/videos/:id/comments/:commentId/like
export const toggleCommentLike = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  const conn = await pool.getConnection();
  try {
    const commentId = req.params.commentId;
    const videoId = req.params.id;
    const userId = req.user!.userId;

    await conn.beginTransaction();

    const [commentRows] = await conn.query<RowDataPacket[]>(
      'SELECT id FROM comments WHERE id = ? AND video_id = ? AND IFNULL(is_hidden, 0) = 0 LIMIT 1 FOR UPDATE',
      [commentId, videoId]
    );
    if (!(commentRows as any[]).length) {
      await conn.rollback();
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    const [existing] = await conn.query<RowDataPacket[]>(
      'SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ? LIMIT 1',
      [commentId, userId]
    );

    let liked = false;
    if ((existing as any[]).length) {
      await conn.query(
        'DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?',
        [commentId, userId]
      );
      await conn.query(
        'UPDATE comments SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ?',
        [commentId]
      );
      liked = false;
    } else {
      await conn.query(
        'INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)',
        [commentId, userId]
      );
      await conn.query(
        'UPDATE comments SET likes_count = likes_count + 1 WHERE id = ?',
        [commentId]
      );
      liked = true;
    }

    const [[updated]] = await conn.query<RowDataPacket[]>(
      'SELECT likes_count FROM comments WHERE id = ? LIMIT 1',
      [commentId]
    ) as any;

    await conn.commit();

    res.json({
      success: true,
      data: {
        liked,
        likes_count: Number(updated?.likes_count || 0),
      },
    });
  } catch (err) {
    try { await conn.rollback(); } catch { /* no-op */ }
    next(err);
  } finally {
    conn.release();
  }
};

// POST /api/videos/:id/comments/:commentId/report
export const reportComment = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { reason, description } = req.body;
    if (!reason) {
      res.status(400).json({ success: false, error: 'Reason is required' });
      return;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, user_id FROM comments WHERE id = ? AND video_id = ? AND IFNULL(is_hidden, 0) = 0 LIMIT 1',
      [req.params.commentId, req.params.id]
    );
    const comment = rows[0];
    if (!comment) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    if (String(comment.user_id) === String(req.user!.userId)) {
      res.status(400).json({ success: false, error: 'You cannot report your own comment' });
      return;
    }

    const id = uuid();
    await pool.query(
      `INSERT INTO reports (id, reporter_id, entity_type, entity_id, reason, description, priority)
       VALUES (?, ?, 'comment', ?, ?, ?, 'medium')`,
      [id, req.user!.userId, req.params.commentId, reason, description || null]
    );
    await safeTrackVideoEvent({
      videoId: req.params.id,
      userId: req.user!.userId,
      viewerKey: req.user?.userId || String(req.socket.remoteAddress || 'anon'),
      eventType: 'report_comment',
      metadata: { reason: String(reason), comment_id: req.params.commentId },
    });

    res.status(201).json({
      success: true,
      data: { id, message: 'Comment reported successfully. Thank you for helping keep our platform safe.' },
    });
  } catch (err) {
    next(err);
  }
};

export const purgeExpiredModerationHiddenComments = async (): Promise<void> => {
  // 1) If linked report is already reviewed, cancel auto-delete hold.
  await pool.query(
    `UPDATE comments c
     JOIN reports r ON r.id = c.moderation_hold_report_id
     SET c.moderation_hold_set_at = NULL,
         c.moderation_hold_until = NULL,
         c.moderation_hold_report_id = NULL
     WHERE c.moderation_hold_until IS NOT NULL
       AND r.status IN ('resolved', 'dismissed')`
  );

  // 2) Auto-delete expired hidden comments only if report is still unreviewed.
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.body, c.moderation_hold_report_id
     FROM comments c
     LEFT JOIN reports r ON r.id = c.moderation_hold_report_id
     WHERE IFNULL(c.is_hidden, 0) = 1
       AND c.moderation_hold_until IS NOT NULL
       AND c.moderation_hold_until <= NOW()
       AND (
         c.moderation_hold_report_id IS NULL
         OR r.id IS NULL
         OR r.status IN ('pending', 'reviewing')
       )`
  );

  let deletedCount = 0;
  for (const row of rows as any[]) {
    await pool.query('DELETE FROM comments WHERE id = ?', [row.id]);
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
          'comment_auto_deleted_unreviewed_90d',
          'comment',
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
    console.log(`🧹  Auto-deleted ${deletedCount} hidden unreviewed comment(s) after 90 days`);
  }
};
