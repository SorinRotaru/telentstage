import { Router } from 'express';
import {
  getUsers, getUser, followUser,
  getFollowers, getFollowing, updateAvatar, reportUser, getCreatorAnalytics,
} from '../controllers/userController';
import { authenticate, optionalAuth } from '../middleware/auth';
import { uploadAvatarMiddleware } from '../middleware/upload';

const router = Router();

router.get ('/',              optionalAuth, getUsers);
router.get ('/:id/creator-analytics', optionalAuth, getCreatorAnalytics);
router.get ('/:id',           optionalAuth, getUser);
router.post('/:id/follow',    authenticate, followUser);
router.post('/:id/report',    authenticate, reportUser);
router.get ('/:id/followers', optionalAuth, getFollowers);
router.get ('/:id/following', optionalAuth, getFollowing);
router.put ('/me/avatar',     authenticate, uploadAvatarMiddleware, updateAvatar);

export default router;
