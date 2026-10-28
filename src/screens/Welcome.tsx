// F1 step 1: welcome, language and the privacy promise (board Welcome.dc.html).
import '../styles/life.css';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { navigate } from '../app/router';
import { Mannequin } from '../tryon';
import { LIcon } from '../life/ui';
import { switchLanguage } from '../life/lang';
import type { Lang } from '../domain/types';

const EMPTY = { slots: {}, accessories: [], toggles: { tuckIn: false, intoBoots: false } };
const LANGS: { code: Lang; label: string }[] = [{ code: 'en', label: 'English' }, { code: 'uk', label: 'Українська' }];

/** A torn paper edge along the bottom of the black hero. */
function tornPath(): string {
  let d = 'M0 0 L390 0';
  for (let x = 390, i = 0; x > 0; i++) {
    x -= 7 + ((i * 5) % 9);
    d += ` L${Math.max(x, 0)} ${(2 + ((i * 37) % 17) / 2.2).toFixed(1)}`;
  }
  return `${d} Z`;
}
const TORN = tornPath();

export default function Welcome() {
  const { t, lang } = useI18n();
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  // The hero is at most half the screen; the mannequin fits inside it.
  const [dollH] = useState(() => Math.round(Math.min(340, Math.min(432, window.innerHeight * 0.51) - 70)));
  return (
    <div className="welcome">
      <section className="welcome__hero" aria-label="iMannequin">
        <div className="welcome__words">
          <h1 className="welcome__mark">iMannequin</h1>
          <p className="welcome__tagline">{t('onboarding.tagline')}</p>
        </div>
        <div className="welcome__doll">
          <Mannequin draft={EMPTY} height={dollH} mode="outline" />
        </div>
        <svg className="welcome__torn" viewBox="0 0 390 14" preserveAspectRatio="none" aria-hidden="true"><path d={TORN} /></svg>
      </section>

      <div className="welcome__body">
        <div className="stack gap-8" role="group" aria-labelledby="welcome-lang">
          <span id="welcome-lang" className="welcome__label">{t('onboarding.language')}</span>
          <div className="life-bigseg">
            {LANGS.map((l) => (
              <button key={l.code} type="button" lang={l.code} aria-pressed={lang === l.code} onClick={() => void switchLanguage(l.code)}>{l.label}</button>
            ))}
          </div>
        </div>

        <div className="stack gap-12">
          <h2 className="welcome__promise">{t('onboarding.promise')}</h2>
          <ul className="welcome__facts">
            <li><LIcon name="noAccount" />{t('onboarding.fact.account')}</li>
            <li><LIcon name="phoneCheck" />{t('onboarding.fact.server')}</li>
            <li><LIcon name="offline" />{t('onboarding.fact.offline')}</li>
          </ul>
        </div>

        <button type="button" className="btn btn--primary btn--block welcome__cta" onClick={() => navigate('/models?onboarding=1')}>
          {t('action.continue')}<LIcon name="arrow" size={20} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
