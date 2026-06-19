import { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export const errorHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('❌ Error:', err.message);

  // Multer errors
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ success: false, error: 'File too large' });
      return;
    }
    res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    return;
  }

  // MySQL duplicate entry
  if ((err as NodeJS.ErrnoException).code === 'ER_DUP_ENTRY') {
    res.status(409).json({ success: false, error: 'A record with this value already exists' });
    return;
  }

  const status = err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ success: false, error: message });
};

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ success: false, error: 'Route not found' });
};
