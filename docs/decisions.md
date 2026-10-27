# Decisions, rules & open questions

Rule: the owner approves every naming, design, feature and stack decision. Claude proposes and the owner decides. Every decision is logged here.

## Rules (approved 2026-10-27)

| # | Rule |
|---|---|
| R1 | **Photos never leave the phone.** There's no server and no analytics. The only network use is downloading the app and the models. The single exception is the weather hint (D25), and only after the user switches it on. |
| R2 | **Nothing personal goes in the public repo.** No real photos of people or their clothes in code, tests, screenshots or issues. Tests and README screenshots use synthetic or public-domain images. |
| R3 | **Everything is free.** No paid services, accounts or fonts. Models and libraries must have permissive licences (MIT, Apache or BSD). For example, BRIA's background-removal models are non-commercial only, so they're out. |
| R4 | **Works offline** after the first launch (and after the models have been downloaded). |
| R5 | **Every AI result is a suggestion the user can edit.** |
| R6 | **Backup and restore** of the whole wardrobe to a file is required, because deleting the home-screen app deletes the data. |
| R7 | **Claude proposes, the owner decides**, and every decision is logged in this file. |
| R8 | The repo uses the **MIT licence**. |

## Decisions

| # | Date | Decision | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | 2026-10-27 | Build as a **PWA** installed from a QR code, for **Android (Chrome)** and the **latest iPhone (Safari, iOS 26+)** | Expo / React Native; Capacitor wrapper for Android | Free on both platforms, and the install never expires. A native iPhone install needs a paid Apple developer account or a 7-day re-sign |
| D2 | 2026-10-27 | Name: **iMannequin** | Garderobe, Hanger, ClosetTwin, Manny, Rail | Owner's choice |
| D3 | 2026-10-27 | **Public** repo `Nik-Kras/iMannequin`, framed professionally like DoseRing and Gym Log (banner, badges, screenshots, install QR). **Anyone** can install it | Private repo | Owner's choice |
| D4 | 2026-10-27 | UI language: **English by default**, with an in-app toggle for **Ukrainian** | English only | Owner's choice |
| D5 | 2026-10-27 | Try-on is a **2D paper doll**: cut-out garments are scaled and placed on the body. **No image-generation models** | Photoreal try-on (IDM-VTON, CatVTON) | Those need a paid server GPU and would send photos off the phone |
| D6 | 2026-10-27 | **The MVP is the full app**, built from scratch, with no phases | Catalogue first, then try-on | Owner: all features are needed for the MVP |
| D7 | 2026-10-27 | Adding an item: the photo sits at the top and a **small form below it is pre-filled by the AI**. The user can change anything, including picking a different category | AI decides silently | Owner's choice; see R5 |
| D8 | 2026-10-27 | Extra features in the MVP: **saved outfits**, **wear log + "not worn in N months" list**, **seasonal swap** (move items between places in bulk), **search by description with small on-device models**, **same-item detection**, **share an outfit as an image**, **weather hint**, **packing lists for trips** | Laundry status; price and cost per wear; "you own something similar" warning | Owner's picks |
| D9 | 2026-10-27 | Same-item detection only flags **the same physical item** photographed again, not merely similar items. The AI checks the match | Similar-item warnings | Owner's choice |
| D10 | 2026-10-27 | Hosting: **GitHub Pages** | Cloudflare Pages (as RHP) | The repo is public, so Pages is free, and there's one account fewer |
| D11 | 2026-10-27 | Stack: **Vite + React + TypeScript + Dexie (IndexedDB) + vite-plugin-pwa**, plus **Transformers.js** for AI models and **MediaPipe** for pose | Preact, Svelte | Same as RHP |
| D12 | 2026-10-27 | **No separate test page beforehand.** Models are chosen by **calibration on the installed app**: the app ships several candidate models per task and lets us switch and compare them, then we pick the defaults | A test page before design | Owner's choice. How the app supports this is in [architecture §5](architecture.md#5-model-lab-calibration) |
| D13 | 2026-10-27 | Mannequin: the user's **real photo, cut out**, by default. A **Settings toggle** shows it as an **outline** instead | Outline only; generic mannequin | Satisfies people with different privacy preferences |
| D14 | 2026-10-27 | **A-pose** (arms about 45° down) for the body photo, and garments are laid out to match | T-pose | Looks natural in outfits, and laid-flat shirts fall that way |
| D15 | 2026-10-27 | Fit: **automatic**, plus **drag handles** to correct it. The correction is **remembered per garment**, so it's done once | Automatic only | Owner's choice |
| D16 | 2026-10-27 | Size: **fit to body**. Each garment's width matches the body and the garment keeps its own proportions, so its length shows correctly | True to size (needs measurements or a reference object) | Simple, and length still shows correctly |
| D17 | 2026-10-27 | Body zones and categories as listed in [PRD §5](../PRD.md#5-body-zones--categories) | n/a | Approved as proposed |
| D18 | 2026-10-27 | The AI suggests **category and colours**, and the user confirms them in the item form | n/a | See D7 |
| D19 | 2026-10-27 | Background removal: the AI cuts the garment out and **the user approves the cut-out**. If they reject it: **try another model**, **retake the photo**, or **fix it by hand with an erase / restore brush** | Retry only | Owner's choice |
| D20 | 2026-10-27 | Adding clothes in bulk: a **camera loop** (snap → next) and a **gallery import**. Both feed a **"To review" inbox** | One at a time | Approved as proposed |
| D21 | 2026-10-27 | Dress-up: tap a body zone and **a row of matching items slides up**. Swiping through it shows each item live on the mannequin, and **See all** opens the full grid | Full-screen list | Approved as proposed |
| D22 | 2026-10-27 | Storage locations: **a simple list of places** you create once and then pick from ("under the bed", "sofa") | Room → spot | Simple |
| D23 | 2026-10-27 | Item fields: photo, category, colours, location, seasons, notes, plus **brand**. **No** size, price or purchase date | Size; price; purchase date | Owner's choice |
| D24 | 2026-10-27 | **No underwear or socks** categories | Include them | Owner: "too much" |
| D25 | 2026-10-27 | The weather hint is **off by default**. Switching it on is the one accepted exception to R1: the app sends a location to the weather service | Always on; drop the feature | Owner's choice |
| D26 | 2026-10-27 | Logo: **an outline of a person as a mannequin, with two pieces of clothing on it** | n/a | Owner's idea |
| D27 | 2026-10-27 | Visual style: **black and white, 2D paper cut-outs on crumpled paper**, with paper cut-out animations | n/a | Owner's idea. The clothes are the only colour on screen |

## Open questions

⭐ = recommended. Questions marked *design* are settled while designing the screens.

| # | Pri | Question | Options (⭐ = recommended) |
|---|---|---|---|
| Q1 | Med | Swimwear and nightwear? | ⭐ **Swimwear in** (useful for packing lists), nightwear out · both out · both in |
| Q2 | Med | Where does the weather hint get the location from? | ⭐ **Phone location rounded to ~10 km**, asked once · a city typed once (only the name is sent) |
| Q3 | High | *design*: tabs and navigation | ⭐ Dress-up · Wardrobe · Outfits · Trips, with **+** and Settings in the header · other layouts compared on the canvas |
| Q4 | Med | *design*: dark mode? | ⭐ **Light only** (white paper) · an inverted "black paper" mode · follow the phone |
| Q5 | Med | *design*: fonts (free only, R3) | Two or three pairs compared on the canvas |
| Q6 | High | Privacy of shared outfit images when the mannequin is a real photo | ⭐ **Share uses the outline by default**, with a switch to include the photo · same as the screen · garments only (flat lay) |
| Q7 | Med | Does an item have a name? | ⭐ **Auto-filled name** ("Navy jeans") the user can edit · no name, show category and colour |
| Q8 | Med | How are shoes photographed? | ⭐ **The pair from the front** at floor level, to match the front-facing mannequin · from the side |
| Q9 | Med | Layer order toggles | ⭐ A **"Tuck in"** toggle for tops and a **"Trousers into boots"** toggle; everything else uses a fixed order ([try-on §6](try-on.md#6-layering)) |
| Q10 | Med | A backup reminder? | ⭐ **Monthly** reminder banner · none |
| Q11 | Low | "Not worn" threshold | ⭐ **6 months** by default, editable in Settings |
| Q12 | Med | Several photos per item? Same-item detection can add a new photo to an existing item | ⭐ **Yes**: one photo is the "try-on" photo and the others are kept as a gallery · one photo only |
| Q13 | Low | Seasons | ⭐ **Spring · Summer · Autumn · Winter**, pick several · warm / cold only |
| Q14 | Med | Packing list shape | ⭐ A trip has a name and dates; you add outfits or single items; the checklist is **grouped by storage location** so packing is one walk round the flat |
| Q15 | Med | Wear log input | ⭐ **"Wearing today"** on Dress-up logs the current outfit, and items can be marked worn on their own |
| Q16 | Low | Install guide | ⭐ Like RHP: when the app is opened in a browser tab, it shows how to add it to the home screen (Safari: Share → Add to Home Screen; Chrome: Install) |
| Q17 | Med | Outline mode: keep the original body photo? | ⭐ **Keep it**, so switching back works, and offer **Delete original photo** in Settings · delete it as soon as outline is chosen |
