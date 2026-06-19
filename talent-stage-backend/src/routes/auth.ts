import { Router } from 'express';
import { register, login, getMe, updateMe, updateAvatar, deleteAvatar, deleteMe, changePassword, resetPassword } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { uploadAvatarMiddleware } from '../middleware/upload';

const router = Router();

// Public
router.post('/register',       register);
router.post('/login',          login);
router.post('/reset-password', resetPassword);

// Protected
router.get   ('/me',        authenticate, getMe);
router.put   ('/me',        authenticate, updateMe);
router.post  ('/me/avatar', authenticate, uploadAvatarMiddleware, updateAvatar);
router.delete('/me/avatar', authenticate, deleteAvatar);
router.put   ('/me/password', authenticate, changePassword);
router.delete('/me',          authenticate, deleteMe);

export default router;
