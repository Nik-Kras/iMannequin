// F8: saved outfits on the mannequin, with the "not worn in N months" strip (board Outfits.dc.html).
import '../styles/life.css';
import { useCallback, useMemo, useState } from 'react';
import { db } from '../data/db';
import { setDraft, useActiveItems, useSettings } from '../data/repo';
import { useI18n } from '../i18n';
import { navigate } from '../app/router';
import { Empty, Sheet, Toast } from '../ui/parts';
import { Icon } from '../ui/icons';
import type { Outfit } from '../domain/types';
import { useOutfits, useWear } from '../life/hooks';
import { outfitWearStats, parseISO } from '../life/calendar';
import { OutfitsHeader, sinceLabel } from '../life/outfits';
import { draftFromOutfit, notWornItems } from '../life/wardrobe';
import { withoutOutfit } from '../life/trips';
import { ConfirmSheet, LIcon, MiniMannequin, PieceImg, SheetHead } from '../life/ui';

const TILTS = [-0.6, 0.5, 0.4, -0.5];

/** Deletes an outfit and takes it out of trips and the current draft. Wear history stays. */
async function deleteOutfit(o: Outfit): Promise<void> {
  await db.transaction('rw', [db.outfits, db.trips, db.settings], async () => {
    const outfits = new Map((await db.outfits.toArray()).map((x) => [x.id, x]));
    for (const trip of await db.trips.toArray()) {
      if (trip.entries.some((e) => e.kind === 'outfit' && e.refId === o.id)) await db.trips.put(withoutOutfit(trip, o.id, outfits));
    }
    await db.outfits.delete(o.id);
    const s = await db.settings.get('app');
    if (s?.draft.outfitId === o.id) await db.settings.put({ ...s, draft: { ...s.draft, outfitId: undefined } });
  });
}

export default function Outfits() {
  const { t, tn, date, lang } = useI18n();
  const settings = useSettings();
  const outfits = useOutfits();
  const wear = useWear();
  const items = useActiveItems();
  const [menu, setMenu] = useState<Outfit>();
  const [toast, setToast] = useState<string>();
  const stats = useMemo(() => outfitWearStats(wear ?? []), [wear]);
  const months = settings?.notWornMonths ?? 6;
  const stale = useMemo(() => notWornItems(items ?? [], months), [items, months]);
  const clearToast = useCallback(() => setToast(undefined), []);

  const open = async (o: Outfit) => {
    await setDraft(draftFromOutfit(o));
    navigate('/dressup');
  };

  const wornLine = (o: Outfit) => {
    const s = stats.get(o.id);
    if (!s) return t('outfits.notWornYet');
    return `${tn('outfits.worn', s.count)} · ${t('outfits.lastWorn', { date: date(parseISO(s.last)) })}`;
  };

  return (
    <div className="screen">
      <div className="stack gap-16">
        <OutfitsHeader view="saved" />

        {outfits && outfits.length === 0 && (
          <Empty icon="outfits" action={<button type="button" className="btn btn--primary" onClick={() => navigate('/dressup')}>{t('outfits.goDressup')}</button>}>
            {t('outfits.empty')}
          </Empty>
        )}

        {!!outfits?.length && (
          <ul className="outfit-grid">
            {outfits.map((o, i) => (
              <li key={o.id} className="outfit-card card" style={{ transform: `rotate(${TILTS[i % 4]}deg)` }}>
                <button type="button" className="outfit-card__open" aria-label={t('outfits.open', { name: o.name })} onClick={() => void open(o)}>
                  <span className="outfit-card__doll"><MiniMannequin draft={draftFromOutfit(o)} height={160} /></span>
                  <span className="outfit-card__worn">{wornLine(o)}</span>
                </button>
                <span className="outfit-card__tag" aria-hidden="true">{o.name}</span>
                <button type="button" className="outfit-card__more" aria-label={t('outfits.more', { name: o.name })} onClick={() => setMenu(o)}>
                  <LIcon name="dots" size={20} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {stale.length > 0 && (
          <section className="stack gap-8" aria-labelledby="stale-h">
            <div className="outfits__stale-head">
              <h2 id="stale-h" className="title-card">{tn('outfits.notWorn', months)}</h2>
              <a className="text-action" href="#/wardrobe?notWorn=1" onClick={(e) => { e.preventDefault(); navigate('/wardrobe?notWorn=1'); }}>
                {t('outfits.seeAll', { n: stale.length })}
              </a>
            </div>
            <ul className="hscroll stale-row">
              {stale.slice(0, 12).map((it) => (
                <li key={it.id}>
                  <a className="stale-card card" href={`#/item/${it.id}`} onClick={(e) => { e.preventDefault(); navigate(`/item/${it.id}`); }}>
                    <span className="stale-card__well inset"><PieceImg item={it} size={44} /></span>
                    <span className="sr-only">{it.name}</span>
                    <span className="stale-card__when">{sinceLabel(it, t, lang)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {menu && <OutfitSheet outfit={menu} onClose={() => setMenu(undefined)} onDeleted={() => { setMenu(undefined); setToast(t('outfits.deleted')); }} />}
      {toast && <Toast onDone={clearToast}>{toast}</Toast>}
    </div>
  );
}

function OutfitSheet({ outfit, onClose, onDeleted }: { outfit: Outfit; onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(outfit.name);
  const [confirm, setConfirm] = useState(false);
  const trimmed = name.trim();
  const save = async () => {
    if (trimmed && trimmed !== outfit.name) await db.outfits.update(outfit.id, { name: trimmed, updatedAt: Date.now() });
    onClose();
  };
  if (confirm) {
    return (
      <ConfirmSheet title={t('outfits.delete')} text={t('outfits.deleteConfirm', { name: outfit.name })} confirm={t('action.delete')} danger
        onClose={() => setConfirm(false)} onConfirm={() => void deleteOutfit(outfit).then(onDeleted)} />
    );
  }
  return (
    <Sheet onClose={onClose} label={outfit.name}>
      <form className="life-sheet" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <SheetHead title={outfit.name} onClose={onClose} />
        <label className="field">
          <span className="field__label">{t('outfits.name')}</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} enterKeyHint="done" />
        </label>
        <button type="submit" className="btn btn--primary btn--block" disabled={!trimmed}>{t('action.save')}</button>
        <div className="life-pair">
          <button type="button" className="btn btn--secondary" onClick={() => navigate(`/share?outfit=${outfit.id}`)}>
            <Icon name="share" size={20} />{t('outfits.share')}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={20} />{t('action.delete')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
