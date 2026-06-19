import { Router } from 'express';
import {
  uploadVideo, getVideos, getVideo, updateVideo, deleteVideo,
  getUserVideos, likeVideo, saveVideo, getSavedVideos,
  shareVideo, unshareVideo, unshareVideoByShareId, getSharedVideos, recordView, trackVideoSignal,
  reportVideo, getMyStrikes,
} from '../controllers/videoController';
import { getComments, addComment, deleteComment, reportComment, toggleCommentLike } from '../controllers/commentController';
import { authenticate, optionalAuth } from '../middleware/auth';
import { uploadVideoWithThumb } from '../middleware/upload';

const router = Router();

// Feed / Browse
router.get('/saved',        authenticate,  getSavedVideos);
router.get('/shared',       authenticate,  getSharedVideos);
router.delete('/shared/:shareId', authenticate, unshareVideoByShareId);
router.get('/user/:userId', optionalAuth,  getUserVideos);
router.get('/',             optionalAuth,  getVideos);

// Upload
router.post('/', authenticate, uploadVideoWithThumb, uploadVideo);

// Single video
router.get   ('/:id', optionalAuth,  getVideo);
router.put   ('/:id', authenticate,  updateVideo);
router.delete('/:id', authenticate,  deleteVideo);

// Interactions
router.post('/:id/view',    optionalAuth, recordView);
router.post('/:id/event',   optionalAuth, trackVideoSignal);
router.post('/:id/like',    authenticate, likeVideo);
router.post('/:id/dislike', authenticate, likeVideo);
router.post('/:id/save',    authenticate, saveVideo);
router.post('/:id/share',   authenticate, shareVideo);
router.delete('/:id/share', authenticate, unshareVideo);

// Comments
router.get   ('/:id/comments',            optionalAuth, getComments);
router.post  ('/:id/comments',            authenticate, addComment);
router.delete('/:id/comments/:commentId', authenticate, deleteComment);
router.post  ('/:id/comments/:commentId/like', authenticate, toggleCommentLike);
router.post  ('/:id/comments/:commentId/report', authenticate, reportComment);

// User Actions
router.post  ('/:id/report', authenticate, reportVideo);
router.get   ('/me/strikes', authenticate, getMyStrikes);

export default router;
