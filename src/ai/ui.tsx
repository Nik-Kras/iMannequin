// Small UI helpers for the AI screens (ModelDownload, ModelLab): extra icons and localised sizes.
import { useCallback } from 'react';
import type { SVGProps } from 'react';
import { useI18n } from '../i18n';
import { Icon, type IconName } from '../ui/icons';

const EXTRA = {
  tag: 'M3.5 12.5 11 5h7.5v7.5L11 20ZM15 8.5h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  person: 'M12 3.5a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4ZM8 10h8l-1 5h-1.5l-.5 5.5h-2L10.5 15H9ZM8 10l-3 5M16 10l3 5',
  note: 'M6 4h9l3 3v13H6ZM9 10h6M9 13.5h6M9 17h4',
} as const;

export type AiIconName = keyof typeof EXTRA | IconName;

/** The kit's icons plus a few this module needs (same 24 × 24 grid, 1.8 stroke). */
export function AiIcon({ name, size = 24, strokeWidth = 1.8, ...rest }: { name: AiIconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  if (!(name in EXTRA)) return <Icon name={name as IconName} size={size} strokeWidth={strokeWidth} {...rest} />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} {...rest}>
      <path d={EXTRA[name as keyof typeof EXTRA]} />
    </svg>
  );
}

/** Bytes as "109 MB" / "1,4 ГБ" in the app's language. */
export function useSize(): (bytes: number) => string {
  const { t, lang } = useI18n();
  return useCallback((bytes: number) => {
    const mb = bytes / (1024 * 1024);
    const locale = lang === 'uk' ? 'uk-UA' : 'en-GB';
    if (mb >= 1000) return t('ai.gb', { n: (mb / 1024).toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) });
    return t('ai.mb', { n: (bytes > 0 ? Math.max(1, Math.round(mb)) : 0).toLocaleString(locale) });
  }, [t, lang]);
}
