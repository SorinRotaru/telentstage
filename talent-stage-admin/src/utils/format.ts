export function fmt(n: number | string | undefined | null): string {
  return Number(n || 0).toLocaleString();
}

export function fmtDate(s: string | null | undefined): string {
  return s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';
}

export function fmtTime(s: string | null | undefined): string {
  return s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never';
}

export function actionLabel(a: string): string {
  const map: Record<string, string> = {
    login_success: 'Logged in',
    login_failed: 'Failed login',
    video_deleted: 'Deleted video',
    video_visibility_changed: 'Changed visibility',
    user_banned: 'Banned user',
    user_unbanned: 'Unbanned user',
    user_deleted: 'Deleted user',
    user_shadow_banned: 'Shadow banned',
    user_shadow_unbanned: 'Shadow unbanned',
    comment_deleted: 'Deleted comment',
    strike_added: 'Added strike',
    strike_removed: 'Removed strike',
    report_updated: 'Updated report',
    moderator_created: 'Created moderator',
    moderator_deleted: 'Deleted moderator',
    moderator_toggled: 'Toggled moderator',
    moderator_profile_updated: 'Updated profile',
    moderator_password_changed: 'Changed password',
    admin_password_changed: 'Changed own password',
    admin_password_reset: 'Reset password',
    feature_flag_changed: 'Changed flag',
    feature_flag_created: 'Created flag',
    setting_changed: 'Changed setting',
    user_auto_banned_strikes: 'Auto-banned (strikes)',
  };
  return map[a] || a;
}

export function priorityBadgeClass(p: string): string {
  const map: Record<string, string> = { critical: 'badge-red', high: 'badge-orange', medium: 'badge-yellow', low: 'badge-blue' };
  return map[p] || 'badge-blue';
}

export function statusBadgeClass(s: string): string {
  const map: Record<string, string> = { pending: 'badge-yellow', reviewing: 'badge-blue', resolved: 'badge-green', dismissed: 'badge-purple' };
  return map[s] || 'badge-blue';
}
