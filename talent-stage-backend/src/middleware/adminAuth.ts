import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { AuthRequest } from '../models/types';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export interface AdminRequest extends AuthRequest {
  admin?: { id: string; username: string; email: string; role: 'superadmin' | 'moderator' | 'support' };
}

export const adminAuthenticate = async (
  req: AdminRequest, res: Response, next: NextFunction
): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'No token provided' });
    return;
  }
  try {
    const token   = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (!payload.adminId) {
      res.status(401).json({ success: false, error: 'Invalid admin token' });
      return;
    }
    const [rows] = await pool.query<any[]>(
      'SELECT id, username, email, role, is_active FROM admin_users WHERE id = ? LIMIT 1',
      [payload.adminId]
    );
    const admin = (rows as any[])[0];
    if (!admin || !admin.is_active) {
      res.status(401).json({ success: false, error: 'Admin not found or inactive' });
      return;
    }
    req.admin = admin;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

export const requireSuperAdmin = (
  req: AdminRequest, res: Response, next: NextFunction
): void => {
  if (req.admin?.role !== 'superadmin') {
    res.status(403).json({ success: false, error: 'Superadmin access required' });
    return;
  }
  next();
};

/** Allows superadmin and moderator, blocks support role */
export const requireModerator = (
  req: AdminRequest, res: Response, next: NextFunction
): void => {
  if (req.admin?.role === 'support') {
    res.status(403).json({ success: false, error: 'Moderator or superadmin access required' });
    return;
  }
  next();
};
