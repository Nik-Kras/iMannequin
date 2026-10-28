// F17 / D47: shown by the shell while the app runs in a phone's browser tab, until dismissed (board InstallGuide.dc.html).
import '../styles/life.css';
import { useState } from 'react';
import { useI18n, type Key } from '../i18n';
import { updateSettings } from '../data/db';
import { useAction } from '../ui/action';
import { LIcon, Rich, type LifeIconName } from '../life/ui';

type Os = 'ios' | 'android';

function guessOs(): Os {
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOS ? 'ios' : 'android';
}

const STEPS: Record<Os, { text: Key; icon?: LifeIconName; label?: Key }[]> = {
  ios: [
    { text: 'onboarding.install.ios1', icon: 'compass' },
    { text: 'onboarding.install.ios2', icon: 'iosShare' },
    { text: 'onboarding.install.ios3', icon: 'addHome' },
    { text: 'onboarding.install.ios4', label: 'onboarding.install.iosAdd' },
  ],
  android: [
    { text: 'onboarding.install.android1', icon: 'globe' },
    { text: 'onboarding.install.android2', icon: 'menu' },
    { text: 'onboarding.install.android3', icon: 'install' },
    { text: 'onboarding.install.android4', label: 'onboarding.install.androidInstall' },
  ],
};

const ICON = `${import.meta.env.BASE_URL}icon-192.png`;

export default function InstallGuide() {
  const { t } = useI18n();
  const [os, setOs] = useState<Os>(guessOs);
  const keep = useAction('install.keep', () => updateSettings({ installGuideDismissed: true }), { errorText: t('state.saveFailed'), retryLabel: t('action.retry') });
  const apps: { label: string; me?: boolean }[] = [
    { label: t('onboarding.install.appPhotos') },
    { label: t('onboarding.install.appNotes') },
    { label: 'iMannequin', me: true },
    { label: t('onboarding.install.appWeather') },
  ];
  return (
    <div className="screen screen--no-tabs install">
      <div className="pad stack gap-16">
        <div className="stack gap-8">
          <h1 className="h1">{t('onboarding.install.title')}</h1>
          <p className="body">{t('onboarding.install.lead')}</p>
        </div>

        <div className="life-bigseg" role="group" aria-label={t('onboarding.install.phone')}>
          <button type="button" aria-pressed={os === 'ios'} onClick={() => setOs('ios')}>{t('onboarding.install.iphone')}</button>
          <button type="button" aria-pressed={os === 'android'} onClick={() => setOs('android')}>{t('onboarding.install.android')}</button>
        </div>

        <ol className="card install__steps" aria-label={t(os === 'ios' ? 'onboarding.install.stepsIos' : 'onboarding.install.stepsAndroid')}>
          {STEPS[os].map((s, i) => (
            <li key={s.text}>
              <span className="install__n" aria-hidden="true">{i + 1}</span>
              <span className="grow"><Rich text={t(s.text)} /></span>
              <span className="install__key" aria-hidden="true">
                {s.icon && <LIcon name={s.icon} />}
                {s.label && t(s.label)}
              </span>
            </li>
          ))}
        </ol>

        <div className="install__home" aria-hidden="true">
          {apps.map((a) => (
            <span key={a.label} className={`install__app${a.me ? ' install__app--me' : ''}`}>
              {a.me ? <img src={ICON} alt="" width={52} height={52} /> : <span className="install__blank" />}
              <span className="install__appname">{a.label}</span>
            </span>
          ))}
        </div>

        <p className="install__after"><LIcon name="phoneCheck" size={24} />{t('onboarding.install.after')}</p>
      </div>

      <div className="pad install__foot">
        <button type="button" className="btn btn--secondary btn--block" disabled={keep.busy} onClick={() => void keep.run()}>
          {t('onboarding.install.keep')}
        </button>
        {/* A tab and the installed app don't share their data (bug-audit #31). */}
        <p className="install__note">{t('onboarding.install.separate')}</p>
      </div>
    </div>
  );
}
