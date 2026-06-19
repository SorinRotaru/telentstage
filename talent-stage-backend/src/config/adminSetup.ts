import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import pool from './database';

const DEFAULT_SUPERADMIN_USERNAME = 'ceo_sorin';
const DEFAULT_SUPERADMIN_EMAIL = 'info@rotarusorin.com';
const DEFAULT_SUPERADMIN_FULL_NAME = 'Sorin Rotaru';
const LEGACY_SUPERADMIN_USERNAME = 'superadmin';
const LEGACY_SUPERADMIN_EMAIL = 'admin@talentsstage.com';

export const setupAdminTable = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id           VARCHAR(36)  PRIMARY KEY,
      username     VARCHAR(50)  UNIQUE NOT NULL,
      email        VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name    VARCHAR(100),
      avatar_url   VARCHAR(500),
      role         ENUM('superadmin','moderator') DEFAULT 'moderator',
      is_active    TINYINT(1)   DEFAULT 1,
      last_login   TIMESTAMP    NULL,
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // video_views table for unique view tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_views (
      video_id   VARCHAR(36)  NOT NULL,
      viewer_key VARCHAR(100) NOT NULL,
      created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (video_id, viewer_key),
      KEY idx_vv_video (video_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // unique_views column on videos
  try {
    await pool.query('ALTER TABLE videos ADD COLUMN unique_views INT NOT NULL DEFAULT 0');
    console.log('✅  unique_views column added to videos');
  } catch { /* column already exists */ }

  // Seed default superadmin if no admins exist
  const [rows] = await pool.query<any[]>('SELECT COUNT(*) AS cnt FROM admin_users');
  if ((rows as any[])[0].cnt === 0) {
    const hash = await bcrypt.hash('Admin@123456', 12);
    await pool.query(
      `INSERT INTO admin_users (id, username, email, password_hash, full_name, role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), DEFAULT_SUPERADMIN_USERNAME, DEFAULT_SUPERADMIN_EMAIL, hash, DEFAULT_SUPERADMIN_FULL_NAME, 'superadmin']
    );
    console.log(`🔑  Default superadmin created  →  ${DEFAULT_SUPERADMIN_USERNAME} / Admin@123456`);
  } else {
    // Migrate legacy default superadmin account identity to the configured one.
    try {
      const [legacyRows] = await pool.query<any[]>(
        `SELECT id, username, email
         FROM admin_users
         WHERE role = 'superadmin' AND (username = ? OR email = ?)
         LIMIT 1`,
        [LEGACY_SUPERADMIN_USERNAME, LEGACY_SUPERADMIN_EMAIL]
      );
      const legacy = (legacyRows as any[])[0];

      if (legacy) {
        const [targetRows] = await pool.query<any[]>(
          'SELECT id FROM admin_users WHERE (username = ? OR email = ?) LIMIT 1',
          [DEFAULT_SUPERADMIN_USERNAME, DEFAULT_SUPERADMIN_EMAIL]
        );
        const target = (targetRows as any[])[0];

        if (!target || target.id === legacy.id) {
          await pool.query(
            'UPDATE admin_users SET username = ?, email = ?, full_name = ? WHERE id = ?',
            [DEFAULT_SUPERADMIN_USERNAME, DEFAULT_SUPERADMIN_EMAIL, DEFAULT_SUPERADMIN_FULL_NAME, legacy.id]
          );
          console.log(
            `✅  Superadmin identity updated  →  ${DEFAULT_SUPERADMIN_USERNAME} / ${DEFAULT_SUPERADMIN_EMAIL}`
          );
        } else {
          console.log(
            `⚠️  Could not auto-migrate legacy superadmin identity because target username/email already exists on another account`
          );
        }
      }

      // Backfill legacy full name if still on generic default.
      const [namedRows] = await pool.query<any[]>(
        'SELECT id, full_name FROM admin_users WHERE (username = ? OR email = ?) AND role = ? LIMIT 1',
        [DEFAULT_SUPERADMIN_USERNAME, DEFAULT_SUPERADMIN_EMAIL, 'superadmin']
      );
      const named = (namedRows as any[])[0];
      if (named && (!named.full_name || String(named.full_name).trim().toLowerCase() === 'super admin')) {
        await pool.query('UPDATE admin_users SET full_name = ? WHERE id = ?', [DEFAULT_SUPERADMIN_FULL_NAME, named.id]);
        console.log(`✅  Superadmin full name updated  →  ${DEFAULT_SUPERADMIN_FULL_NAME}`);
      }
    } catch (e) {
      console.log('⚠️  Superadmin identity migration skipped:', (e as Error)?.message || e);
    }
  }
};
