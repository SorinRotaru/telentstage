import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import pool from '../config/database';
import { AdminRequest } from '../middleware/adminAuth';
import { UPLOAD_DIR } from '../middleware/upload';

const JWT_SECRET  = process.env.JWT_SECRET  || 'secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

const parsePage  = (p?: string) => Math.max(1, parseInt(p || '1'));
const parseLimit = (l?: string) => Math.min(100, Math.max(1, parseInt(l || '20')));

const getAdminAvatarFilename = (avatarUrl: string | null | undefined): string | null => {
  if (!avatarUrl) return null;
  try {
    return path.basename(new URL(avatarUrl).pathname);
  } catch {
    return path.basename(avatarUrl);
  }
};

const deleteAdminAvatarFile = (avatarUrl: string | null | undefined): void => {
  const filename = getAdminAvatarFilename(avatarUrl);
  if (!filename) return;
  const filePath = path.join(UPLOAD_DIR, 'avatars', filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

   HELPER — write an audit log entry
export const writeAuditLog = async (
  adminId: string | undefined,
  adminUsername: string | undefined,
  action: string,
  entityType?: string,
  entityId?: string,
  oldValue?: unknown,
  newValue?: unknown,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (id, admin_id, admin_username, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), adminId || null, adminUsername || null, action, entityType || null, entityId || null,
       oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null,
       ipAddress || null, userAgent || null]
    );
  } catch (e) { console.error('Audit log write failed:', e); }
};

   AUTH

// POST /api/admin/login
export const adminLogin = async (
  req: Request, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { username, password } = req.body;
    const ip = req.ip || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';

    if (!username || !password) {
      res.status(400).json({ success: false, error: 'username and password required' });
      return;
    }
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM admin_users WHERE (username = ? OR email = ?) AND is_active = 1 LIMIT 1',
      [username.toLowerCase().trim(), username.toLowerCase().trim()]
    );
    const admin = (rows as any[])[0];

    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      // Log failed attempt
      await pool.query(
        'INSERT INTO admin_login_attempts (id, username, ip_address, user_agent, success) VALUES (?, ?, ?, ?, 0)',
        [uuid(), username.toLowerCase().trim(), ip, ua]
      );
      await writeAuditLog(undefined, username, 'login_failed', 'admin', undefined, null, null, ip, ua);
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    await pool.query('UPDATE admin_users SET last_login = NOW() WHERE id = ?', [admin.id]);

    // Log successful attempt
    await pool.query(
      'INSERT INTO admin_login_attempts (id, username, ip_address, user_agent, success) VALUES (?, ?, ?, ?, 1)',
      [uuid(), admin.username, ip, ua]
    );
    await writeAuditLog(admin.id, admin.username, 'login_success', 'admin', admin.id, null, null, ip, ua);

    const token = jwt.sign(
      { adminId: admin.id, username: admin.username, role: admin.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES } as jwt.SignOptions
    );
    res.json({
      success: true,
      data: {
        token,
        admin: {
          id: admin.id, username: admin.username, email: admin.email,
          full_name: admin.full_name, role: admin.role, avatar_url: admin.avatar_url || null,
        },
      },
    });
  } catch (err) { next(err); }
};

// POST /api/admin/reset-password
export const adminResetPassword = async (
  req: Request, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { identifier, email, username, new_password } = req.body || {};
    const rawIdentifier = String(identifier || email || username || '').toLowerCase().trim();
    const nextPassword = String(new_password || '');

    if (!rawIdentifier || !nextPassword || nextPassword.length < 8) {
      res.status(400).json({ success: false, error: 'identifier and new_password (min 8 chars) required' });
      return;
    }

    const [rows] = await pool.query<any[]>(
      'SELECT id, username, email, is_active FROM admin_users WHERE (username = ? OR email = ?) LIMIT 1',
      [rawIdentifier, rawIdentifier]
    );
    const admin = (rows as any[])[0];
    if (!admin) {
      res.status(404).json({ success: false, error: 'No admin account found for this identifier' });
      return;
    }
    if (!admin.is_active) {
      res.status(403).json({ success: false, error: 'Admin account is inactive' });
      return;
    }

    const hash = await bcrypt.hash(nextPassword, 12);
    await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [hash, admin.id]);

    await writeAuditLog(
      undefined,
      admin.username,
      'admin_password_reset',
      'admin',
      admin.id,
      null,
      { via: 'forgot_password' },
      req.ip,
      Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'].join(' ') : req.headers['user-agent']
    );

    res.json({ success: true, data: { message: 'Password reset successful' } });
  } catch (err) { next(err); }
};

   DASHBOARD — enhanced with reports & strikes stats

// GET /api/admin/dashboard
export const getDashboard = async (
  _req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [[users]]    = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS total, SUM(is_active=0) AS banned FROM users') as any;
    const [[videos]]   = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS total, SUM(is_public=0) AS hidden FROM videos') as any;
    const [[comments]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM comments') as any;
    const [[mods]]     = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM admin_users WHERE is_active=1') as any;

    // Reports stats
    let reportStats = { total: 0, pending: 0, resolved: 0 };
    try {
      const [[rStats]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total, SUM(status='pending') AS pending, SUM(status='resolved') AS resolved FROM reports`
      ) as any;
      reportStats = { total: Number(rStats.total), pending: Number(rStats.pending || 0), resolved: Number(rStats.resolved || 0) };
    } catch { /* table might not exist yet */ }

    // Strikes stats
    let strikeStats = { total: 0, activeStrikes: 0 };
    try {
      const [[sStats]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total, SUM(is_active=1) AS active_strikes FROM user_strikes`
      ) as any;
      strikeStats = { total: Number(sStats.total), activeStrikes: Number(sStats.active_strikes || 0) };
    } catch { /* table might not exist yet */ }

    const [recentUsers] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.full_name, u.avatar_url, u.talent_type, u.is_active, u.created_at,
              (SELECT COUNT(*) FROM videos v WHERE v.user_id = u.id) AS video_count
       FROM users u ORDER BY u.created_at DESC LIMIT 5`
    );
    const [recentVideos] = await pool.query<RowDataPacket[]>(
      `SELECT v.id, v.title, v.talent_type, v.views, v.unique_views, v.likes, v.dislikes, v.is_public, v.created_at,
              u.username, u.avatar_url
       FROM videos v JOIN users u ON u.id = v.user_id
       ORDER BY v.created_at DESC LIMIT 5`
    );

    // Recent audit logs
    let recentActivity: RowDataPacket[] = [];
    try {
      const [actRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, admin_username, action, entity_type, entity_id, created_at
         FROM audit_logs ORDER BY created_at DESC LIMIT 10`
      );
      recentActivity = actRows;
    } catch { /* table might not exist yet */ }

    res.json({
      success: true,
      data: {
        stats: {
          users:       { total: Number(users.total),    banned: Number(users.banned || 0) },
          videos:      { total: Number(videos.total),   hidden: Number(videos.hidden || 0) },
          comments:    { total: Number(comments.total) },
          moderators:  { total: Number(mods.total) },
          reports:     reportStats,
          strikes:     strikeStats,
        },
        recentUsers,
        recentVideos,
        recentActivity,
      },
    });
  } catch (err) { next(err); }
};

   VIDEOS

