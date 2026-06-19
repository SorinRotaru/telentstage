import { Request } from 'express';

// Auth
export interface JwtPayload {
  userId: string;
  username: string;
  email: string;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

// DB Row types
export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  website: string | null;
  talent_type: string;
  is_active: number;
  created_at: Date;
  updated_at: Date;
}

export interface VideoRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  tags: string | null;      // JSON string
  filename: string;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  duration_sec: number | null;
  thumbnail_url: string | null;
  talent_type: string | null;
  views: number;
  likes: number;
  dislikes: number;
  is_public: number;
  created_at: Date;
  updated_at: Date;
  // joined fields
  username?: string;
  full_name?: string;
  avatar_url?: string;
  is_saved?: number;
  is_liked?: number;
  is_following_author?: number;
}

export interface CommentRow {
  id: string;
  video_id: string;
  user_id: string;
  parent_comment_id: string | null;
  body: string;
  likes_count: number;
  reply_count?: number;
  is_liked?: number;
  created_at: Date;
  username?: string;
  full_name?: string;
  avatar_url?: string;
}

export interface FollowRow {
  follower_id: string;
  following_id: string;
  created_at: Date;
  username?: string;
  full_name?: string;
  avatar_url?: string;
  talent_type?: string;
}

// API response helpers
export type ApiResponse<T = unknown> =
  | { success: true;  data: T; message?: string }
  | { success: false; error: string; details?: unknown };

// Pagination
export interface PaginationQuery {
  page?: string;
  limit?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
