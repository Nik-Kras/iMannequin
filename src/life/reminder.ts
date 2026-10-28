// Monthly backup reminder (D41, R6).
export const BACKUP_INTERVAL_MS = 30 * 86_400_000;

/**
 * Show the banner when the wardrobe has at least one item, there was no backup in the last 30 days, and the user
 * hasn't dismissed the banner in the last 30 days.
 */
export function shouldRemindBackup(p: { itemCount: number; lastBackupAt?: number; backupReminderAt?: number; now?: number }): boolean {
  const now = p.now ?? Date.now();
  if (p.itemCount < 1) return false;
  if (p.lastBackupAt !== undefined && now - p.lastBackupAt < BACKUP_INTERVAL_MS) return false;
  if (p.backupReminderAt !== undefined && now - p.backupReminderAt < BACKUP_INTERVAL_MS) return false;
  return true;
}