export const getAdminVideos = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page       = parsePage(req.query.page as string);
    const limit      = parseLimit(req.query.limit as string);
    const offset     = (page - 1) * limit;
    const search     = req.query.search as string | undefined;
    const talentType = req.query.talent_type as string | undefined;
    const visibility = req.query.visibility as string | undefined;

    let where = '1=1';
    const params: unknown[] = [];
    if (search)     { where += ' AND (v.title LIKE ? OR u.username LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (talentType) { where += ' AND v.talent_type = ?'; params.push(talentType); }
    if (visibility === 'public') { where += ' AND v.is_public = 1'; }
    if (visibility === 'hidden') { where += ' AND v.is_public = 0'; }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT v.id, v.title, v.talent_type, v.views, v.unique_views, v.likes, v.dislikes,
              v.is_public, v.file_size, v.thumbnail_url, v.created_at,
              CASE
                WHEN v.filename IS NOT NULL THEN CONCAT('/uploads/videos/', v.filename)
                ELSE NULL
              END AS file_url,
              u.id AS user_id, u.username, u.full_name, u.avatar_url
       FROM videos v JOIN users u ON u.id = v.user_id
       WHERE ${where}
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM videos v JOIN users u ON u.id = v.user_id WHERE ${where}`,
      params
    ) as any;

    res.json({
      success: true,
      data: { items: rows, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) { next(err); }
};

export const deleteAdminVideo = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [[v]] = await pool.query<RowDataPacket[]>('SELECT title FROM videos WHERE id = ?', [req.params.id]) as any;
    await pool.query('DELETE FROM videos WHERE id = ?', [req.params.id]);
    await writeAuditLog(req.admin!.id, req.admin!.username, 'video_deleted', 'video', req.params.id, { title: v?.title }, null, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: null });
  } catch (err) { next(err); }
};

export const toggleVideoVisibility = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [[before]] = await pool.query<RowDataPacket[]>('SELECT is_public FROM videos WHERE id = ?', [req.params.id]) as any;
    await pool.query('UPDATE videos SET is_public = NOT is_public WHERE id = ?', [req.params.id]);
    const [[v]] = await pool.query<RowDataPacket[]>('SELECT is_public FROM videos WHERE id = ?', [req.params.id]) as any;
    if (Boolean(v?.is_public)) {
      await pool.query(
        'UPDATE videos SET moderation_hold_set_at = NULL, moderation_hold_until = NULL, moderation_hold_report_id = NULL WHERE id = ?',
        [req.params.id]
      );
    }
    await writeAuditLog(req.admin!.id, req.admin!.username, 'video_visibility_changed', 'video', req.params.id, { is_public: Boolean(before?.is_public) }, { is_public: Boolean(v?.is_public) }, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: { is_public: Boolean(v?.is_public) } });
  } catch (err) { next(err); }
};

export const hideVideoForReview = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const videoId = String(req.params.id || '').trim();
    const reportId = String(req.body?.report_id || '').trim() || null;
    if (!videoId) {
      res.status(400).json({ success: false, error: 'Video id is required' });
      return;
    }

    const [[video]] = await pool.query<RowDataPacket[]>(
      `SELECT id, title, is_public, moderation_hold_until, moderation_hold_report_id
       FROM videos
       WHERE id = ?
       LIMIT 1`,
      [videoId]
    ) as any;
    if (!video) {
      res.status(404).json({ success: false, error: 'Video not found' });
      return;
    }

    const isCurrentlyHidden = !Boolean(video.is_public);

    if (isCurrentlyHidden) {
      await pool.query(
        `UPDATE videos
         SET is_public = 1,
             moderation_hold_set_at = NULL,
             moderation_hold_until = NULL,
             moderation_hold_report_id = NULL
         WHERE id = ?`,
        [videoId]
      );

      await writeAuditLog(
        req.admin!.id,
        req.admin!.username,
        'video_restored_from_review_hold',
        'video',
        videoId,
        null,
        { report_id: reportId },
        req.ip,
        req.headers['user-agent']
      );

      res.json({
        success: true,
        data: {
          id: videoId,
          action: 'restored',
          is_public: true,
          moderation_hold_until: null,
          moderation_hold_report_id: null,
        },
      });
      return;
    }

    if (reportId) {
      const [[report]] = await pool.query<RowDataPacket[]>(
        'SELECT id, entity_type, entity_id, status FROM reports WHERE id = ? LIMIT 1',
        [reportId]
      ) as any;
      if (!report) {
        res.status(404).json({ success: false, error: 'Report not found' });
        return;
      }
      if (String(report.entity_type) !== 'video' || String(report.entity_id) !== videoId) {
        res.status(400).json({ success: false, error: 'Report does not match this video' });
        return;
      }
      if (String(report.status) === 'resolved' || String(report.status) === 'dismissed') {
        res.status(400).json({ success: false, error: 'Report is already reviewed' });
        return;
      }
    }

    await pool.query(
      `UPDATE videos
       SET is_public = 0,
           moderation_hold_set_at = NOW(),
           moderation_hold_until = DATE_ADD(NOW(), INTERVAL 90 DAY),
           moderation_hold_report_id = ?
       WHERE id = ?`,
      [reportId, videoId]
    );

    const [[after]] = await pool.query<RowDataPacket[]>(
      'SELECT moderation_hold_until FROM videos WHERE id = ? LIMIT 1',
      [videoId]
    ) as any;

    await writeAuditLog(
      req.admin!.id,
      req.admin!.username,
      'video_hidden_for_review_90d',
      'video',
      videoId,
      null,
      { report_id: reportId, moderation_hold_until: after?.moderation_hold_until },
      req.ip,
      req.headers['user-agent']
    );

    res.json({
      success: true,
      data: {
        id: videoId,
        action: 'hidden',
        is_public: false,
        moderation_hold_until: after?.moderation_hold_until || null,
        moderation_hold_report_id: reportId,
      },
    });
  } catch (err) { next(err); }
};

export const hideCommentForReview = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const commentId = String(req.params.id || '').trim();
    const reportId = String(req.body?.report_id || '').trim() || null;
    if (!commentId) {
      res.status(400).json({ success: false, error: 'Comment id is required' });
      return;
    }

    const [[comment]] = await pool.query<RowDataPacket[]>(
      `SELECT id, body, video_id, is_hidden, moderation_hold_until, moderation_hold_report_id
       FROM comments
       WHERE id = ?
       LIMIT 1`,
      [commentId]
    ) as any;
    if (!comment) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    const isCurrentlyHidden = Boolean(comment.is_hidden);

    if (isCurrentlyHidden) {
      await pool.query(
        `UPDATE comments
         SET is_hidden = 0,
             moderation_hold_set_at = NULL,
             moderation_hold_until = NULL,
             moderation_hold_report_id = NULL
         WHERE id = ?`,
        [commentId]
      );

      await writeAuditLog(
        req.admin!.id,
        req.admin!.username,
        'comment_restored_from_review_hold',
        'comment',
        commentId,
        null,
        { report_id: reportId },
        req.ip,
        req.headers['user-agent']
      );

      res.json({
        success: true,
        data: {
          id: commentId,
          action: 'restored',
          is_hidden: false,
          moderation_hold_until: null,
          moderation_hold_report_id: null,
        },
      });
      return;
    }

    if (reportId) {
      const [[report]] = await pool.query<RowDataPacket[]>(
        'SELECT id, entity_type, entity_id, status FROM reports WHERE id = ? LIMIT 1',
        [reportId]
      ) as any;
      if (!report) {
        res.status(404).json({ success: false, error: 'Report not found' });
        return;
      }
      if (String(report.entity_type) !== 'comment') {
        res.status(400).json({ success: false, error: 'Report does not match this comment' });
        return;
      }
      const [[reportedComment]] = await pool.query<RowDataPacket[]>(
        'SELECT id, video_id FROM comments WHERE id = ? LIMIT 1',
        [String(report.entity_id)]
      ) as any;
      if (!reportedComment || String(reportedComment.video_id) !== String(comment.video_id)) {
        res.status(400).json({ success: false, error: 'Comment is not in the reported conversation' });
        return;
      }
      if (String(report.status) === 'resolved' || String(report.status) === 'dismissed') {
        res.status(400).json({ success: false, error: 'Report is already reviewed' });
        return;
      }
    }

    await pool.query(
      `UPDATE comments
       SET is_hidden = 1,
           moderation_hold_set_at = NOW(),
           moderation_hold_until = DATE_ADD(NOW(), INTERVAL 90 DAY),
           moderation_hold_report_id = ?
       WHERE id = ?`,
      [reportId, commentId]
    );

    const [[after]] = await pool.query<RowDataPacket[]>(
      'SELECT moderation_hold_until FROM comments WHERE id = ? LIMIT 1',
      [commentId]
    ) as any;

    await writeAuditLog(
      req.admin!.id,
      req.admin!.username,
      'comment_hidden_for_review_90d',
      'comment',
      commentId,
      null,
      { report_id: reportId, moderation_hold_until: after?.moderation_hold_until },
      req.ip,
      req.headers['user-agent']
    );

    res.json({
      success: true,
      data: {
        id: commentId,
        action: 'hidden',
        is_hidden: true,
        moderation_hold_until: after?.moderation_hold_until || null,
        moderation_hold_report_id: reportId,
      },
    });
  } catch (err) { next(err); }
};

   USERS

export const getAdminUsers = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page   = parsePage(req.query.page as string);
    const limit  = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;
    const search = req.query.search as string | undefined;
    const role   = req.query.role as string | undefined;
    const status = req.query.status as string | undefined;

    let where = '1=1';
    const params: unknown[] = [];
    if (search) {
      where += ' AND (u.id LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status === 'active')  { where += ' AND u.is_active = 1'; }
    if (status === 'banned')  { where += ' AND u.is_active = 0'; }
    if (status === 'shadow')  { where += ' AND u.shadow_banned = 1'; }
    if (role === 'creator')   { where += ' AND EXISTS (SELECT 1 FROM videos vv WHERE vv.user_id = u.id)'; }
    if (role === 'viewer')    { where += ' AND NOT EXISTS (SELECT 1 FROM videos vv WHERE vv.user_id = u.id)'; }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.email, u.full_name, u.avatar_url,
              u.talent_type, u.is_active, u.created_at,
              IFNULL(u.shadow_banned, 0) AS shadow_banned,
              IFNULL(u.strike_count, 0)  AS strike_count,
              (SELECT COUNT(*) FROM videos v WHERE v.user_id = u.id) AS video_count,
              (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count
       FROM users u WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM users u WHERE ${where}`, params
    ) as any;

    res.json({
      success: true,
      data: { items: rows, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) { next(err); }
};

// GET /api/admin/users/:id/profile
export const getAdminUserProfile = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const userId = req.params.id;

    const [[user]] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.email, u.full_name, u.phone, u.avatar_url, u.bio,
              u.talent_type, u.is_active, u.created_at, u.updated_at,
              IFNULL(u.shadow_banned, 0) AS shadow_banned,
              IFNULL(u.shadow_banned, 0) AS is_shadow_banned,
              u.full_name AS display_name,
              CASE
                WHEN EXISTS (SELECT 1 FROM videos vv WHERE vv.user_id = u.id) THEN 'creator'
                ELSE 'viewer'
              END AS role,
              CASE WHEN u.is_active = 1 THEN 'active' ELSE 'banned' END AS status,
              IFNULL(u.strike_count, 0)  AS strike_count,
              (SELECT COUNT(*) FROM videos v WHERE v.user_id = u.id) AS video_count,
              (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count,
              (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
              (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comment_count
       FROM users u
       WHERE u.id = ?
       LIMIT 1`,
      [userId]
    ) as any;

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const [videos] = await pool.query<RowDataPacket[]>(
      `SELECT v.id, v.title, v.talent_type, v.views, v.unique_views, v.likes, v.dislikes,
              v.is_public, v.thumbnail_url, v.file_size, v.filename, v.created_at,
              CASE
                WHEN v.is_public = 1 THEN 'active'
                ELSE 'hidden'
              END AS status,
              v.talent_type AS category,
              v.views AS view_count,
              v.likes AS like_count,
              CASE
                WHEN v.filename IS NOT NULL THEN CONCAT('/uploads/videos/', v.filename)
                ELSE NULL
              END AS file_url
       FROM videos v
       WHERE v.user_id = ?
       ORDER BY v.created_at DESC`,
      [userId]
    );

    let strikes: RowDataPacket[] = [];
    try {
      const [strikeRows] = await pool.query<RowDataPacket[]>(
        `SELECT s.id, s.reason, s.strike_type, s.is_active, s.expires_at, s.created_at,
                a.username AS admin_username
         FROM user_strikes s
         LEFT JOIN admin_users a ON a.id = s.admin_id
         WHERE s.user_id = ?
         ORDER BY s.created_at DESC`,
        [userId]
      );
      strikes = strikeRows;
    } catch {
      strikes = [];
    }

    let analytics: Record<string, unknown> = {};
    try {
      const [[creatorAgg]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total_videos,
                IFNULL(SUM(v.views), 0) AS total_views,
                IFNULL(SUM(v.unique_views), 0) AS total_unique_views,
                IFNULL(SUM(v.likes), 0) AS total_likes,
                IFNULL(SUM(v.dislikes), 0) AS total_dislikes,
                IFNULL(AVG(v.views), 0) AS avg_views_per_video
         FROM videos v
         WHERE v.user_id = ?`,
        [userId]
      ) as any;

      const [topVideos] = await pool.query<RowDataPacket[]>(
        `SELECT v.id, v.title, v.views, v.unique_views, v.likes, v.dislikes, v.created_at,
                CASE
                  WHEN v.filename IS NOT NULL THEN CONCAT('/uploads/videos/', v.filename)
                  ELSE NULL
                END AS file_url
         FROM videos v
         WHERE v.user_id = ?
         ORDER BY v.views DESC, v.created_at DESC
         LIMIT 5`,
        [userId]
      );

      const [[viewerAgg]] = await pool.query<RowDataPacket[]>(
        `SELECT
            (SELECT COUNT(*) FROM video_likes vl WHERE vl.user_id = ? AND vl.type = 'like') AS likes_given,
            (SELECT COUNT(*) FROM video_likes vl WHERE vl.user_id = ? AND vl.type = 'dislike') AS dislikes_given,
            (SELECT COUNT(*) FROM saved_videos sv WHERE sv.user_id = ?) AS saves_count,
            (SELECT COUNT(*) FROM shared_videos sh WHERE sh.user_id = ?) AS shares_count,
            (SELECT COUNT(*) FROM comments c WHERE c.user_id = ?) AS comments_posted,
            (SELECT COUNT(*) FROM follows f WHERE f.follower_id = ?) AS follows_count,
            (SELECT COUNT(*) FROM reports r WHERE r.reporter_id = ?) AS reports_submitted,
            (SELECT COUNT(*) FROM video_engagement_events vee
             WHERE vee.user_id = ? AND vee.event_type = 'impression' AND vee.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS impressions_30d,
            (SELECT IFNULL(AVG(vee.watch_seconds), 0) FROM video_engagement_events vee
             WHERE vee.user_id = ? AND vee.watch_seconds IS NOT NULL AND vee.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS avg_watch_seconds_30d`,
        [userId, userId, userId, userId, userId, userId, userId, userId, userId]
      ) as any;

      const [[moderationAgg]] = await pool.query<RowDataPacket[]>(
        `SELECT
            COUNT(*) AS reports_received_total,
            SUM(CASE WHEN r.status = 'resolved' THEN 1 ELSE 0 END) AS reports_confirmed,
            SUM(CASE WHEN r.status = 'dismissed' THEN 1 ELSE 0 END) AS reports_dismissed,
            SUM(CASE WHEN r.status IN ('pending','reviewing') THEN 1 ELSE 0 END) AS reports_open
         FROM reports r
         LEFT JOIN videos rv
           ON r.entity_type = 'video'
          AND rv.id COLLATE utf8mb4_unicode_ci = r.entity_id COLLATE utf8mb4_unicode_ci
         LEFT JOIN comments rc
           ON r.entity_type = 'comment'
          AND rc.id COLLATE utf8mb4_unicode_ci = r.entity_id COLLATE utf8mb4_unicode_ci
         WHERE (r.entity_type = 'user' AND r.entity_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci)
            OR (r.entity_type = 'video' AND rv.user_id = ?)
            OR (r.entity_type = 'comment' AND rc.user_id = ?)`,
        [userId, userId, userId]
      ) as any;

      const [[hiddenAgg]] = await pool.query<RowDataPacket[]>(
        `SELECT
            (SELECT COUNT(*) FROM videos v WHERE v.user_id = ? AND v.is_public = 0) AS hidden_videos,
            (SELECT COUNT(*) FROM comments c WHERE c.user_id = ? AND IFNULL(c.is_hidden, 0) = 1) AS hidden_comments`,
        [userId, userId]
      ) as any;

      const [uploadsTrend] = await pool.query<RowDataPacket[]>(
        `SELECT DATE(v.created_at) AS date, COUNT(*) AS count
         FROM videos v
         WHERE v.user_id = ?
           AND v.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY DATE(v.created_at)
         ORDER BY date ASC`,
        [userId]
      );

      const [viewerTrend] = await pool.query<RowDataPacket[]>(
        `SELECT DATE(vee.created_at) AS date,
                SUM(CASE WHEN vee.event_type IN ('like','save','share') THEN 1 ELSE 0 END) AS positive_actions,
                SUM(CASE WHEN vee.event_type IN ('skip','quick_skip','dislike') THEN 1 ELSE 0 END) AS negative_actions,
                SUM(CASE WHEN vee.event_type = 'impression' THEN 1 ELSE 0 END) AS impressions
         FROM video_engagement_events vee
         WHERE vee.user_id = ?
           AND vee.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY DATE(vee.created_at)
         ORDER BY date ASC`,
        [userId]
      );

      const [moderationTrend] = await pool.query<RowDataPacket[]>(
        `SELECT DATE(r.created_at) AS date, COUNT(*) AS count
         FROM reports r
         LEFT JOIN videos rv
           ON r.entity_type = 'video'
          AND rv.id COLLATE utf8mb4_unicode_ci = r.entity_id COLLATE utf8mb4_unicode_ci
         LEFT JOIN comments rc
           ON r.entity_type = 'comment'
          AND rc.id COLLATE utf8mb4_unicode_ci = r.entity_id COLLATE utf8mb4_unicode_ci
         WHERE r.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           AND (
             (r.entity_type = 'user' AND r.entity_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci)
             OR (r.entity_type = 'video' AND rv.user_id = ?)
             OR (r.entity_type = 'comment' AND rc.user_id = ?)
           )
         GROUP BY DATE(r.created_at)
         ORDER BY date ASC`,
        [userId, userId, userId]
      );

      const [affinityRows] = await pool.query<RowDataPacket[]>(
        `SELECT talent_type, score, event_count, last_event_at
         FROM user_category_affinity
         WHERE user_id = ?
         ORDER BY score DESC
         LIMIT 8`,
        [userId]
      );

      const [relatedComments] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.body, c.video_id, c.created_at,
                IFNULL(rr.report_count, 0) AS report_count,
                CASE
                  WHEN v.filename IS NOT NULL THEN CONCAT('/uploads/videos/', v.filename)
                  ELSE NULL
                END AS video_file_url
         FROM comments c
         JOIN videos v ON v.id = c.video_id
         LEFT JOIN (
           SELECT r.entity_id AS comment_id, COUNT(*) AS report_count
           FROM reports r
           WHERE r.entity_type = 'comment'
           GROUP BY r.entity_id
         ) rr ON rr.comment_id COLLATE utf8mb4_unicode_ci = c.id COLLATE utf8mb4_unicode_ci
         WHERE c.user_id = ?
         ORDER BY rr.report_count DESC, c.created_at DESC
         LIMIT 12`,
        [userId]
      );

      analytics = {
        creator: {
          total_videos: Number(creatorAgg?.total_videos || 0),
          total_views: Number(creatorAgg?.total_views || 0),
          total_unique_views: Number(creatorAgg?.total_unique_views || 0),
          total_likes: Number(creatorAgg?.total_likes || 0),
          total_dislikes: Number(creatorAgg?.total_dislikes || 0),
          avg_views_per_video: Number(creatorAgg?.avg_views_per_video || 0),
          top_videos: topVideos,
        },
        viewer: {
          likes_given: Number(viewerAgg?.likes_given || 0),
          dislikes_given: Number(viewerAgg?.dislikes_given || 0),
          saves_count: Number(viewerAgg?.saves_count || 0),
          shares_count: Number(viewerAgg?.shares_count || 0),
          comments_posted: Number(viewerAgg?.comments_posted || 0),
          follows_count: Number(viewerAgg?.follows_count || 0),
          reports_submitted: Number(viewerAgg?.reports_submitted || 0),
          impressions_30d: Number(viewerAgg?.impressions_30d || 0),
          avg_watch_seconds_30d: Number(viewerAgg?.avg_watch_seconds_30d || 0),
          top_affinity_categories: affinityRows,
        },
        moderation: {
          strikes_total: Number(user?.strike_count || 0),
          strikes_active: Number((strikes || []).filter((s: any) => Number(s.is_active || 0) === 1).length || 0),
          reports_received_total: Number(moderationAgg?.reports_received_total || 0),
          reports_confirmed: Number(moderationAgg?.reports_confirmed || 0),
          reports_dismissed: Number(moderationAgg?.reports_dismissed || 0),
          reports_open: Number(moderationAgg?.reports_open || 0),
          hidden_videos: Number(hiddenAgg?.hidden_videos || 0),
          hidden_comments: Number(hiddenAgg?.hidden_comments || 0),
        },
        trends_30d: {
          uploads: uploadsTrend,
          viewer_activity: viewerTrend,
          moderation_reports: moderationTrend,
        },
        related: {
          videos: topVideos,
          comments: relatedComments,
        },
      };
    } catch {
      analytics = {
        creator: null,
        viewer: null,
        moderation: null,
        trends_30d: null,
        related: { videos: [], comments: [] },
      };
    }

    res.json({
      success: true,
      data: {
        user,
        videos,
        strikes,
        analytics,
      },
    });
  } catch (err) { next(err); }
};

export const banUser = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    await pool.query('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
    await writeAuditLog(req.admin!.id, req.admin!.username, 'user_banned', 'user', req.params.id, null, { is_active: false }, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: { is_active: false } });
  } catch (err) { next(err); }
};

export const unbanUser = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    await pool.query('UPDATE users SET is_active = 1 WHERE id = ?', [req.params.id]);
    await writeAuditLog(req.admin!.id, req.admin!.username, 'user_unbanned', 'user', req.params.id, null, { is_active: true }, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: { is_active: true } });
  } catch (err) { next(err); }
};

export const deleteAdminUser = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  let conn: PoolConnection | null = null;
  try {
    conn = await pool.getConnection();
    const userId = String(req.params.id || '').trim();
    const transferUserId = String(req.body?.reassign_to_user_id || req.body?.transfer_user_id || req.body?.reassignUserId || '').trim();

    if (!userId) {
      res.status(400).json({ success: false, error: 'User id is required' });
      return;
    }

    await conn.beginTransaction();

    const [[sourceUser]] = await conn.query<RowDataPacket[]>(
      'SELECT id, username FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
      [userId]
    ) as any;

    if (!sourceUser) {
      await conn.rollback();
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const [[videoSummary]] = await conn.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total_videos FROM videos WHERE user_id = ?',
      [userId]
    ) as any;
    const totalVideos = Number(videoSummary?.total_videos || 0);

    let transferTarget: { id: string; username: string } | null = null;
    if (transferUserId) {
      if (transferUserId === userId) {
        await conn.rollback();
        res.status(400).json({ success: false, error: 'Pick a different user to receive the videos' });
        return;
      }

      const [[targetUser]] = await conn.query<RowDataPacket[]>(
        'SELECT id, username FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
        [transferUserId]
      ) as any;

      if (!targetUser) {
        await conn.rollback();
        res.status(404).json({ success: false, error: 'Transfer target not found' });
        return;
      }

      transferTarget = {
        id: String(targetUser.id),
        username: String(targetUser.username),
      };
    }

    if (totalVideos > 0) {
      if (!transferTarget) {
        await conn.rollback();
        res.status(400).json({ success: false, error: 'Pick a user to receive the videos before deleting this account' });
        return;
      }

      await conn.query('UPDATE videos SET user_id = ? WHERE user_id = ?', [transferTarget.id, userId]);
    }

    await conn.query('DELETE FROM users WHERE id = ?', [userId]);
    await conn.commit();

    await writeAuditLog(
      req.admin!.id,
      req.admin!.username,
      'user_deleted',
      'user',
      req.params.id,
      { username: sourceUser?.username, total_videos: totalVideos },
      {
        username: sourceUser?.username,
        transferred_videos_to_user_id: transferTarget?.id || null,
        transferred_videos_to_username: transferTarget?.username || null,
        transferred_videos: totalVideos,
      },
      req.ip,
      req.headers['user-agent']
    );

    res.json({
      success: true,
      data: {
        transferred_videos_to_user_id: transferTarget?.id || null,
        transferred_videos: totalVideos,
      },
    });
  } catch (err) {
    try {
      await conn?.rollback();
    } catch { /* no-op */ }
    next(err);
  } finally {
    conn?.release();
  }
};

// PUT /api/admin/users/:id/shadow-ban
export const shadowBanUser = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [[before]] = await pool.query<RowDataPacket[]>('SELECT shadow_banned FROM users WHERE id = ?', [req.params.id]) as any;
    const newVal = before?.shadow_banned ? 0 : 1;
    await pool.query('UPDATE users SET shadow_banned = ? WHERE id = ?', [newVal, req.params.id]);
    await writeAuditLog(req.admin!.id, req.admin!.username, newVal ? 'user_shadow_banned' : 'user_shadow_unbanned', 'user', req.params.id, null, { shadow_banned: newVal }, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: { shadow_banned: Boolean(newVal) } });
  } catch (err) { next(err); }
};

   USER STRIKES

// GET /api/admin/users/:id/strikes
export const getUserStrikes = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.*, a.username AS admin_username
       FROM user_strikes s LEFT JOIN admin_users a ON a.id = s.admin_id
       WHERE s.user_id = ? ORDER BY s.created_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// POST /api/admin/users/:id/strikes
export const addUserStrike = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { reason, strike_type, expires_at } = req.body;
    if (!reason) { res.status(400).json({ success: false, error: 'Reason is required' }); return; }
    const id = uuid();
    await pool.query(
      `INSERT INTO user_strikes (id, user_id, admin_id, reason, strike_type, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, req.admin!.id, reason, strike_type || 'strike', expires_at || null]
    );
    await pool.query('UPDATE users SET strike_count = strike_count + 1 WHERE id = ?', [req.params.id]);

    // Auto-ban if max strikes reached
    try {
      const [[setting]] = await pool.query<RowDataPacket[]>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'max_strikes_before_ban'"
      ) as any;
      const [[autoBan]] = await pool.query<RowDataPacket[]>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'auto_ban_on_max_strikes'"
      ) as any;
      const maxStrikes = parseInt(setting?.setting_value || '3');
      const autoEnabled = autoBan?.setting_value === '1';
      const [[user]] = await pool.query<RowDataPacket[]>('SELECT strike_count FROM users WHERE id = ?', [req.params.id]) as any;
      if (autoEnabled && Number(user?.strike_count) >= maxStrikes) {
        await pool.query('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
        await writeAuditLog(req.admin!.id, req.admin!.username, 'user_auto_banned_strikes', 'user', req.params.id, null, { strike_count: user?.strike_count }, req.ip, req.headers['user-agent']);
      }
    } catch { /* settings might not exist yet */ }

    await writeAuditLog(req.admin!.id, req.admin!.username, 'strike_added', 'user', req.params.id, null, { reason, strike_type }, req.ip, req.headers['user-agent']);
    res.status(201).json({ success: true, data: { id } });
  } catch (err) { next(err); }
};

