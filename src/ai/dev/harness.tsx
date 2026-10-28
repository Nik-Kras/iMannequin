// Dev-only harness for the AI module (not part of the build: vite builds index.html only).
// Open /iMannequin/src/ai/dev/harness.html?screen=models|lab|e2e[&lang=uk][&seed]
//  - models / lab: the two AI screens on their own, for screenshots while other screens are in progress.
//  - e2e: downloads the default models, cuts out and classifies synthetic sample garments (R2: drawn,
//    not photographed), and writes the results as JSON into #out for a headless check.
import '../../styles/global.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../i18n';
import { getSettings, updateSettings, db } from '../../data/db';
import { SAMPLES, renderGarmentPng, seedSampleWardrobe } from '../../dev/samples';
import ModelDownload from '../../screens/ModelDownload';
import ModelLab from '../../screens/ModelLab';
import { analyseGarment, cutOutGarment, detectDevice, downloadModel, failedModels, findSameItem, ONBOARDING_MODELS, resetFailures, searchWardrobeDetailed } from '../index';
import type { Lang } from '../../domain/types';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'lab';

/** A synthetic flat-lay photo: the drawn garment on a plain (or busy) background, at phone-photo size. */
async function flatLay(garment: Blob, busy: boolean): Promise<Blob> {
  const W = 1200, H = 1600;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d')!;
  if (busy) {
    for (let y = 0; y < H; y += 40) { ctx.fillStyle = (y / 40) % 2 ? '#8a6a4a' : '#9c7a56'; ctx.fillRect(0, y, W, 40); }
    for (let i = 0; i < 3000; i++) { ctx.fillStyle = `rgba(${60 + (i % 80)},${40 + (i % 50)},20,0.25)`; ctx.fillRect((i * 397) % W, (i * 731) % H, 18, 3); }
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#f1efe9');
    g.addColorStop(1, '#e3e0d8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const bmp = await createImageBitmap(garment);
  const k = Math.min((W * 0.7) / bmp.width, (H * 0.7) / bmp.height);
  const w = bmp.width * k, h = bmp.height * k;
  ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
  // sensor noise
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = ((i * 2654435761) % 7) - 3;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

interface Row { name: string; bg: string; model: string; cutMs: number; size: string; top3: string; expected: string; colours: string; expectedColours: string; seasons: string; anaMs: number; url: string }

let e2eStarted = false; // StrictMode runs effects twice in dev; one run is enough

function E2E() {
  const [rows, setRows] = useState<Row[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [out, setOut] = useState<string>('');
  useEffect(() => {
    if (e2eStarted) return;
    e2eStarted = true;
    void (async () => {
      const say = (s: string) => { console.log('[harness]', s); setLog((l) => [...l, s]); };
      if (params.has('fresh')) resetFailures();
      const result: Record<string, unknown> = { device: await detectDevice(), rows: [] as unknown[] };
      try {
        if (!params.has('offline')) {
          for (const id of ONBOARDING_MODELS) {
            const t0 = performance.now();
            let last = 0;
            await downloadModel(id, (d, tot) => { if (d - last > tot / 10) { last = d; say(`${id} ${Math.round((100 * d) / tot)}%`); } });
            say(`${id} downloaded in ${Math.round(performance.now() - t0)} ms`);
          }
        }
        const picks = (params.get('items') ?? '0,3,5,8,10,12,13,14').split(',').map(Number);
        for (const i of picks) {
          const [kind, color, name, category, colours] = SAMPLES[i];
          const garment = (await renderGarmentPng(kind, color, 640)).blob;
          for (const busy of params.has('busy') ? [false, true] : [false]) {
            const photo = await flatLay(garment, busy);
            say(`${name} (${busy ? 'busy' : 'plain'}): cutting out`);
            let cut, ana;
            try {
              cut = await cutOutGarment(photo);
              say(`${name}: cut by ${cut.model} in ${cut.ms} ms; analysing`);
              ana = await analyseGarment(cut.cutout);
            } catch (err) {
              say(`${name}: FAILED ${String((err as Error)?.stack ?? err).slice(0, 400)}`);
              (result.rows as unknown[]).push({ name, bg: busy ? 'busy' : 'plain', error: String((err as Error)?.message ?? err) });
              continue;
            }
            const t1 = performance.now();
            const row: Row = {
              name, bg: busy ? 'busy' : 'plain', model: cut.model, cutMs: cut.ms, size: `${cut.width}x${cut.height}`,
              top3: ana.categories.map((c) => `${c.id} ${c.score.toFixed(2)}`).join(', '), expected: category,
              colours: ana.colours.join(','), expectedColours: colours.join(','), seasons: ana.seasons.join(','),
              anaMs: Math.round(performance.now() - t1), url: URL.createObjectURL(cut.cutout),
            };
            (result.rows as unknown[]).push({ ...row, url: undefined, embedding: ana.embedding?.length, embeddingModel: ana.embeddingModel });
            setRows((r) => [...r, row]);
            say(`${name} (${row.bg}): ${cut.model} ${cut.ms} ms → ${row.top3}`);
          }
        }
        if (params.has('search')) {
          await seedSampleWardrobe();
          // Give the seeded items embeddings so search can rank with CLIP.
          const items = await db.items.toArray();
          for (const it of items) {
            const p = it.tryOnPhotoId ? await db.photos.get(it.tryOnPhotoId) : undefined;
            if (!p?.cutout || p.embedding) continue;
            const a = await analyseGarment(p.cutout);
            await db.photos.put({ ...p, embedding: a.embedding, embeddingModel: a.embeddingModel });
          }
          const queries = ['something warm for winter', 'red', 'щось тепле на зиму', 'чорні джинси', 'blue striped shirt', 'clothes for the beach'];
          const search: Record<string, string[]> = {};
          for (const q of queries) {
            const r = await searchWardrobeDetailed(q, { llm: 'off' });
            search[q] = r.hits.map((h) => items.find((i) => i.id === h.itemId)?.name ?? h.itemId);
          }
          result.search = search;
          const navy = items.find((i) => i.name === 'Navy sweater')!;
          const p = await db.photos.get(navy.tryOnPhotoId!);
          const again = await analyseGarment(p!.cutout!);
          result.sameItemSelf = await findSameItem(again.embedding!, navy.category);
          const jeans = items.find((i) => i.name === 'Blue jeans')!;
          const pj = await db.photos.get(jeans.tryOnPhotoId!);
          const aj = await analyseGarment(pj!.cutout!);
          result.sameItemExcluded = await findSameItem(aj.embedding!, jeans.category, jeans.id);
        }
      } catch (err) {
        result.error = String((err as Error)?.stack ?? err);
      }
      result.failed = failedModels();
      setOut(JSON.stringify(result, null, 1));
    })();
  }, []);
  return (
    <div style={{ padding: 16, fontSize: 13 }}>
      <h1 className="h2">AI end-to-end</h1>
      {log.map((l, i) => <div key={i}>{l}</div>)}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {rows.map((r, i) => (
          <figure key={i} className="card" style={{ margin: 0, padding: 6, width: 170 }}>
            <img className="cutout" src={r.url} alt={r.name} style={{ width: 150, height: 120, objectFit: 'contain' }} />
            <figcaption>{r.name} · {r.bg} · {r.model}<br />{r.top3}<br />{r.colours} · {r.seasons}</figcaption>
          </figure>
        ))}
      </div>
      <pre id="out" data-done={out ? '1' : undefined} style={{ whiteSpace: 'pre-wrap' }}>{out}</pre>
    </div>
  );
}

async function boot() {
  if (params.has('seed')) await seedSampleWardrobe();
  const lang = (params.get('lang') as Lang | null) ?? (await getSettings()).lang;
  await updateSettings({ lang });
  if (screen === 'models' && !location.hash) location.hash = params.has('onboarding') ? '#/models?onboarding=1' : '#/models';
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nProvider lang={lang}>
        <div className="paper-bg" aria-hidden="true" />
        <div className="app">{screen === 'models' ? <ModelDownload /> : screen === 'e2e' ? <E2E /> : <ModelLab />}</div>
      </I18nProvider>
    </StrictMode>,
  );
}
void boot();
