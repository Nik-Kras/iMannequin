// D41: a small monthly backup reminder, rendered by the shell once onboarded. It sits at the top of the list
// screens and pushes their content down (it never covers the tab bar, the content or the mannequin on Dress-up).
import '../styles/life.css';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, updateSettings } from '../data/db';
import { useSettings } from '../data/repo';
import { useI18n } from '../i18n';
import { navigate, useRoute } from '../app/router';
import { Icon } from '../ui/icons';
import { useAction } from '../ui/action';
import { useActiveCount } from '../life/hooks';
import { shouldRemindBackup } from '../life/reminder';

/** Screens with room for the banner. Dress-up is left alone: every slot must fit on one screen (D31). */
const WHERE = ['/wardrobe', '/outfits', '/trips', '/wear-log'];

export default function BackupReminder() {
  const { t } = useI18n();
  const route = useRoute();
  const settings = useSettings();
  const count = useActiveCount();
  const firstItemAt = useLiveQuery(async () => (await db.items.orderBy('createdAt').first())?.createdAt ?? null, []);
  const dismiss = useAction('backup.dismiss', () => updateSettings({ backupReminderAt: Date.now() }), { errorText: t('state.saveFailed'), retryLabel: t('action.retry') });
  if (!settings || count === undefined || firstItemAt === undefined || !WHERE.includes(route.path)) return null;
  if (!shouldRemindBackup({ itemCount: count, firstItemAt: firstItemAt ?? undefined, lastBackupAt: settings.lastBackupAt, backupReminderAt: settings.backupReminderAt })) return null;
  return (
    <aside className="backup-reminder card" aria-label={t('settings.backup')}>
      <Icon name="download" size={20} />
      <span className="grow">{settings.lastBackupAt ? t('settings.reminderOld') : t('settings.reminderNever')}</span>
      <button type="button" className="backup-reminder__go" onClick={() => navigate('/settings?section=backup')}>{t('settings.reminderAction')}</button>
      <button type="button" className="backup-reminder__x" aria-label={t('settings.reminderDismiss')} onClick={() => void dismiss.run()}>
        <Icon name="close" size={18} />
      </button>
    </aside>
  );
}
