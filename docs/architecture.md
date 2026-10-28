# Architecture

Legend: **Decided** = approved by the owner · **Proposed ⚑** = Claude's recommendation, waiting for approval (see [open questions](decisions.md#open-questions)).

## 1. Platform & hosting (decided)

- **Progressive Web App (PWA)** (D1):
  - **iPhone** (Safari, iOS 26+): Share → *Add to Home Screen*.
  - **Android** (Chrome): *Install app*.
- **No server, no accounts, no analytics** (R1). Technical crash reports go to Sentry (D50, §12).
- **Hosting:** GitHub Pages (D10). The site is built and deployed by a GitHub Actions workflow (`actions/deploy-pages`). The address is `https://nik-kras.github.io/iMannequin/`, so Vite's `base` is `/iMannequin/`.
- The QR code in the README points to that address.

## 2. Tech stack (decided, D11)

| Concern | Choice | Notes |
|---|---|---|
| Build | Vite + TypeScript (strict) | Static output for Pages |
| UI | React | Same as RHP and MacroTrack |
| PWA | `vite-plugin-pwa` (Workbox) | Manifest, service worker, precache |
| Storage | IndexedDB via Dexie | Images stored as Blobs |
| AI models | Transformers.js (ONNX Runtime Web) | WebGPU where available, WebAssembly fallback |
| Pose | MediaPipe Tasks Vision (Pose Landmarker) | 33 body key points + segmentation mask |
| Graphics | Canvas 2D for compositing, SVG for the paper UI | No chart or graphics library needed ⚑ |
| Zip (backup) | `fflate` (MIT) ⚑ | Small and fast |
| i18n | Typed `en` / `uk` dictionaries | Same approach as RHP |
| Crash reports | `@sentry/react` + `@sentry/vite-plugin` (MIT), Sentry free plan | D50, §12. Same setup as RHP |
| Tests | Vitest (pure logic) + Playwright on WebKit and Chromium (UI smoke) + real phones for models | Synthetic fixtures only (R2) |

## 3. Processing model