// DELETE /api/admin/strikes/:id
export const removeStrike = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [[strike]] = await pool.query<RowDataPacket[]>('SELECT user_id FROM user_strikes WHERE id = ?', [req.params.id]) as any;
    if (!strike) { res.status(404).json({ success: false, error: 'Strike not found' }); return; }
    await pool.query('UPDATE user_strikes SET is_active = 0 WHERE id = ?', [req.params.id]);
    await pool.query('UPDATE users SET strike_count = GREATEST(0, strike_count - 1) WHERE id = ?', [strike.user_id]);
    await writeAuditLog(req.admin!.id, req.admin!.username, 'strike_removed', 'user', strike.user_id, null, { strike_id: req.params.id }, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: null });
  } catch (err) { next(err); }
};

   COMMENTS

export const getAdminComments = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page   = parsePage(req.query.page as string);
    const limit  = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;
    const search = req.query.search as string | undefined;

    // Main Comment Moderation list shows only top-level comments.
    let where = 'c.parent_comment_id IS NULL';
    const params: unknown[] = [];
    if (search) {
      where += ' AND (c.id LIKE ? OR c.video_id LIKE ? OR c.body LIKE ? OR u.username LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.body, c.created_at, c.parent_comment_id, c.likes_count,
              (SELECT COUNT(*) FROM comments rc WHERE rc.parent_comment_id = c.id) AS reply_count,
              pc.body AS parent_body,
              pu.username AS parent_username,
              u.id AS user_id, u.username, u.avatar_url,
              v.id AS video_id, v.title AS video_title,
              CASE
                WHEN v.filename IS NOT NULL THEN CONCAT('/uploads/videos/', v.filename)
                ELSE NULL
              END AS video_file_url
       FROM comments c
       JOIN users u  ON u.id = c.user_id
       JOIN videos v ON v.id = c.video_id
       LEFT JOIN comments pc ON pc.id = c.parent_comment_id
       LEFT JOIN users pu ON pu.id = pc.user_id
       WHERE ${where}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM comments c
       JOIN users u ON u.id = c.user_id
       JOIN videos v ON v.id = c.video_id WHERE ${where}`,
      params
    ) as any;

    res.json({
      success: true,
      data: { items: rows, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) { next(err); }
};

export const deleteAdminComment = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  const conn = await pool.getConnection();
  try {
    const commentId = String(req.params.id || '').trim();
    if (!commentId) {
      res.status(400).json({ success: false, error: 'Comment id is required' });
      return;
    }

    await conn.beginTransaction();

    const [[c]] = await conn.query<RowDataPacket[]>(
      'SELECT id, body, user_id, parent_comment_id FROM comments WHERE id = ? LIMIT 1 FOR UPDATE',
      [commentId]
    ) as any;
    if (!c) {
      await conn.rollback();
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    // Keep the rest of the thread intact: promote children to deleted comment's parent.
    await conn.query(
      'UPDATE comments SET parent_comment_id = ? WHERE parent_comment_id = ?',
      [c.parent_comment_id || null, commentId]
    );

    await conn.query('DELETE FROM comments WHERE id = ?', [commentId]);
    await conn.commit();

    await writeAuditLog(req.admin!.id, req.admin!.username, 'comment_deleted', 'comment', req.params.id, { body: c?.body?.substring(0, 100) }, null, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: null });
  } catch (err) {
    try { await conn.rollback(); } catch { /* no-op */ }
    next(err);
  } finally {
    conn.release();
  }
};

export const getAdminCommentConversation = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const commentId = String(req.params.id || '').trim();
    if (!commentId) {
      res.status(400).json({ success: false, error: 'Comment id is required' });
      return;
    }

    const [focusRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, parent_comment_id, video_id FROM comments WHERE id = ? LIMIT 1',
      [commentId]
    );
    const focus = focusRows[0];
    if (!focus) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.parent_comment_id, c.video_id, c.user_id, c.body, c.likes_count, c.created_at,
              u.username, u.avatar_url
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.video_id = ?
       ORDER BY c.created_at ASC`,
      [focus.video_id]
    );

    type CommentNode = {
      id: string;
      parent_comment_id: string | null;
      body: string;
      likes_count: number;
      created_at: Date | string;
      username: string;
      avatar_url: string | null;
    };

    const byId = new Map<string, CommentNode>();
    const children = new Map<string, CommentNode[]>();

    for (const row of rows) {
      const item: CommentNode = {
        id: String(row.id),
        parent_comment_id: row.parent_comment_id ? String(row.parent_comment_id) : null,
        body: String(row.body || ''),
        likes_count: Number(row.likes_count || 0),
        created_at: row.created_at,
        username: String(row.username || 'user'),
        avatar_url: row.avatar_url || null,
      };
      byId.set(item.id, item);
    }

    for (const item of byId.values()) {
      if (!item.parent_comment_id) continue;
      const parentId = item.parent_comment_id;
      const arr = children.get(parentId) || [];
      arr.push(item);
      children.set(parentId, arr);
    }

    let rootId = commentId;
    const seen = new Set<string>();
    while (true) {
      const current = byId.get(rootId);
      if (!current || !current.parent_comment_id) break;
      if (seen.has(rootId)) break;
      if (!byId.has(current.parent_comment_id)) break;
      seen.add(rootId);
      rootId = current.parent_comment_id;
    }

    const startId = byId.has(rootId) ? rootId : commentId;
    const items: Array<{
      id: string;
      parent_comment_id: string | null;
      body: string;
      likes_count: number;
      created_at: Date | string;
      username: string;
      avatar_url: string | null;
      depth: number;
      is_reported: number;
    }> = [];

    const walk = (nodeId: string, depth: number): void => {
      const node = byId.get(nodeId);
      if (!node) return;
      items.push({
        id: node.id,
        parent_comment_id: node.parent_comment_id,
        body: node.body,
        likes_count: node.likes_count,
        created_at: node.created_at,
        username: node.username,
        avatar_url: node.avatar_url,
        depth,
        is_reported: node.id === commentId ? 1 : 0,
      });
      const kids = children.get(nodeId) || [];
      for (const child of kids) walk(child.id, depth + 1);
    };

    walk(startId, 0);

    res.json({
      success: true,
      data: {
        root_comment_id: startId,
        reported_comment_id: commentId,
        reply_count: Math.max(0, items.length - 1),
        items,
      },
    });
  } catch (err) { next(err); }
};

   MODERATORS (superadmin only)

