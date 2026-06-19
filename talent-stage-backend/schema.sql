-- Talents Stage base schema
-- Import this file into your selected database (u428592730_talents) in phpMyAdmin.

CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(120) NOT NULL DEFAULT '',
  phone         VARCHAR(30)           DEFAULT NULL,
  avatar_url    VARCHAR(500)          DEFAULT NULL,
  bio           TEXT                  DEFAULT NULL,
  website       VARCHAR(500)          DEFAULT NULL,
  talent_type   ENUM(
    'Singer','Musician','Dancer','Rapper','Comedian',
    'Magician','Actor','Acrobat','Martial Artist','Athlete',
    'Variety','Visual Artist','Impressionist','Ventriloquist',
    'Unique Talent','Viewer'
  ) NOT NULL DEFAULT 'Viewer',
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username),
  INDEX idx_email    (email),
  INDEX idx_talent   (talent_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS videos (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  user_id       CHAR(36)      NOT NULL,
  title         VARCHAR(255)  NOT NULL,
  description   TEXT                   DEFAULT NULL,
  tags          JSON                   DEFAULT NULL,
  filename      VARCHAR(255)  NOT NULL,
  original_name VARCHAR(255)  NOT NULL,
  file_path     VARCHAR(500)  NOT NULL,
  file_size     BIGINT        NOT NULL DEFAULT 0,
  mime_type     VARCHAR(100)  NOT NULL DEFAULT 'video/mp4',
  duration_sec  DECIMAL(10,2)          DEFAULT NULL,
  thumbnail_url VARCHAR(500)           DEFAULT NULL,
  talent_type   VARCHAR(50)            DEFAULT NULL,
  views              INT           NOT NULL DEFAULT 0,
  likes              INT           NOT NULL DEFAULT 0,
  dislikes           INT           NOT NULL DEFAULT 0,
  cycle_number       INT           NOT NULL DEFAULT 0,
  cycle_view_limit   INT           NOT NULL DEFAULT 0,
  cycle_views_start  INT           NOT NULL DEFAULT 0,
  moderation_hold_set_at DATETIME         DEFAULT NULL,
  moderation_hold_until  DATETIME         DEFAULT NULL,
  moderation_hold_report_id CHAR(36)      DEFAULT NULL,
  is_public     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_video_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_vid_user   (user_id),
  INDEX idx_vid_pub    (is_public),
  INDEX idx_vid_mod_hold_until (moderation_hold_until),
  INDEX idx_vid_mod_hold_report (moderation_hold_report_id),
  INDEX idx_vid_talent (talent_type),
  FULLTEXT ft_vid_search (title, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS follows (
  follower_id  CHAR(36) NOT NULL,
  following_id CHAR(36) NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT fk_flw_follower  FOREIGN KEY (follower_id)  REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_flw_following FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_flw_following (following_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_videos (
  user_id    CHAR(36) NOT NULL,
  video_id   CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, video_id),
  CONSTRAINT fk_sv_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_sv_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shared_videos (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  user_id    CHAR(36)    NOT NULL,
  video_id   CHAR(36)    NOT NULL,
  platform   VARCHAR(50)          DEFAULT 'app',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_shv_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_shv_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  INDEX idx_shv_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS video_likes (
  user_id    CHAR(36)                NOT NULL,
  video_id   CHAR(36)                NOT NULL,
  type       ENUM('like','dislike')  NOT NULL,
  created_at DATETIME                NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, video_id),
  CONSTRAINT fk_vl_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_vl_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id         CHAR(36)  NOT NULL PRIMARY KEY,
  video_id   CHAR(36)  NOT NULL,
  user_id    CHAR(36)  NOT NULL,
  parent_comment_id CHAR(36) DEFAULT NULL,
  body       TEXT      NOT NULL,
  likes_count INT      NOT NULL DEFAULT 0,
  is_hidden  TINYINT(1) NOT NULL DEFAULT 0,
  moderation_hold_set_at DATETIME DEFAULT NULL,
  moderation_hold_until  DATETIME DEFAULT NULL,
  moderation_hold_report_id CHAR(36) DEFAULT NULL,
  created_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cmt_video  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  CONSTRAINT fk_cmt_user   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cmt_parent FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  INDEX idx_cmt_video (video_id),
  INDEX idx_cmt_parent (parent_comment_id),
  INDEX idx_cmt_hidden (is_hidden),
  INDEX idx_cmt_mod_hold_until (moderation_hold_until),
  INDEX idx_cmt_mod_hold_report (moderation_hold_report_id),
  INDEX idx_cmt_video_created (video_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id  CHAR(36)  NOT NULL,
  user_id     CHAR(36)  NOT NULL,
  created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, user_id),
  CONSTRAINT fk_cl_comment FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  CONSTRAINT fk_cl_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  INDEX idx_cl_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  DATETIME     NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_rt_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
