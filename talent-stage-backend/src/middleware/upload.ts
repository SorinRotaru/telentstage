/**
 * Multer v2 upload middleware.
 * v2 changed from a default export to named exports and the middleware
 * is now async (returns Promise instead of calling next directly).
 */
import { diskStorage, MulterError } from 'multer';
import type { Options, Field } from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';

// Ensure upload directories exist
const ensureUploadDirs = (baseDir: string) => {
  const dirs = {
    videos: path.join(baseDir, 'videos'),
    thumbnails: path.join(baseDir, 'thumbnails'),
    avatars: path.join(baseDir, 'avatars'),
  };
  Object.values(dirs).forEach(d => fs.mkdirSync(d, { recursive: true }));
  return dirs;
};

const resolveUploadDir = () => {
  const configured = (process.env.UPLOAD_DIR || 'uploads').trim();
  try {
    ensureUploadDirs(configured);
    return configured;
  } catch (err) {
    const fallback = path.resolve(process.cwd(), 'uploads');
    try {
      ensureUploadDirs(fallback);
      console.warn(
        `⚠️  UPLOAD_DIR "${configured}" is not writable; falling back to "${fallback}"`,
        (err as any)?.message || err
      );
      return fallback;
    } catch (fallbackErr) {
      throw new Error(
        `Unable to initialize upload directories for "${configured}" and fallback "${fallback}": ` +
        `${(fallbackErr as any)?.message || fallbackErr}`
      );
    }
  }
};

export const UPLOAD_DIR = resolveUploadDir();
export const DIRS = {
  videos: path.join(UPLOAD_DIR, 'videos'),
  thumbnails: path.join(UPLOAD_DIR, 'thumbnails'),
  avatars: path.join(UPLOAD_DIR, 'avatars'),
};

// Allowed MIME types
const VIDEO_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'video/x-msvideo', 'video/mpeg', 'video/3gpp', 'video/x-matroska',
]);
const IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
]);

// Storage builders
const makeStorage = (subdir: string) =>
  diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(UPLOAD_DIR, subdir)),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${uuid()}${ext}`);
    },
  });

// Dynamic storage that picks folder based on fieldname
const combinedStorage = diskStorage({
  destination: (_req, file, cb) => {
    const subdir = file.fieldname === 'thumbnail' ? 'thumbnails' : 'videos';
    cb(null, path.join(UPLOAD_DIR, subdir));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${uuid()}${ext}`);
  },
});

// Multer v2: import dynamically (it's ESM-only in v2)
// We use a wrapper so callers get normal Express middleware functions.

let _multer: any;
const getMulter = async (): Promise<any> => {
  if (!_multer) {
    // multer v2 is ESM; use dynamic import
    const mod = await import('multer');
    _multer = mod;
  }
  return _multer;
};

// Helper: wrap multer call into an Express middleware
function makeMiddleware(opts: Options, kind: 'single', field: string): (req: Request, res: Response, next: NextFunction) => void;
function makeMiddleware(opts: Options, kind: 'fields', fields: Field[]): (req: Request, res: Response, next: NextFunction) => void;
function makeMiddleware(opts: Options, kind: 'single' | 'fields', fieldOrFields: string | Field[]): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    getMulter().then((mod: any) => {
      // multer v2: multer(opts) returns an object with .single / .fields etc.
      const instance = mod.default ? mod.default(opts) : mod(opts);
      let handler: any;
      if (kind === 'single') {
        handler = instance.single(fieldOrFields as string);
      } else {
        handler = instance.fields(fieldOrFields as Field[]);
      }
      handler(req, res, (err: any) => {
        if (err) {
          if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ success: false, error: 'File too large' });
            return;
          }
          next(err);
          return;
        }
        next();
      });
    }).catch(next);
  };
}

// Public middleware

//Upload a single video file (field name: "video")
export const uploadVideoMiddleware = makeMiddleware(
  {
    storage:  makeStorage('videos'),
    fileFilter: (_req, file, cb) => {
      VIDEO_TYPES.has(file.mimetype)
        ? cb(null, true)
        : cb(new Error(`Unsupported video type: ${file.mimetype}`));
    },
    limits: { fileSize: parseInt(process.env.MAX_VIDEO_SIZE || '524288000') },
  },
  'single', 'video'
);

/** Upload a single image for thumbnail (field name: "thumbnail") */
export const uploadThumbnailMiddleware = makeMiddleware(
  {
    storage:  makeStorage('thumbnails'),
    fileFilter: (_req, file, cb) => {
      IMAGE_TYPES.has(file.mimetype)
        ? cb(null, true)
        : cb(new Error(`Unsupported image type: ${file.mimetype}`));
    },
    limits: { fileSize: parseInt(process.env.MAX_IMAGE_SIZE || '10485760') },
  },
  'single', 'thumbnail'
);

/** Upload a single image for avatar (field name: "avatar") */
export const uploadAvatarMiddleware = makeMiddleware(
  {
    storage:  makeStorage('avatars'),
    fileFilter: (_req, file, cb) => {
      IMAGE_TYPES.has(file.mimetype)
        ? cb(null, true)
        : cb(new Error(`Unsupported image type: ${file.mimetype}`));
    },
    limits: { fileSize: parseInt(process.env.MAX_IMAGE_SIZE || '10485760') },
  },
  'single', 'avatar'
);

/** Upload video + optional thumbnail in one request */
export const uploadVideoWithThumb = makeMiddleware(
  {
    storage: combinedStorage,
    fileFilter: (_req, file, cb) => {
      const allowed = file.fieldname === 'thumbnail' ? IMAGE_TYPES : VIDEO_TYPES;
      allowed.has(file.mimetype)
        ? cb(null, true)
        : cb(new Error(`Unsupported file type: ${file.mimetype}`));
    },
    limits: { fileSize: parseInt(process.env.MAX_VIDEO_SIZE || '524288000') },
  },
  'fields',
  [{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]
);

// Keep old export names as aliases so other files don't need changes
export const uploadVideo    = uploadVideoMiddleware;
export const uploadThumbnail = uploadThumbnailMiddleware;
export const uploadAvatar   = uploadAvatarMiddleware;