export const getModerators = async (
  _req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, email, full_name, avatar_url, role, is_active, last_login, created_at
       FROM admin_users ORDER BY created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

export const createModerator = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { username, email, password, full_name, role } = req.body;
    if (!username || !email || !password || password.length < 8) {
      res.status(400).json({ success: false, error: 'username, email and password (min 8 chars) required' });
      return;
    }
    const [existing] = await pool.query<any[]>(
      'SELECT id FROM admin_users WHERE email = ? OR username = ? LIMIT 1',
      [email.toLowerCase().trim(), username.toLowerCase().trim()]
    );
    if ((existing as any[]).length > 0) {
      res.status(409).json({ success: false, error: 'Email or username already taken' });
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    const id   = uuid();
    const validRoles = ['superadmin', 'moderator', 'support'];
    const assignRole = validRoles.includes(role) ? role : 'moderator';
    await pool.query(
      `INSERT INTO admin_users (id, username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, username.toLowerCase().trim(), email.toLowerCase().trim(), hash, full_name?.trim() || username, assignRole]
    );
    await writeAuditLog(req.admin!.id, req.admin!.username, 'moderator_created', 'admin', id, null, { username, role: assignRole }, req.ip, req.headers['user-agent']);
    res.status(201).json({
      success: true,
      data: {
        id,
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        full_name: full_name?.trim() || username,
        avatar_url: null,
        role: assignRole,
      },
    });
  } catch (err) { next(err); }
};

export const toggleModerator = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    if (req.params.id === req.admin!.id) {
      res.status(400).json({ success: false, error: 'Cannot deactivate yourself' });
      return;
    }
    await pool.query('UPDATE admin_users SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
    const [[m]] = await pool.query<RowDataPacket[]>('SELECT is_active FROM admin_users WHERE id = ?', [req.params.id]) as any;
    await writeAuditLog(req.admin!.id, req.admin!.username, 'moderator_toggled', 'admin', req.params.id, null, { is_active: Boolean(m?.is_active) }, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: { is_active: Boolean(m?.is_active) } });
  } catch (err) { next(err); }
};

export const deleteModerator = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    if (req.params.id === req.admin!.id) {
      res.status(400).json({ success: false, error: 'Cannot delete yourself' });
      return;
    }
    const [[m]] = await pool.query<RowDataPacket[]>('SELECT username FROM admin_users WHERE id = ?', [req.params.id]) as any;
    await pool.query('DELETE FROM admin_users WHERE id = ?', [req.params.id]);
    await writeAuditLog(req.admin!.id, req.admin!.username, 'moderator_deleted', 'admin', req.params.id, { username: m?.username }, null, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: null });
  } catch (err) { next(err); }
};

export const changeModeratorPassword = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
      return;
    }
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    await writeAuditLog(req.admin!.id, req.admin!.username, 'moderator_password_changed', 'admin', req.params.id, null, null, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { next(err); }
};

export const changeMyAdminPassword = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password || String(new_password).length < 8) {
      res.status(400).json({ success: false, error: 'current_password and new_password (min 8 chars) required' });
      return;
    }

    const adminId = req.admin?.id;
    if (!adminId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const [[row]] = await pool.query<RowDataPacket[]>(
      'SELECT password_hash FROM admin_users WHERE id = ? LIMIT 1',
      [adminId]
    ) as any;
    if (!row) {
      res.status(404).json({ success: false, error: 'Admin account not found' });
      return;
    }

    const matches = await bcrypt.compare(String(current_password), String(row.password_hash || ''));
    if (!matches) {
      res.status(401).json({ success: false, error: 'Current password is incorrect' });
      return;
    }

    const sameAsCurrent = await bcrypt.compare(String(new_password), String(row.password_hash || ''));
    if (sameAsCurrent) {
      res.status(400).json({ success: false, error: 'New password must be different from current password' });
      return;
    }

    const hash = await bcrypt.hash(String(new_password), 12);
    await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [hash, adminId]);
    await writeAuditLog(
      adminId,
      req.admin?.username,
      'admin_password_changed',
      'admin',
      adminId,
      null,
      { self_service: true },
      req.ip,
      req.headers['user-agent']
    );

    res.json({ success: true });
  } catch (err) { next(err); }
};

export const updateModeratorProfile = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const targetId = String(req.params.id || '').trim();
    const { full_name, username, email } = req.body || {};

    if (!targetId) {
      res.status(400).json({ success: false, error: 'Moderator id is required' });
      return;
    }

    const [[target]] = await pool.query<RowDataPacket[]>(
      'SELECT id, role, username, email, full_name, avatar_url FROM admin_users WHERE id = ? LIMIT 1',
      [targetId]
    ) as any;

    if (!target) {
      res.status(404).json({ success: false, error: 'Moderator not found' });
      return;
    }

    if (target.role !== 'superadmin') {
      res.status(403).json({ success: false, error: 'Only superadmin profile can be edited from this action' });
      return;
    }

    const nextUsername = username !== undefined ? String(username).toLowerCase().trim() : String(target.username || '');
    const nextEmail = email !== undefined ? String(email).toLowerCase().trim() : String(target.email || '');
    const nextFullName = full_name !== undefined ? String(full_name).trim() : String(target.full_name || '');

    if (!nextUsername || !nextEmail || !nextFullName) {
      res.status(400).json({ success: false, error: 'full_name, username and email are required' });
      return;
    }

    const [dupRows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM admin_users WHERE id <> ? AND (username = ? OR email = ?) LIMIT 1',
      [targetId, nextUsername, nextEmail]
    );
    if ((dupRows || []).length > 0) {
      res.status(409).json({ success: false, error: 'Username or email already in use' });
      return;
    }

    await pool.query(
      'UPDATE admin_users SET full_name = ?, username = ?, email = ? WHERE id = ?',
      [nextFullName, nextUsername, nextEmail, targetId]
    );

    const [[updated]] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, email, full_name, avatar_url, role, is_active, last_login, created_at FROM admin_users WHERE id = ? LIMIT 1',
      [targetId]
    ) as any;

    await writeAuditLog(
      req.admin!.id,
      req.admin!.username,
      'moderator_profile_updated',
      'admin',
      targetId,
      { username: target.username, email: target.email, full_name: target.full_name, avatar_url: target.avatar_url || null },
      { username: nextUsername, email: nextEmail, full_name: nextFullName, avatar_url: target.avatar_url || null },
      req.ip,
      req.headers['user-agent']
    );

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

export const updateModeratorAvatar = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const targetId = String(req.params.id || '').trim();
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!targetId) {
      res.status(400).json({ success: false, error: 'Moderator id is required' });
      return;
    }
    if (!file) {
      res.status(400).json({ success: false, error: 'No avatar file uploaded' });
      return;
    }

    const [[target]] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, full_name, email, role, is_active, last_login, created_at, avatar_url FROM admin_users WHERE id = ? LIMIT 1',
      [targetId]
    ) as any;
    if (!target) {
      res.status(404).json({ success: false, error: 'Moderator not found' });
      return;
    }

    const oldAvatarUrl = String(target.avatar_url || '');
    if (oldAvatarUrl) deleteAdminAvatarFile(oldAvatarUrl);

    const host = `${req.protocol}://${req.get('host')}`;
    const avatarUrl = `${host}/uploads/avatars/${file.filename}`;
    await pool.query('UPDATE admin_users SET avatar_url = ? WHERE id = ?', [avatarUrl, targetId]);

    const [[updated]] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, email, full_name, avatar_url, role, is_active, last_login, created_at FROM admin_users WHERE id = ? LIMIT 1',
      [targetId]
    ) as any;

    await writeAuditLog(
      req.admin!.id,
      req.admin!.username,
      'moderator_avatar_updated',
      'admin',
      targetId,
      { avatar_url: oldAvatarUrl || null },
      { avatar_url: avatarUrl },
      req.ip,
      req.headers['user-agent']
    );

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

   AUDIT LOGS

// GET /api/admin/audit-logs
export const getAuditLogs = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page   = parsePage(req.query.page as string);
    const limit  = parseLimit(req.query.limit as string);
    const offset = (page - 1) * limit;
    const search      = req.query.search as string | undefined;
    const action      = req.query.action as string | undefined;
    const entityType  = req.query.entity_type as string | undefined;
    const adminFilter = req.query.admin_id as string | undefined;

    let where = '1=1';
    const params: unknown[] = [];
    if (search)      { where += ' AND (a.admin_username LIKE ? OR a.action LIKE ? OR a.entity_id LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (action)      { where += ' AND a.action = ?'; params.push(action); }
    if (entityType)  { where += ' AND a.entity_type = ?'; params.push(entityType); }
    if (adminFilter) { where += ' AND a.admin_id = ?'; params.push(adminFilter); }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.* FROM audit_logs a WHERE ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM audit_logs a WHERE ${where}`, params
    ) as any;

    res.json({
      success: true,
      data: { items: rows, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) { next(err); }
};

   REPORTS / MODERATION QUEUE

const getCommentThreadReplyCount = async (commentId: string): Promise<number> => {
  const [focusRows] = await pool.query<RowDataPacket[]>(
    'SELECT id, parent_comment_id, video_id FROM comments WHERE id = ? LIMIT 1',
    [commentId]
  );
  const focus = focusRows[0];
  if (!focus) return 0;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, parent_comment_id
     FROM comments
     WHERE video_id = ?
     ORDER BY created_at ASC`,
    [focus.video_id]
  );

  const byId = new Map<string, string | null>();
  const children = new Map<string, string[]>();

  for (const row of rows) {
    const id = String(row.id);
    const parentId = row.parent_comment_id ? String(row.parent_comment_id) : null;
    byId.set(id, parentId);
  }

  for (const [id, parentId] of byId.entries()) {
    if (!parentId) continue;
    const arr = children.get(parentId) || [];
    arr.push(id);
    children.set(parentId, arr);
  }

  let rootId = commentId;
  const seenParents = new Set<string>();
  while (true) {
    const parentId = byId.get(rootId);
    if (!parentId) break;
    if (seenParents.has(rootId)) break;
    if (!byId.has(parentId)) break;
    seenParents.add(rootId);
    rootId = parentId;
  }

  const startId = byId.has(rootId) ? rootId : commentId;
  if (!byId.has(startId)) return 0;

  let nodeCount = 0;
  const visited = new Set<string>();
  const walk = (id: string): void => {
    if (visited.has(id) || !byId.has(id)) return;
    visited.add(id);
    nodeCount += 1;
    const kids = children.get(id) || [];
    for (const kid of kids) walk(kid);
  };

  walk(startId);
  return Math.max(0, nodeCount - 1);
};

// GET /api/admin/reports
export const getReports = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const page     = parsePage(req.query.page as string);
    const limit    = parseLimit(req.query.limit as string);
    const offset   = (page - 1) * limit;
    const status   = req.query.status as string | undefined;
    const type     = req.query.entity_type as string | undefined;
    const priority = req.query.priority as string | undefined;

    let where = '1=1';
    const params: unknown[] = [];
    if (status === 'queue') {
      where += " AND r.status IN ('pending','reviewing')";
    } else if (status === 'archive' || status === 'archived') {
      where += " AND r.status IN ('resolved','dismissed')";
    } else if (status) {
      where += ' AND r.status = ?';
      params.push(status);
    }
    if (type)     { where += ' AND r.entity_type = ?';  params.push(type); }
    if (priority) { where += ' AND r.priority = ?';     params.push(priority); }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.*,
              ru.username AS reporter_username,
              ra.username AS reviewer_username,
              rv.id       AS reported_video_id,
              rv.title    AS reported_video_title,
              CASE
                WHEN rv.filename IS NOT NULL THEN CONCAT('/uploads/videos/', rv.filename)
                ELSE NULL
              END         AS reported_video_url,
              tu.id       AS reported_user_id,
              tu.username AS reported_user_username,
              rc.id       AS reported_comment_id,
              rc.body     AS reported_comment_body,
              rc.video_id AS reported_comment_video_id,
              rcu.id      AS reported_comment_user_id,
              rcu.username AS reported_comment_username,
              IFNULL((SELECT COUNT(*) FROM comments rcr WHERE rcr.parent_comment_id = rc.id), 0) AS reported_comment_reply_count
       FROM reports r
       LEFT JOIN users ru       ON ru.id = r.reporter_id
       LEFT JOIN admin_users ra ON ra.id = r.reviewed_by
       LEFT JOIN videos rv      ON rv.id COLLATE utf8mb4_unicode_ci = r.entity_id COLLATE utf8mb4_unicode_ci AND r.entity_type = 'video'
       LEFT JOIN users tu       ON tu.id COLLATE utf8mb4_unicode_ci = r.entity_id COLLATE utf8mb4_unicode_ci AND r.entity_type = 'user'
       LEFT JOIN comments rc    ON rc.id COLLATE utf8mb4_unicode_ci = r.entity_id COLLATE utf8mb4_unicode_ci AND r.entity_type = 'comment'
       LEFT JOIN users rcu      ON rcu.id = rc.user_id
       WHERE ${where}
       ORDER BY FIELD(r.priority, 'critical','high','medium','low'), r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM reports r WHERE ${where}`, params
    ) as any;

    const items = await Promise.all(
      (rows as RowDataPacket[]).map(async (row) => {
        if (String(row.entity_type || '') !== 'comment') return row;
        const commentId = String(row.reported_comment_id || row.entity_id || '').trim();
        if (!commentId) {
          return { ...row, reported_comment_reply_count: 0 };
        }
        try {
          const replyCount = await getCommentThreadReplyCount(commentId);
          return { ...row, reported_comment_reply_count: replyCount };
        } catch {
          return { ...row, reported_comment_reply_count: Number(row.reported_comment_reply_count || 0) };
        }
      })
    );

    res.json({
      success: true,
      data: { items, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) { next(err); }
};

// POST /api/admin/reports
// (Also used by public API to submit reports)
export const createReport = async (
  req: Request, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { reporter_id, entity_type, entity_id, reason, description, priority } = req.body;
    if (!entity_type || !entity_id || !reason) {
      res.status(400).json({ success: false, error: 'entity_type, entity_id, and reason are required' });
      return;
    }
    const id = uuid();
    await pool.query(
      `INSERT INTO reports (id, reporter_id, entity_type, entity_id, reason, description, priority) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, reporter_id || null, entity_type, entity_id, reason, description || null, priority || 'medium']
    );
    res.status(201).json({ success: true, data: { id } });
  } catch (err) { next(err); }
};

