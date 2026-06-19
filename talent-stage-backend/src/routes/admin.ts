import { Router } from 'express';
import { adminAuthenticate, requireModerator, requireSuperAdmin } from '../middleware/adminAuth';
import { uploadAvatarMiddleware } from '../middleware/upload';
import {
  adminLogin,
  adminResetPassword,
  getDashboard,
  getAdminVideos, deleteAdminVideo, toggleVideoVisibility, hideVideoForReview,
  getAdminUsers, getAdminUserProfile, banUser, unbanUser, deleteAdminUser, shadowBanUser,
  getUserStrikes, addUserStrike, removeStrike,
  getAdminComments, deleteAdminComment, getAdminCommentConversation, hideCommentForReview,
  getModerators, createModerator, toggleModerator, deleteModerator, changeModeratorPassword,
  changeMyAdminPassword,
  updateModeratorProfile,
  updateModeratorAvatar,
  getAuditLogs,
  getReports, createReport, updateReport,
  getFeatureFlags, toggleFeatureFlag, createFeatureFlag,
  getSystemSettings, updateSystemSetting,
  getSystemInfo,
  getAnalytics,
} from '../controllers/adminController';

const router = Router();

// Public
router.post('/login', adminLogin);
router.post('/reset-password', adminResetPassword);

// Protected (any admin)
router.get('/dashboard', adminAuthenticate, getDashboard);
router.put('/me/password', adminAuthenticate, requireSuperAdmin, changeMyAdminPassword);

// Videos
router.get   ('/videos',                  adminAuthenticate, getAdminVideos);
router.delete('/videos/:id',              adminAuthenticate, requireModerator, deleteAdminVideo);
router.put   ('/videos/:id/visibility',   adminAuthenticate, toggleVideoVisibility);
router.put   ('/videos/:id/hide-for-review', adminAuthenticate, requireModerator, hideVideoForReview);

// Users
router.get   ('/users',                   adminAuthenticate, getAdminUsers);
router.get   ('/users/:id/profile',       adminAuthenticate, getAdminUserProfile);
router.put   ('/users/:id/ban',           adminAuthenticate, banUser);
router.put   ('/users/:id/unban',         adminAuthenticate, unbanUser);
router.delete('/users/:id',               adminAuthenticate, requireModerator, deleteAdminUser);
router.put   ('/users/:id/shadow-ban',    adminAuthenticate, shadowBanUser);
router.get   ('/users/:id/strikes',       adminAuthenticate, getUserStrikes);
router.post  ('/users/:id/strikes',       adminAuthenticate, addUserStrike);

// Strikes
router.delete('/strikes/:id',             adminAuthenticate, removeStrike);

// Comments
router.get   ('/comments',     adminAuthenticate, getAdminComments);
router.delete('/comments/:id', adminAuthenticate, requireModerator, deleteAdminComment);
router.get   ('/comments/:id/conversation', adminAuthenticate, getAdminCommentConversation);
router.put   ('/comments/:id/hide-for-review', adminAuthenticate, requireModerator, hideCommentForReview);

// Audit Logs
router.get('/audit-logs', adminAuthenticate, getAuditLogs);

// Reports / Moderation Queue
router.get  ('/reports',     adminAuthenticate, getReports);
router.post ('/reports',     adminAuthenticate, createReport);
router.put  ('/reports/:id', adminAuthenticate, updateReport);

// Analytics
router.get('/analytics', adminAuthenticate, getAnalytics);

// System Monitoring (superadmin & moderator)
router.get('/system/info', adminAuthenticate, requireModerator, getSystemInfo);

// Superadmin only
// Moderators
router.get   ('/moderators',                      adminAuthenticate, requireSuperAdmin, getModerators);
router.post  ('/moderators',                      adminAuthenticate, requireSuperAdmin, createModerator);
router.put   ('/moderators/:id/toggle',           adminAuthenticate, requireSuperAdmin, toggleModerator);
router.delete('/moderators/:id',                  adminAuthenticate, requireSuperAdmin, deleteModerator);
router.put   ('/moderators/:id/password',         adminAuthenticate, requireSuperAdmin, changeModeratorPassword);
router.put   ('/moderators/:id/profile',          adminAuthenticate, requireSuperAdmin, updateModeratorProfile);
router.put   ('/moderators/:id/avatar',           adminAuthenticate, requireSuperAdmin, uploadAvatarMiddleware, updateModeratorAvatar);

// Feature Flags
router.get  ('/feature-flags',      adminAuthenticate, requireSuperAdmin, getFeatureFlags);
router.post ('/feature-flags',      adminAuthenticate, requireSuperAdmin, createFeatureFlag);
router.put  ('/feature-flags/:key', adminAuthenticate, requireSuperAdmin, toggleFeatureFlag);

// System Settings
router.get ('/settings',      adminAuthenticate, requireSuperAdmin, getSystemSettings);
router.put ('/settings/:key', adminAuthenticate, requireSuperAdmin, updateSystemSetting);

export default router;
