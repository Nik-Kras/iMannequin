// Monthly backup reminder (D41, R6).
export const BACKUP_INTERVAL_MS = 30 * 86_400_000;

/** The reminder waits until the wardrobe is worth a copy: this many garments, or a few days after the first one. */
export const REMIND_FROM_ITEMS = 10;
export const REMIND_AFTER_MS = 3 * 86_400_000;

/**
 * Show the banner when the wardrobe has 10 items or its first item is 3 days old (bug-audit #36), there was no
 * backup in the last 30 days, and the user hasn't dismissed the banner in the last 30 days.
 */
export function shouldRemindBackup(p: { itemCount: number; firstItemAt?: number; lastBackupAt?: number; backupReminderAt?: number; now?: number }): boolean {
  const now = p.now ?? Date.now();
  if (p.itemCount < 1) return false;
  if (p.itemCount < REMIND_FROM_ITEMS && (p.firstItemAt === undefined || now - p.firstItemAt < REMIND_AFTER_MS)) return false;
  if (p.lastBackupAt !== undefined && now - p.lastBackupAt < BACKUP_INTERVAL_MS) return false;
  if (p.backupReminderAt !== undefined && now - p.backupReminderAt < BACKUP_INTERVAL_MS) return false;
  return true;
}