// PUT /api/admin/reports/:id
export const updateReport = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const reportId = String(req.params.id || '').trim();
    const [[existingReport]] = await pool.query<RowDataPacket[]>(
      'SELECT id, entity_type, entity_id, status FROM reports WHERE id = ? LIMIT 1',
      [reportId]
    ) as any;
    if (!existingReport) {
      res.status(404).json({ success: false, error: 'Report not found' });
      return;
    }

    const { status, resolution_note, priority } = req.body;
    const updates: string[] = [];
    const params: unknown[] = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);
      if (status === 'resolved' || status === 'dismissed') {
        updates.push('reviewed_by = ?', 'reviewed_at = NOW()');
        params.push(req.admin!.id);
      } else if (status === 'pending' || status === 'reviewing') {
        updates.push('reviewed_by = NULL', 'reviewed_at = NULL');
      }
    }
    if (resolution_note !== undefined) { updates.push('resolution_note = ?'); params.push(resolution_note); }
    if (priority) { updates.push('priority = ?'); params.push(priority); }

    if (updates.length === 0) { res.status(400).json({ success: false, error: 'No fields to update' }); return; }

    params.push(reportId);
    await pool.query(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`, params);
    if (status === 'resolved' || status === 'dismissed') {
      if (String(existingReport.entity_type) === 'video') {
        await pool.query(
          `UPDATE videos
           SET moderation_hold_set_at = NULL, moderation_hold_until = NULL, moderation_hold_report_id = NULL
           WHERE id = ? AND moderation_hold_report_id = ?`,
          [existingReport.entity_id, reportId]
        );
      } else if (String(existingReport.entity_type) === 'comment') {
        await pool.query(
          `UPDATE comments
           SET moderation_hold_set_at = NULL, moderation_hold_until = NULL, moderation_hold_report_id = NULL
           WHERE id = ? AND moderation_hold_report_id = ?`,
          [existingReport.entity_id, reportId]
        );
      }
    }
    await writeAuditLog(
      req.admin!.id,
      req.admin!.username,
      'report_updated',
      'report',
      reportId,
      null,
      { status, resolution_note, priority },
      req.ip,
      req.headers['user-agent']
    );
    res.json({ success: true, data: null });
  } catch (err) { next(err); }
};

   FEATURE FLAGS

// GET /api/admin/feature-flags
export const getFeatureFlags = async (
  _req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM feature_flags ORDER BY flag_key ASC'
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// PUT /api/admin/feature-flags/:key
export const toggleFeatureFlag = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [[existing]] = await pool.query<RowDataPacket[]>(
      'SELECT flag_key FROM feature_flags WHERE flag_key = ? LIMIT 1',
      [req.params.key]
    ) as any;
    if (!existing) {
      res.status(404).json({ success: false, error: 'Feature flag not found' });
      return;
    }

    const { flag_value } = req.body;
    const val = flag_value !== undefined ? (flag_value ? 1 : 0) : undefined;
    if (val === undefined) {
      // Toggle
      await pool.query('UPDATE feature_flags SET flag_value = NOT flag_value, updated_by = ? WHERE flag_key = ?', [req.admin!.id, req.params.key]);
    } else {
      await pool.query('UPDATE feature_flags SET flag_value = ?, updated_by = ? WHERE flag_key = ?', [val, req.admin!.id, req.params.key]);
    }
    const [[f]] = await pool.query<RowDataPacket[]>('SELECT * FROM feature_flags WHERE flag_key = ?', [req.params.key]) as any;
    await writeAuditLog(req.admin!.id, req.admin!.username, 'feature_flag_changed', 'feature_flag', req.params.key, null, { flag_value: f?.flag_value }, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: f });
  } catch (err) { next(err); }
};

// POST /api/admin/feature-flags
export const createFeatureFlag = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { flag_key, flag_value, description } = req.body;
    if (!flag_key) { res.status(400).json({ success: false, error: 'flag_key is required' }); return; }
    const id = uuid();
    await pool.query(
      'INSERT INTO feature_flags (id, flag_key, flag_value, description, updated_by) VALUES (?, ?, ?, ?, ?)',
      [id, flag_key, flag_value ? 1 : 0, description || '', req.admin!.id]
    );
    await writeAuditLog(req.admin!.id, req.admin!.username, 'feature_flag_created', 'feature_flag', flag_key, null, { flag_value }, req.ip, req.headers['user-agent']);
    res.status(201).json({ success: true, data: { id, flag_key, flag_value: flag_value ? 1 : 0, description } });
  } catch (err) { next(err); }
};

   SYSTEM SETTINGS

// GET /api/admin/settings
export const getSystemSettings = async (
  _req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM system_settings ORDER BY setting_key ASC');
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// PUT /api/admin/settings/:key
export const updateSystemSetting = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { setting_value } = req.body;
    await pool.query(
      'INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?, updated_by = ?',
      [req.params.key, setting_value, req.admin!.id, setting_value, req.admin!.id]
    );
    await writeAuditLog(req.admin!.id, req.admin!.username, 'setting_changed', 'setting', req.params.key, null, { value: setting_value }, req.ip, req.headers['user-agent']);
    res.json({ success: true, data: { key: req.params.key, value: setting_value } });
  } catch (err) { next(err); }
};

   SYSTEM MONITORING & ANALYTICS

// GET /api/admin/system/info
export const getSystemInfo = async (
  _req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    // DB stats
    const [[dbSize]] = await pool.query<RowDataPacket[]>(
      `SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
       FROM information_schema.tables WHERE table_schema = ?`,
      [process.env.DB_NAME || 'talents_stage']
    ) as any;

    // Table counts
    const [[userCount]]   = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM users') as any;
    const [[videoCount]]  = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM videos') as any;
    const [[commentCount]]= await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM comments') as any;

    // Upload dir size estimate
    let uploadSizeMb = 'N/A';
    try {
      const fs = await import('fs');
      const path = await import('path');
      const uploadDir = process.env.UPLOAD_DIR || 'uploads';
      const resolvedDir = path.resolve(uploadDir);
      if (fs.existsSync(resolvedDir)) {
        let totalBytes = 0;
        const walkDir = (dir: string) => {
          try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
              const fp = path.join(dir, file);
              const stat = fs.statSync(fp);
              if (stat.isDirectory()) walkDir(fp);
              else totalBytes += stat.size;
            }
          } catch { /* permission errors */ }
        };
        walkDir(resolvedDir);
        uploadSizeMb = (totalBytes / 1024 / 1024).toFixed(2);
      }
    } catch { /* fs not available */ }

    // Recent login attempts
    let recentLogins: RowDataPacket[] = [];
    try {
      const [loginRows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM admin_login_attempts ORDER BY created_at DESC LIMIT 20'
      );
      recentLogins = loginRows;
    } catch { /* table might not exist */ }

    // Recommender / feed quality KPIs (last 24h + 7d trend)
    let recommendationMetrics = {
      last24h: {
        impressions: 0,
        interactions: 0,
        ctr: 0,
        avgWatchSeconds: 0,
        completionRate: 0,
        skipRate: 0,
        reportRate: 0,
      },
      trend7d: [] as Array<Record<string, unknown>>,
    };
    try {
      const [[eng24]] = await pool.query<RowDataPacket[]>(
        `SELECT
            SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
            SUM(CASE WHEN event_type IN ('like','dislike','save','share') THEN 1 ELSE 0 END) AS interactions,
            SUM(CASE WHEN event_type = 'completion' THEN 1 ELSE 0 END) AS completions,
            SUM(CASE WHEN event_type IN ('skip','quick_skip') THEN 1 ELSE 0 END) AS skips,
            IFNULL(AVG(CASE WHEN watch_seconds IS NOT NULL THEN watch_seconds END), 0) AS avg_watch_seconds
         FROM video_engagement_events
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
      ) as any;

      const [[rep24]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt
         FROM reports
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
      ) as any;

      const impressions = Number(eng24?.impressions || 0);
      const interactions = Number(eng24?.interactions || 0);
      const completions = Number(eng24?.completions || 0);
      const skips = Number(eng24?.skips || 0);
      const reports = Number(rep24?.cnt || 0);

      const ctr = impressions > 0 ? interactions / impressions : 0;
      const completionRate = impressions > 0 ? completions / impressions : 0;
      const skipRate = impressions > 0 ? skips / impressions : 0;
      const reportRate = impressions > 0 ? reports / impressions : 0;

      const [trendBase] = await pool.query<RowDataPacket[]>(
        `SELECT DATE(created_at) AS date,
                SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
                SUM(CASE WHEN event_type IN ('like','dislike','save','share') THEN 1 ELSE 0 END) AS interactions,
                SUM(CASE WHEN event_type = 'completion' THEN 1 ELSE 0 END) AS completions,
                SUM(CASE WHEN event_type IN ('skip','quick_skip') THEN 1 ELSE 0 END) AS skips,
                IFNULL(AVG(CASE WHEN watch_seconds IS NOT NULL THEN watch_seconds END), 0) AS avg_watch_seconds
         FROM video_engagement_events
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
      );
      const [trendReports] = await pool.query<RowDataPacket[]>(
        `SELECT DATE(created_at) AS date, COUNT(*) AS reports
         FROM reports
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
      );
      const reportMap = new Map<string, number>();
      for (const row of trendReports) {
        reportMap.set(String(row.date), Number(row.reports || 0));
      }

      const trend7d = trendBase.map((row) => {
        const i = Number(row.impressions || 0);
        const ints = Number(row.interactions || 0);
        const comps = Number(row.completions || 0);
        const sks = Number(row.skips || 0);
        const reps = Number(reportMap.get(String(row.date)) || 0);
        return {
          date: row.date,
          impressions: i,
          interactions: ints,
          ctr: i > 0 ? ints / i : 0,
          avg_watch_seconds: Number(row.avg_watch_seconds || 0),
          completion_rate: i > 0 ? comps / i : 0,
          skip_rate: i > 0 ? sks / i : 0,
          report_rate: i > 0 ? reps / i : 0,
        };
      });

      recommendationMetrics = {
        last24h: {
          impressions,
          interactions,
          ctr,
          avgWatchSeconds: Number(eng24?.avg_watch_seconds || 0),
          completionRate,
          skipRate,
          reportRate,
        },
        trend7d,
      };
    } catch {
      // Keep default metrics payload when events/reports tables are unavailable.
    }

    res.json({
      success: true,
      data: {
        server: {
          nodeVersion: process.version,
          platform:    process.platform,
          uptime:      Math.floor(process.uptime()),
          memoryUsage: process.memoryUsage(),
        },
        database: {
          sizeMb:    Number(dbSize?.size_mb || 0),
          users:     Number(userCount?.cnt || 0),
          videos:    Number(videoCount?.cnt || 0),
          comments:  Number(commentCount?.cnt || 0),
        },
        storage: {
          uploadSizeMb,
        },
        recentLogins,
        recommendationMetrics,
      },
    });
  } catch (err) { next(err); }
};

