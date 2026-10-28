// F12: share an outfit as an image (board SharePreview.dc.html). Shares the Dress-up draft, or ?outfit=<id>.
// The card shows the outline by default; the body photo goes in only when the user switches it on (D37).
import '../styles/life.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRoute } from '../app/router';
import { db } from '../data/db';
import { useSettings } from '../data/repo';
import { useI18n } from '../i18n';
import { Header, Switch, Toast, useBlobUrl } from '../ui/parts';
import { Icon } from '../ui/icons';
import { useById, useOutfits } from '../life/hooks';
import { draftFromOutfit } from '../life/wardrobe';
import { drawShareCard } from '../life/shareCard';
import { downloadBlob, shareFile } from '../life/ui';

/** Whether this browser can hand an image to the share sheet (on iPhone it has "Save Image"). */
function canShareImages(): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    return !!nav.share && !!nav.canShare?.({ files: [new File([new Uint8Array(1)], 'card.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

export default function ShareOutfit() {
  const { t, date } = useI18n();
  const route = useRoute();
  const settings = useSettings();
  const outfits = useOutfits();
  const byId = useById(outfits);
  const outfitParam = route.query.get('outfit') ?? undefined;
  const fromOutfit = outfitParam ? byId.get(outfitParam) : undefined;
  const draft = fromOutfit ? draftFromOutfit(fromOutfit) : settings?.draft;
  const name = fromOutfit?.name ?? (draft?.outfitId ? byId.get(draft.outfitId)?.name : undefined);
  // The body photo can go on the card only when there is one (bug-audit #35).
  const body = useLiveQuery(async () => (await db.body.get('current')) ?? null, []);
  const hasBody = !!body?.cutout?.size;
  const [wantPhoto, setPhoto] = useState(false);
  const photo = wantPhoto && hasBody;
  const [shareSheet] = useState(canShareImages);
  const [card, setCard] = useState<{ blob: Blob; mannequin: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState<string>();
  const clearToast = useCallback(() => setToast(undefined), []);
  const url = useBlobUrl(card?.blob);
  const ready = !!settings && outfits !== undefined;
  const empty = !!draft && !Object.values(draft.slots).some(Boolean) && draft.accessories.length === 0;
  const today = date(new Date(), { day: 'numeric', month: 'short', year: 'numeric' });
  const key = useMemo(() => JSON.stringify([draft?.slots, draft?.accessories, draft?.toggles, name, photo, today]), [draft, name, photo, today]);

  useEffect(() => {
    if (!ready || !draft || empty) return;
    let live = true;
    setFailed(false);
    drawShareCard({ draft, mode: photo ? 'photo' : 'outline', name, dateLabel: today })
      .then((c) => {
        if (!live) return;
        // A card without the mannequin isn't worth sharing.
        setCard(c.mannequin ? c : null);
        setFailed(!c.mannequin);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // `key` covers every input of the drawing.
  }, [key, ready, empty]);

  const fileName = `imannequin-${(name ?? 'outfit').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'outfit'}.png`;
  // Only a download can be confirmed: what happens in the share sheet is the user's choice (bug-audit #30).
  const download = () => {
    if (!card) return;
    downloadBlob(card.blob, fileName);
    setToast(t('outfits.share.downloadedToast'));
  };
  const share = async () => {
    if (!card) return;
    const r = await shareFile(new File([card.blob], fileName, { type: 'image/png' }), name);
    if (r === 'unsupported' || r === 'blocked') download();
  };

  const back = fromOutfit ? { to: '/outfits', label: t('tab.outfits') } : { to: '/dressup', label: t('tab.dressup') };

  return (
    <div className="screen screen--no-tabs share">
      <Header back={back.to} backLabel={back.label} title={t('outfits.share.title')} />

      <figure className="share__card" aria-label={t('outfits.share.preview')}>
        {empty ? (
          <figcaption className="share__msg">{t('outfits.share.empty')}</figcaption>
        ) : url ? (
          <img src={url} alt={name ?? t('outfits.share.preview')} />
        ) : (
          <figcaption className="share__msg">{failed ? t('outfits.share.failed') : <><span className="spinner share__spin" aria-hidden="true" />{t('outfits.share.drawing')}</>}</figcaption>
        )}
      </figure>

      <section className="card card--pad share__privacy" aria-label={hasBody ? t('outfits.share.includePhoto') : undefined}>
        {hasBody && <Switch checked={photo} onChange={setPhoto} label={<span className="grow share__switch-label">{t('outfits.share.includePhoto')}</span>} />}
        <p className="share__note"><Icon name="lock" size={18} />{photo ? t('outfits.share.photoNote') : t('outfits.share.outlineNote')}</p>
      </section>

      <div className="pad share__actions">
        <button type="button" className="btn btn--primary btn--block" disabled={!card || empty} onClick={() => void share()}>
          <Icon name="share" size={20} />{t('outfits.share.shareImage')}
        </button>
        {/* On iPhone the share sheet's "Save Image" is the way into Photos; elsewhere it's a download. */}
        <button type="button" className="text-action share__save" disabled={!card || empty} onClick={shareSheet ? () => void share() : download}>
          {shareSheet ? t('outfits.share.save') : t('outfits.share.download')}
        </button>
      </div>
      {toast && <Toast onDone={clearToast}>{toast}</Toast>}
    </div>
  );
}
