import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import pool from '../config/database';
import { isFeatureFlagEnabled } from '../config/runtimeFlags';
import { AuthRequest, UserRow } from '../models/types';
import { UPLOAD_DIR } from '../middleware/upload';

const JWT_SECRET  = process.env.JWT_SECRET  || 'secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

const signToken = (user: UserRow) =>
  jwt.sign(
    { userId: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES } as jwt.SignOptions
  );

const getAvatarFilename = (avatarUrl: string | null | undefined): string | null => {
  if (!avatarUrl) return null;
  try {
    return path.basename(new URL(avatarUrl).pathname);
  } catch {
    return path.basename(avatarUrl);
  }
};

const deleteAvatarFile = (avatarUrl: string | null | undefined): void => {
  const filename = getAvatarFilename(avatarUrl);
  if (!filename) return;
  const avatarPath = path.join(UPLOAD_DIR, 'avatars', filename);
  if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
};

// POST /api/auth/register
export const register = async (
  req: Request, res: Response, next: NextFunction
): Promise<void> => {
  try {
    if (!(await isFeatureFlagEnabled('registration_enabled', true))) {
      res.status(503).json({ success: false, error: 'Registration is currently disabled' });
      return;
    }

    const { username, email, password, full_name, phone, talent_type } = req.body;

    if (!username || !email || !password) {
      res.status(400).json({ success: false, error: 'username, email and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
      return;
    }

    const [existing] = await pool.query<any[]>(
      'SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1',
      [email.toLowerCase(), username.toLowerCase()]
    );
    if ((existing as any[]).length > 0) {
      res.status(409).json({ success: false, error: 'Email or username already taken' });
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const id   = uuid();

    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, full_name, phone, talent_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        username.toLowerCase().trim(),
        email.toLowerCase().trim(),
        hash,
        full_name?.trim() || username,
        phone || null,
        talent_type || 'Viewer',
      ]
    );

    const [rows] = await pool.query<any[]>('SELECT * FROM users WHERE id = ?', [id]);
    const user = (rows as UserRow[])[0];
    const token = signToken(user);

    res.status(201).json({
      success: true,
      data: { token, user: publicUser(user) },
      message: 'Account created',
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
export const login = async (
  req: Request, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'email and password are required' });
      return;
    }

    const [rows] = await pool.query<any[]>(
      'SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
      [email.toLowerCase().trim()]
    );
    const user = (rows as UserRow[])[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const token = signToken(user);
    res.json({ success: true, data: { token, user: publicUser(user) }, message: 'Logged in' });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
export const getMe = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [req.user!.userId]
    );
    const user = (rows as UserRow[])[0];
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
    if (user.avatar_url && user.avatar_url.includes('localhost')) {
      const host = `${req.protocol}://${req.get('host')}`;
      user.avatar_url = user.avatar_url.replace(/https?:\/\/localhost(:\d+)?/, host);
    }
    res.json({ success: true, data: publicUser(user) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/auth/me — update profile
export const updateMe = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { full_name, phone, bio, website, talent_type, username, email } = req.body;
    const hasUsername = typeof username === 'string';
    const hasEmail = typeof email === 'string';
    const hasWebsite = typeof website === 'string';
    const normalizedUsername = hasUsername ? username.toLowerCase().trim() : null;
    const normalizedEmail = hasEmail ? email.toLowerCase().trim() : null;
    const normalizedWebsite = hasWebsite ? website.trim() : null;

    if (hasUsername && !normalizedUsername) {
      res.status(400).json({ success: false, error: 'Username cannot be empty' });
      return;
    }

    if (hasEmail && !normalizedEmail) {
      res.status(400).json({ success: false, error: 'Email cannot be empty' });
      return;
    }

    if (hasWebsite && normalizedWebsite && normalizedWebsite.length > 500) {
      res.status(400).json({ success: false, error: 'Website link is too long (max 500 chars)' });
      return;
    }

    if (normalizedUsername) {
      const [taken] = await pool.query<any[]>(
        'SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1',
        [normalizedUsername, req.user!.userId]
      );
      if ((taken as any[]).length > 0) {
        res.status(409).json({ success: false, error: 'Username already taken' });
        return;
      }
    }

    if (normalizedEmail) {
      const [taken] = await pool.query<any[]>(
        'SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1',
        [normalizedEmail, req.user!.userId]
      );
      if ((taken as any[]).length > 0) {
        res.status(409).json({ success: false, error: 'Email already taken' });
        return;
      }
    }

    await pool.query(
      `UPDATE users
          SET full_name=?,
              phone=?,
              bio=?,
              website=CASE WHEN ? = 1 THEN ? ELSE website END,
              talent_type=?,
              username=COALESCE(?, username),
              email=COALESCE(?, email)
        WHERE id=?`,
      [
        full_name || null,
        phone || null,
        bio || null,
        hasWebsite ? 1 : 0,
        hasWebsite ? (normalizedWebsite || null) : null,
        talent_type || 'Viewer',
        normalizedUsername,
        normalizedEmail,
        req.user!.userId,
      ]
    );

    const [rows] = await pool.query<any[]>('SELECT * FROM users WHERE id=?', [req.user!.userId]);
    res.json({ success: true, data: publicUser((rows as UserRow[])[0]) });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/me/avatar — upload profile picture
export const updateAvatar = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const file = (req as any).file;
    if (!file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }
    const [[current]] = await pool.query<any[]>(
      'SELECT avatar_url FROM users WHERE id = ? LIMIT 1',
      [req.user!.userId]
    );
    if (current?.avatar_url) deleteAvatarFile(current.avatar_url);

    const host = `${req.protocol}://${req.get('host')}`;
    const avatar_url = `${host}/uploads/avatars/${file.filename}`;
    await pool.query('UPDATE users SET avatar_url=? WHERE id=?', [avatar_url, req.user!.userId]);
    const [rows] = await pool.query<any[]>('SELECT * FROM users WHERE id=?', [req.user!.userId]);
    res.json({ success: true, data: publicUser((rows as UserRow[])[0]) });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/auth/me/avatar — remove profile picture
export const deleteAvatar = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [req.user!.userId]
    );
    const user = (rows as UserRow[])[0];
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    deleteAvatarFile(user.avatar_url);
    await pool.query('UPDATE users SET avatar_url = NULL WHERE id = ?', [req.user!.userId]);

    const [updatedRows] = await pool.query<any[]>(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [req.user!.userId]
    );
    res.json({ success: true, data: publicUser((updatedRows as UserRow[])[0]) });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/auth/me — delete account
export const deleteMe = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    await pool.query('DELETE FROM users WHERE id = ?', [req.user!.userId]);
    res.json({ success: true, data: null, message: 'Account deleted' });
  } catch (err) {
    next(err);
  }
};

// PUT /api/auth/me/password — change password (authenticated)
export const changePassword = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password || new_password.length < 8) {
      res.status(400).json({ success: false, error: 'Invalid input' }); return;
    }
    const [rows] = await pool.query<any[]>('SELECT password_hash FROM users WHERE id = ?', [req.user!.userId]);
    const user = (rows as any[])[0];
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) { res.status(401).json({ success: false, error: 'Current password is incorrect' }); return; }
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user!.userId]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/reset-password — reset password by email (public)
export const resetPassword = async (
  req: Request, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const { email, new_password } = req.body;
    if (!email || !new_password || new_password.length < 8) {
      res.status(400).json({ success: false, error: 'Invalid input' }); return;
    }
    const [rows] = await pool.query<any[]>('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    const user = (rows as any[])[0];
    if (!user) { res.status(404).json({ success: false, error: 'No account with that email' }); return; }
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// Helper
const publicUser = (u: UserRow) => ({
  id:          u.id,
  username:    u.username,
  email:       u.email,
  full_name:   u.full_name,
  phone:       u.phone,
  avatar_url:  u.avatar_url,
  bio:         u.bio,
  website:     u.website,
  talent_type: u.talent_type,
  created_at:  u.created_at,
});