// GET /api/admin/analytics
export const getAnalytics = async (
  _req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    // Users registered per day (last 30 days)
    const [usersPerDay] = await pool.query<RowDataPacket[]>(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count
       FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(created_at) ORDER BY date ASC`
    );

    // Videos uploaded per day (last 30 days)
    const [videosPerDay] = await pool.query<RowDataPacket[]>(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count
       FROM videos WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(created_at) ORDER BY date ASC`
    );

    // Comments per day (last 30 days)
    const [commentsPerDay] = await pool.query<RowDataPacket[]>(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count
       FROM comments WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(created_at) ORDER BY date ASC`
    );

    // Creator / Viewer distribution (by users)
    const [topTalents] = await pool.query<RowDataPacket[]>(
      `SELECT role_label AS talent_type, COUNT(*) AS count
       FROM (
         SELECT u.id,
                CASE
                  WHEN EXISTS (SELECT 1 FROM videos vv WHERE vv.user_id = u.id) THEN 'Creator'
                  ELSE 'Viewer'
                END AS role_label
         FROM users u
       ) role_map
       GROUP BY role_label
       ORDER BY FIELD(role_label, 'Creator', 'Viewer')`
    );

    // Uploaded videos distribution by talent type
    const [videoTalentDistribution] = await pool.query<RowDataPacket[]>(
      `SELECT
          CASE
            WHEN v.talent_type IS NULL OR TRIM(v.talent_type) = '' THEN 'Uncategorized'
            ELSE v.talent_type
          END AS talent_type,
          COUNT(*) AS count
       FROM videos v
       WHERE LOWER(TRIM(COALESCE(v.talent_type, ''))) <> 'viewer'
       GROUP BY talent_type
       ORDER BY count DESC`
    );

    // Top viewed videos
    const [topViewed] = await pool.query<RowDataPacket[]>(
      `SELECT v.id, v.title, v.views, v.unique_views, v.likes, v.dislikes, u.username,
              CASE
                WHEN v.filename IS NOT NULL THEN CONCAT('/uploads/videos/', v.filename)
                ELSE NULL
              END AS file_url
       FROM videos v JOIN users u ON u.id = v.user_id
       ORDER BY v.views DESC LIMIT 10`
    );

    // Top liked videos
    const [topLiked] = await pool.query<RowDataPacket[]>(
      `SELECT v.id, v.title, v.views, v.likes, v.dislikes, u.username,
              CASE
                WHEN v.filename IS NOT NULL THEN CONCAT('/uploads/videos/', v.filename)
                ELSE NULL
              END AS file_url
       FROM videos v JOIN users u ON u.id = v.user_id
       ORDER BY v.likes DESC LIMIT 10`
    );

    // Reports per day (last 30 days)
    let reportsPerDay: RowDataPacket[] = [];
    try {
      const [rRows] = await pool.query<RowDataPacket[]>(
        `SELECT DATE(created_at) AS date, COUNT(*) AS count
         FROM reports WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY DATE(created_at) ORDER BY date ASC`
      );
      reportsPerDay = rRows;
    } catch { /* table might not exist */ }

    res.json({
      success: true,
      data: {
        usersPerDay,
        videosPerDay,
        commentsPerDay,
        reportsPerDay,
        topTalents,
        videoTalentDistribution,
        topViewed,
        topLiked,
      },
    });
  } catch (err) { next(err); }
};
