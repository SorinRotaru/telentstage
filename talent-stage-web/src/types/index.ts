export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  website?: string | null;
  talent_type: string;
  created_at: string;
}

export interface UserWithStats extends User {
  follower_count: number;
  following_count: number;
  video_count: number;
  is_followed: number;
}

export interface Video {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  title: string;
  description: string | null;
  tags: string[];
  filename: string;
  file_url: string;
  thumbnail_url: string | null;
  talent_type: string | null;
  is_public: number;
  views: number;
  unique_views: number;
  likes: number;
  dislikes: number;
  cycle_number: number;
  cycle_view_limit: number;
  is_saved: number;
  is_following_author: number;
  is_liked: null | 'like' | 'dislike';
  share_id?: string;
  shared_at?: string;
  platform?: string;
  created_at: string;
}

export interface Comment {
  id: string;
  video_id: string;
  user_id: string;
  parent_comment_id: string | null;
  username: string;
  full_name: string;
  avatar_url: string | null;
  body: string;
  likes_count: number;
  reply_count?: number;
  is_liked?: number;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export type TalentType =
  | 'Singer' | 'Musician' | 'Dancer' | 'Rapper' | 'Comedian'
  | 'Magician' | 'Actor' | 'Acrobat' | 'Martial Artist' | 'Athlete'
  | 'Variety' | 'Visual Artist' | 'Impressionist' | 'Ventriloquist'
  | 'Unique Talent' | 'Viewer';

export const TALENT_TYPES: TalentType[] = [
  'Singer', 'Musician', 'Dancer', 'Rapper', 'Comedian',
  'Magician', 'Actor', 'Acrobat', 'Martial Artist', 'Athlete',
  'Variety', 'Visual Artist', 'Impressionist', 'Ventriloquist',
  'Unique Talent',
];