- AI work runs in a **Web Worker**, so the UI stays smooth. If a library can't run in a worker on a platform, it runs on the main thread between frames ⚑.
- **One model in memory at a time**, released after use. iPhone Safari kills pages that use too much memory.
  - A worker that has run a model on **WebGPU is never terminated**: in WebKit that crashes the page, even after its sessions are disposed. It disposes its model and loads the next one itself. A WebAssembly worker is disposed, then terminated, which is the only way to give its memory back (bug audit #6).
  - The queue works in **batches of up to 10**: every waiting photo is cut out (the cut-out is stored), then all are analysed, so each model loads once per batch. Models are released when the queue is empty (#8).
  - CLIP's text half runs once per phone; its prompt embeddings are cached (#8).
  - The search language model runs only when the user taps "Search smarter", only on WebGPU, and is released right after (D56).
- A **processing queue** in IndexedDB survives the app being closed. A photo's bytes are written once, to their own table, and never rewritten: WebKit can lose a Blob when the record that holds it is rewritten (bug audit #1). Every write that rewrites a Blob-holding record copies its Blobs into memory first (`withFreshBlobs`). iPhone suspends web apps in the background, so the queue resumes when the app is opened and shows "N left".
- Image sizes ⚑:
  - originals downscaled to a 2048 px long edge (JPEG)
  - cut-outs at 1024 px (PNG with transparency)
  - thumbnails at 256 px

## 4. AI pipeline

Every model is chosen by calibration (D12). The candidates below are what the Model lab compares. **Each licence is checked against the model card before the model is added** (R3).

| Task | Used for | Candidates ⚑ | Fallback |
|---|---|---|---|
| Garment background removal | F2, F4 | **ORMBG, the default** (Apache-2.0, `onnx-community/ormbg-ONNX`, IS-Net architecture, 84 / 168 MB; D51), BiRefNet-lite (MIT, `onnx-community/BiRefNet_lite-ONNX`, 109 MB WebGPU / 214 MB WASM; grew to about 4 GB on WebGPU in the bug audit). On GPUs that allow only 10 storage buffers per shader (desktop Chrome), BiRefNet-lite can't run, and the app falls back to ORMBG | **Plain-background fast path in code:** sample the border colour and flood-fill by colour distance. Used when the background is clean, and as a quick preview |
| Body cut-out | F1 | MediaPipe Pose Landmarker segmentation mask (Apache-2.0), MediaPipe multiclass selfie segmenter (Apache-2.0), BiRefNet (MIT) | Retake guide |
| Body key points | F1, try-on | MediaPipe Pose Landmarker lite / full / heavy (Apache-2.0) | Drag the key points by hand on the Check screen |
| Category, seasons | F3 | Zero-shot image–text models: CLIP ViT-B/32 (MIT, `Xenova/clip-vit-base-patch32`, 122 / 149 MB, default), FashionCLIP (MIT, `rshelby17/fashion-clip-onnx`, 228 MB) | The user picks |
| Colours | F3 | **Plain code:** cluster the cut-out's pixels (k-means) and map them to a named palette | n/a |
| Same-item detection | F11 | Image embeddings from the classifier model. Cosine similarity within the same zone, then a stricter second check (colour histogram + a high threshold set during calibration) | The user decides |
| Search by description | F5 | The query text and the item photos are compared with the same image–text model. A **small on-device language model** turns a free-form query into filters ("warm", "winter", "in the sofa"): Qwen3-1.7B (Apache-2.0, default candidate), Qwen2.5-1.5B-Instruct (Apache-2.0), Qwen3-0.6B (Apache-2.0, light fallback); loaded only when a query needs it, after plain keyword filters (D32). Optional item descriptions from a small vision-language model: Florence-2 base (MIT), SmolVLM-256M (Apache-2.0) | Plain filters |

**Excluded:** BRIA RMBG models (non-commercial licence); `onnx-community/ISNet-ONNX` (AGPL-3.0 on the Hub); U²-Net (no web-ready conversion); Llama and Gemma models (their licences aren't MIT/Apache/BSD); Qwen2.5-3B (Qwen licence, not Apache).

**Search model sizes:** Qwen3-1.7B 1.34 GB (WebGPU) / 2.0 GB (WASM), Qwen2.5-1.5B 1.14 / 1.67 GB, Qwen3-0.6B 552 / 885 MB. Florence-2 base: 215 / 265 MB. Pose: MediaPipe lite 5.5 MB and full 9 MB, self-hosted in `public/models/`.

### 4.1 Classification details ⚑
- **Prompts:** one English prompt per category ("a photo of a pair of jeans"). The text embeddings are computed once and cached, so classifying a photo needs only the image encoder.
- **Output:** the top-3 categories with their scores. The best one pre-fills the form, and the other two show as quick-pick chips.
- **Seasons:** suggested from the category and the zero-shot prompts ("a warm winter coat" vs "a light summer top"), then editable.
- **Name:** category + main colour ("Navy jeans"); see Q7.

## 5. Model lab (calibration)

Calibration happens on the installed app, on real phones (D12). Settings → Models → **Model lab**:
- For each task, a list of candidate models with their size, licence and download state. **Pick one as the default.**
- **Compare:**
  - **Garment cut-out:** run every downloaded candidate on the same photo and show the results side by side with timings.
  - **Category:** show each model's top-3 for the same photo.
- **Benchmark:** run a model over the whole wardrobe (or a chosen set) and record the time per photo and how often the user had to change the result. The results are kept on the phone.
- **Export results:** a small JSON file with timings and accuracy. It has **no photos** (R1), so it can be shared and used to pick the shipped defaults.
- Models are downloaded on demand and can be deleted to free space.

## 6. Model delivery & offline

- Transformers.js models download from the **Hugging Face Hub** the first time they're used and are cached by the browser. Small MediaPipe models (a few MB) are **self-hosted** in the repo under `public/models/`.
- Workbox runtime caching keeps models and WebAssembly files available offline (R4).
- Onboarding downloads the default set once, with a progress bar and the total size.
- **App updates:** the new version downloads in the background, and a banner says "Update ready, tap to reload".

## 7. Data model ⚑

```ts
Body       { id, photo: Blob, cutout: Blob, mask: Blob,
             landmarks: { x, y, z, visibility }[33],          // canonical canvas coordinates
             canonical: { width, height, transform },          // photo → canonical canvas
             createdAt }
Item       { id, name, category: CategoryId, zone: Zone, layer?: Layer,
             colours: ColourName[], seasons: Season[], locationId?, brand?, notes?,
             tryOnPhotoId, status: 'review' | 'active' | 'archived',
             fit?: FitAdjustment,                               // remembered handles (try-on §5)
             createdAt, updatedAt }
Photo      { id, itemId, original: Blob, cutout: Blob, thumb: Blob,
             cutoutModel: string, cutoutApproved: boolean,
             anchors: GarmentAnchors,                           // detected from the cut-out (try-on §3)
             embedding: Float32Array, embeddingModel: string }
Location   { id, name, order }
Outfit     { id, name, slots: Partial<Record<Slot, itemId>>, accessories: itemId[],
             toggles: { tuckIn: boolean, intoBoots: boolean }, createdAt }
WearEntry  { id, date: 'YYYY-MM-DD', outfitId?, itemIds: string[] }
Trip       { id, name, start, end, entries: { itemId | outfitId, packed: boolean }[], archived }
QueueJob   { id, kind: 'garment', state, error?, errorCode?, itemId?, cut?, createdAt }   // database v3
QueuePhoto { jobId, blob: Blob, preview: Blob }               // written once (bug audit #1)
QueueCut   { jobId, cutout: Blob, width, height }            // the cut-out between the two batch passes
Settings   { lang: 'en' | 'uk', mannequin: 'photo' | 'outline',
             weather: { enabled: boolean, lat?, lon? },
             models: Record<Task, ModelId>, notWornMonths: number, lastBackupAt? }
CalibrationRun { id, task, modelId, photos: number, msPerPhoto, editedRate, device, createdAt }
```

- Garment fits are stored **relative to the body's key points**, not in pixels, so they survive a retaken body photo.
- Embeddings record which model made them. Switching the classifier model re-embeds the wardrobe in the queue.

## 8. Storage durability & backup

- Call `navigator.storage.persist()` on first run. Settings shows usage from `navigator.storage.estimate()`.
- WebKit can still evict data from a site that hasn't been used for a while, or when the phone is short of space. Deleting the home-screen app deletes the data. That's why backup is required (R6).
- **Backup file** ⚑: a `.imannequin` zip holding:
  - `manifest.json` (all records, with a format version)
  - `images/` (originals, cut-outs and the body photo)

  It's exported through the Web Share API (Files / Drive) or as a download, and restored with a file picker.
- An image this phone can no longer read is **left out instead of failing the backup**, and Settings says how many photos were left out. Export gathers the zip in 16 MB parts; restore reads images as slices of the file (bug audit #5).
- Restore keeps **this phone's** crash-report choice, weather location and models, and clears the queue and the anchors cache. The queue isn't part of the backup, so database v3 kept backup format version 1.

## 9. Network & privacy

| Request | When | What leaves the phone |
|---|---|---|
| App files (GitHub Pages) | Install and updates | Nothing personal |
| Models (Hugging Face Hub, self-hosted MediaPipe) | First use of each model | Nothing personal |
| Weather (Open-Meteo) | **Only when the user switches the weather hint on** (D25) | A location rounded to about 10 km (Q2) |
| Crash reports (Sentry, EU) | When something fails, while Settings → Crash reports is on (default, D50) | Technical data only (§12) |

There are no analytics and no fonts from a CDN.

## 10. Testing

- **Unit (Vitest):**
  - fit maths
  - anchor detection on synthetic masks
  - colour naming
  - category → zone and layer mapping
  - layering rules
  - backup round-trip
  - i18n key parity between `en` and `uk`
- **UI smoke (Playwright, WebKit + Chromium):** add an item from a fixture photo, put it on the mannequin, save an outfit, back up and restore. Model calls are stubbed.
- **Fixtures:** synthetic or public-domain images only, with their licences recorded next to them (R2). No real body or wardrobe photos.
- **Real phones:** model quality and speed through the Model lab (D12).

## 11. Repo layout ⚑

```
PRD.md · README.md · CLAUDE.md · LICENSE
docs/            decisions.md · architecture.md · try-on.md · design.md
src/
  app/           routing, tabs, theme, i18n provider
  screens/       DressUp, Wardrobe, ItemForm, Review, Outfits, Trips, Locations, Settings, ModelLab, Onboarding
  ui/            paper components (cards, sheets, buttons, carousel), icons
  tryon/         landmarks, anchors, fit, layering, compositor (pure + canvas)
  ai/            worker, model registry, cutout, classify, embed, search, pose
  data/          db.ts (Dexie), repositories, backup
  i18n/          en.ts, uk.ts, format.ts
public/          icons, manifest, models/ (small MediaPipe files)
tests/           unit/, e2e/, fixtures/ (synthetic only)
```

## 12. Diagnostics (D50)

Set up like RHP, in `src/diag/`.

- **Black box** (`blackbox.ts`, always on, stays on the phone): a short log of technical steps in `localStorage` (route, AI job, model, download, body-photo step, errors). Risky work (a model run, pose detection, body-photo processing) is wrapped in `risky()`. iPhone Safari kills a tab that runs out of memory without any error reaching the code, so a session that ended inside a risky step is reported on the next launch as "App was killed during …", with its log.
- **Sentry** (`diagnostics.ts`, `@sentry/react`, project `imannequin` in the owner's EU org): unhandled errors, React render errors (React 19 error hooks in `main.tsx`, plus a last-resort error screen), errors passed to `reportError(err, where)`, and page-load / download traces. Starts 1.5 s after launch, only when Settings → Crash reports is on (the default). Playwright sessions don't report.
- **Never sent:** photos, cut-outs, garment names, brands, places, notes, search text, the weather location (URL queries are stripped from breadcrumbs, spans and events), click text (no DOM breadcrumbs), session replays, the IP (`ip_address: null`). The user id is a random 4-letter install code; Settings shows the report code (`install-session`) so a report can be found.
- **Check the setup:** open the app with `#sentry-test` and it throws one real error.
- **Source maps:** uploaded by `@sentry/vite-plugin` when `SENTRY_AUTH_TOKEN` is set (the repo's Actions secret in CI, or a git-ignored `.env.sentry-build-plugin` locally), then deleted from `dist/` so they're never served. The DSN is public by design and lives in the committed `.env.production`.

