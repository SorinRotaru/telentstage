import pool from './database';

/**
 * Enhanced admin setup — creates additional tables for:
 * - Audit logs (immutable action tracking)
 * - Content reports (moderation queue)
 * - User strikes (abuse/risk controls)
 * - Feature flags (operational toggles)
 * - System settings (maintenance mode, etc.)
 * - Admin login attempts (security tracking)
 *
 * Also adds new columns to existing tables (idempotent).
 */
export const setupEnhancedAdminTables = async (): Promise<void> => {
  // 1. Audit Logs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id            VARCHAR(36)  PRIMARY KEY,
      admin_id      VARCHAR(36),
      admin_username VARCHAR(50) COLLATE utf8mb4_unicode_ci,
      action        VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
      entity_type   VARCHAR(50) COLLATE utf8mb4_unicode_ci,
      entity_id     VARCHAR(36),
      old_value     JSON,
      new_value     JSON,
      ip_address    VARCHAR(45),
      user_agent    TEXT,
      created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
      KEY idx_audit_admin   (admin_id),
      KEY idx_audit_entity  (entity_type, entity_id),
      KEY idx_audit_action  (action),
      KEY idx_audit_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 2. Content Reports (moderation queue)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id              VARCHAR(36)  PRIMARY KEY,
      reporter_id     VARCHAR(36),
      entity_type     ENUM('video','comment','user') COLLATE utf8mb4_unicode_ci NOT NULL,
      entity_id       VARCHAR(36)  NOT NULL,
      reason          VARCHAR(100) COLLATE utf8mb4_unicode_ci,
      description     TEXT COLLATE utf8mb4_unicode_ci,
      status          ENUM('pending','reviewing','resolved','dismissed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
      priority        ENUM('low','medium','high','critical') COLLATE utf8mb4_unicode_ci DEFAULT 'medium',
      reviewed_by     VARCHAR(36),
      reviewed_at     TIMESTAMP    NULL,
      resolution_note TEXT COLLATE utf8mb4_unicode_ci,
      created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      KEY idx_reports_status  (status),
      KEY idx_reports_entity  (entity_type, entity_id),
      KEY idx_reports_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 3. User Strikes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_strikes (
      id           VARCHAR(36)  PRIMARY KEY,
      user_id      VARCHAR(36)  NOT NULL,
      admin_id     VARCHAR(36),
      reason       VARCHAR(255) COLLATE utf8mb4_unicode_ci,
      strike_type  ENUM('warning','strike','temp_ban','permanent_ban','shadow_ban') COLLATE utf8mb4_unicode_ci DEFAULT 'strike',
      expires_at   TIMESTAMP    NULL,
      is_active    TINYINT(1)   DEFAULT 1,
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      KEY idx_strikes_user    (user_id),
      KEY idx_strikes_active  (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 4. Feature Flags
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      id          VARCHAR(36)   PRIMARY KEY,
      flag_key    VARCHAR(100)  COLLATE utf8mb4_unicode_ci UNIQUE NOT NULL,
      flag_value  TINYINT(1)    DEFAULT 0,
      description VARCHAR(255) COLLATE utf8mb4_unicode_ci,
      updated_by  VARCHAR(36),
      updated_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 5. System Settings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key   VARCHAR(100) COLLATE utf8mb4_unicode_ci PRIMARY KEY,
      setting_value TEXT COLLATE utf8mb4_unicode_ci,
      updated_by    VARCHAR(36),
      updated_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 6. Admin Login Attempts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_login_attempts (
      id          VARCHAR(36)  PRIMARY KEY,
      username    VARCHAR(100) COLLATE utf8mb4_unicode_ci,
      ip_address  VARCHAR(45),
      user_agent  TEXT,
      success     TINYINT(1)   DEFAULT 0,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ala_ip      (ip_address),
      KEY idx_ala_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 7. Comment Likes table (idempotent)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id  CHAR(36)     NOT NULL,
      user_id     CHAR(36)     NOT NULL,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (comment_id, user_id),
      KEY idx_cl_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 8. Video engagement events (recommender signals)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_engagement_events (
      id            VARCHAR(36) PRIMARY KEY,
      video_id      CHAR(36) NOT NULL,
      user_id       CHAR(36) NULL,
      viewer_key    VARCHAR(191) COLLATE utf8mb4_unicode_ci NULL,
      event_type    VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
      event_value   DECIMAL(8,3) NULL,
      watch_seconds DECIMAL(10,3) NULL,
      talent_type   VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL,
      metadata      JSON NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vee_video_created (video_id, created_at),
      KEY idx_vee_user_created  (user_id, created_at),
      KEY idx_vee_type_created  (event_type, created_at),
      KEY idx_vee_talent_created (talent_type, created_at),
      KEY idx_vee_viewer_created (viewer_key, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 9. User category affinity (personalized ranking)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_category_affinity (
      user_id        CHAR(36) NOT NULL,
      talent_type    VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
      score          DECIMAL(10,4) NOT NULL DEFAULT 0,
      event_count    INT NOT NULL DEFAULT 0,
      last_event_at  TIMESTAMP NULL,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, talent_type),
      KEY idx_uca_score (score),
      KEY idx_uca_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 10. Add columns to users/comments tables (idempotent)
  const addCol = async (table: string, col: string, def: string) => {
    try { await pool.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
    catch { /* column already exists */ }
  };
  const addIndex = async (table: string, idx: string, cols: string) => {
    try { await pool.query(`ALTER TABLE ${table} ADD INDEX ${idx} (${cols})`); }
    catch { /* index already exists */ }
  };

  await addCol('users', 'shadow_banned', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addCol('users', 'strike_count',  'INT NOT NULL DEFAULT 0');
  await addCol('users', 'comment_cooldown_until', 'TIMESTAMP NULL');
  await addCol('users', 'website', 'VARCHAR(500) NULL');
  await addCol('admin_users', 'avatar_url', 'VARCHAR(500) NULL');
  await addCol('comments', 'parent_comment_id', 'CHAR(36) NULL');
  await addCol('comments', 'likes_count', 'INT NOT NULL DEFAULT 0');
  await addCol('comments', 'is_hidden', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addCol('comments', 'moderation_hold_set_at', 'TIMESTAMP NULL');
  await addCol('comments', 'moderation_hold_until', 'TIMESTAMP NULL');
  await addCol('comments', 'moderation_hold_report_id', 'VARCHAR(36) NULL');
  await addCol('videos', 'moderation_hold_set_at', 'TIMESTAMP NULL');
  await addCol('videos', 'moderation_hold_until', 'TIMESTAMP NULL');
  await addCol('videos', 'moderation_hold_report_id', 'VARCHAR(36) NULL');
  await addIndex('comments', 'idx_cmt_parent', 'parent_comment_id');
  await addIndex('comments', 'idx_cmt_video_created', 'video_id, created_at');
  await addIndex('comments', 'idx_cmt_hidden', 'is_hidden');
  await addIndex('comments', 'idx_cmt_mod_hold_until', 'moderation_hold_until');
  await addIndex('comments', 'idx_cmt_mod_hold_report', 'moderation_hold_report_id');
  await addIndex('videos', 'idx_vid_mod_hold_until', 'moderation_hold_until');
  await addIndex('videos', 'idx_vid_mod_hold_report', 'moderation_hold_report_id');

  // 11. Add FK on comments.parent_comment_id (idempotent)
  try {
    await pool.query(
      'ALTER TABLE comments ADD CONSTRAINT fk_cmt_parent FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE'
    );
  } catch { /* already exists or cannot be added */ }

  // 12. Add FK on comment_likes table (idempotent)
  try {
    await pool.query(
      'ALTER TABLE comment_likes ADD CONSTRAINT fk_cl_comment FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE'
    );
  } catch { /* already exists or cannot be added */ }
  try {
    await pool.query(
      'ALTER TABLE comment_likes ADD CONSTRAINT fk_cl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'
    );
  } catch { /* already exists or cannot be added */ }

  // 13. Add FKs on recommender tables (idempotent)
  try {
    await pool.query(
      'ALTER TABLE video_engagement_events ADD CONSTRAINT fk_vee_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE'
    );
  } catch { /* already exists or cannot be added */ }
  try {
    await pool.query(
      'ALTER TABLE video_engagement_events ADD CONSTRAINT fk_vee_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL'
    );
  } catch { /* already exists or cannot be added */ }
  try {
    await pool.query(
      'ALTER TABLE user_category_affinity ADD CONSTRAINT fk_uca_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'
    );
  } catch { /* already exists or cannot be added */ }

  // 14. Update admin_users role enum to include 'support'
  try {
    await pool.query(`ALTER TABLE admin_users MODIFY COLUMN role ENUM('superadmin','moderator','support') DEFAULT 'moderator'`);
  } catch { /* already updated or enum same */ }

  // 15. Seed default feature flags if empty
  const [flagRows] = await pool.query<any[]>('SELECT COUNT(*) AS cnt FROM feature_flags');
  if ((flagRows as any[])[0].cnt === 0) {
    const flags = [
      ['uploads_enabled',     1, 'Allow users to upload new videos'],
      ['registration_enabled', 1, 'Allow new user registrations'],
      ['comments_enabled',     1, 'Allow users to post comments'],
      ['maintenance_mode',     0, 'Put the platform in maintenance mode'],
      ['shadow_ban_enabled',   1, 'Enable shadow ban functionality'],
      ['hybrid_recommendation_enabled', 1, 'Enable hybrid feed ranking + exploration'],
      ['feed_swipe_timer_enabled', 1, 'Enable swipe countdown lock in feed'],
    ];
    for (const [key, val, desc] of flags) {
      const { v4: uid } = await import('uuid');
      await pool.query(
        'INSERT IGNORE INTO feature_flags (id, flag_key, flag_value, description) VALUES (?, ?, ?, ?)',
        [uid(), key, val, desc]
      );
    }
    console.log('   Feature flags seeded');
  }
  // Ensure rollout flag exists even when flags table was already seeded in older versions.
  try {
    const { v4: uid } = await import('uuid');
    await pool.query(
      'INSERT IGNORE INTO feature_flags (id, flag_key, flag_value, description) VALUES (?, ?, ?, ?)',
      [uid(), 'hybrid_recommendation_enabled', 1, 'Enable hybrid feed ranking + exploration']
    );
  } catch { /* ignore */ }
  try {
    const { v4: uid } = await import('uuid');
    await pool.query(
      'INSERT IGNORE INTO feature_flags (id, flag_key, flag_value, description) VALUES (?, ?, ?, ?)',
      [uid(), 'feed_swipe_timer_enabled', 1, 'Enable swipe countdown lock in feed']
    );
  } catch { /* ignore */ }

  // 16. Seed default system settings if empty
  const [setRows] = await pool.query<any[]>('SELECT COUNT(*) AS cnt FROM system_settings');
  if ((setRows as any[])[0].cnt === 0) {
    const settings = [
      ['session_timeout_minutes', '480'],
      ['max_strikes_before_ban',  '3'],
      ['auto_ban_on_max_strikes', '1'],
      ['report_auto_hide_threshold', '5'],
      ['feed_swipe_timer_ms', '5000'],
      ['feed_swipe_timer_seconds', '5'],
      ['feed_swipe_timer_opacity', '0.75'],
      ['feed_swipe_timer_visible', '1'],
    ];
    for (const [key, val] of settings) {
      await pool.query(
        'INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
        [key, val]
      );
    }
    console.log('   System settings seeded');
  }
  try {
    await pool.query(
      'INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
      ['feed_swipe_timer_ms', '5000']
    );
  } catch { /* ignore */ }
  try {
    await pool.query(
      'INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
      ['feed_swipe_timer_seconds', '5']
    );
  } catch { /* ignore */ }
  try {
    await pool.query(
      'INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
      ['feed_swipe_timer_opacity', '0.75']
    );
  } catch { /* ignore */ }
  try {
    await pool.query(
      'INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
      ['feed_swipe_timer_visible', '1']
    );
  } catch { /* ignore */ }

  // 17. Fix collations on existing tables (idempotent)
  try {
    await pool.query('ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  } catch { /* already done */ }
  try {
    await pool.query('ALTER TABLE videos CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  } catch { /* already done */ }
  try {
    await pool.query('ALTER TABLE comments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  } catch { /* already done */ }
  try {
    await pool.query('ALTER TABLE admin_users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  } catch { /* already done */ }
  try {
    await pool.query('ALTER TABLE comment_likes CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  } catch { /* already done */ }
  try {
    await pool.query('ALTER TABLE video_engagement_events CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  } catch { /* already done */ }
  try {
    await pool.query('ALTER TABLE user_category_affinity CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  } catch { /* already done */ }

  // Retry comment-related FKs after collation normalization.
  try {
    await pool.query(
      'ALTER TABLE comments ADD CONSTRAINT fk_cmt_parent FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE'
    );
  } catch { /* already exists or cannot be added */ }
  try {
    await pool.query(
      'ALTER TABLE comment_likes ADD CONSTRAINT fk_cl_comment FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE'
    );
  } catch { /* already exists or cannot be added */ }
  try {
    await pool.query(
      'ALTER TABLE comment_likes ADD CONSTRAINT fk_cl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'
    );
  } catch { /* already exists or cannot be added */ }

  console.log('   Enhanced admin tables ready');
};
