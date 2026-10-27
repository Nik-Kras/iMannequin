# iMannequin: Product Requirements

Status: **decisions recorded, design not started** · Last updated: 2026-10-27

Related docs:
- [Decisions, rules & open questions](docs/decisions.md) (source of truth for every decision)
- [Architecture](docs/architecture.md)
- [Mannequin & try-on](docs/try-on.md)
- [Design direction](docs/design.md)

## 1. Summary

iMannequin puts your wardrobe on a paper mannequin of yourself. You take one photo of yourself in an A-pose, and that photo becomes the mannequin. Then you photograph your clothes one by one on a plain background. On-device AI cuts each garment out, suggests its category, colours and seasons, and you confirm. Tap any part of the mannequin, such as the torso, and a row of everything you own for that part slides up. Swipe through it to see each piece on yourself, layer pieces into an outfit and save it.

It's also a catalogue of what you own and **where it's stored** ("under the bed", "in the sofa"). Search it by description, see what you haven't worn for months, move a season's clothes into storage in one go, and build packing lists for trips.

It's free, installs from a QR code on Android and iPhone, and runs entirely on the phone. Photos never leave it.

## 2. Users

- Anyone with a recent Android phone (Chrome) or the latest iPhone (Safari, iOS 26+).
- The UI is in English by default, with an in-app toggle for Ukrainian (D4).
- One wardrobe per phone. There are no accounts and no sync.

## 3. Constraints

| Constraint | Decision |
|---|---|
| Cost | Free. No paid services, accounts or fonts (R3). |
| Install | A PWA from a QR code: Add to Home Screen on iPhone, Install in Chrome on Android (D1). |
| Hosting | GitHub Pages from the public repo `Nik-Kras/iMannequin` (D10). |
| Privacy | Photos never leave the phone. No server, no analytics. The only network use is downloading the app and the models, plus the weather hint if the user switches it on (R1, D25). |
| AI | Runs on the phone. Every result is an editable suggestion (R5). No image-generation models (D5). |
| Offline | Everything works offline after the first launch and the model download (R4). |
| Licences | Repo is MIT. Every model and library has a permissive licence (R3, R8). |

## 4. Features (all in the MVP, D6)

### F1. Onboarding and the body photo
1. Welcome, language (English / Українська) and a short privacy promise: "Your photos never leave this phone."
2. **Model download**, with the total size shown and a Wi-Fi recommendation.
3. **Body photo guide:** A-pose (arms about 45° down, feet hip-width apart), fitted clothing or swimwear, a plain wall, good light, head to toe in frame, phone at waist height. Take it with a timer or import it from the gallery.
4. The app finds the body's key points and cuts the body out. If the pose doesn't work (arms too low, feet cut off, turned sideways), it says what to fix.
5. **Check:** the cut-out with its key points drawn over it. Accept, or retake.
- The body photo can be retaken at any time from Settings. Garment fits are stored relative to the body's key points, so every garment refits automatically ([try-on §5](docs/try-on.md#5-remembered-adjustments)).

### F2. Adding clothes
- **Camera loop:** snap → next → snap. Each photo joins a processing queue and the camera stays open (D20).
- **Gallery import:** pick many photos at once.
- **Capture guide:** lay the garment flat on a plain background that contrasts with it, shoot from straight above with the whole item in frame. Tops: sleeves at about 45°, to match the A-pose (D14). Trousers: legs slightly apart. Shoes: see Q8.
- Processing runs on the phone: background removal → category, colours and seasons → same-item check. iPhone pauses web apps in the background, so the queue only runs while the app is open, and it shows how many photos are left.
- Processed items land in the **To review** inbox, with a badge count.

### F3. Item form (review and edit)
- The **photo sits at the top**. It shows the cut-out, which the user approves with **Looks good** or rejects with **Fix** (F4).
- Below it is a **small form pre-filled by the AI** (D7, D18):
  - Name (Q7)
  - Category (which also sets the body zone and layer)
  - Colours (one or more, from a named palette)
  - Seasons (Q13)
  - Location (pick from the list or add a new place)
  - Brand (suggested from brands already used)
  - Notes
- Every field is editable, including picking a different category (R5).
- **Save** moves the item from To review into the wardrobe.
- The same form edits any existing item. It also shows the item's wear history and an **Adjust fit** button (F7).

### F4. Fixing a cut-out (D19)
- **Try another model:** reruns background removal with the next candidate model and shows the results side by side.
- **Retake** the photo.
- **Brush:** erase and restore by hand, with pinch-to-zoom and an adjustable brush size.

### F5. Wardrobe
- A grid of cut-outs on paper cards.
- Filters: body zone / category, colour, season, location.
- **Search by description**, for example "blue striped shirt" or "something warm for winter", using small on-device models (D8; [architecture §4](docs/architecture.md#4-ai-pipeline)).
- The **To review** inbox sits at the top while it has items.
- **Not worn in 6 months** (Q11) is a filter preset, to help decluttering.

### F6. Dress-up
- The mannequin fills the screen. Tappable zones: **head, neck, torso, hands, legs, feet**. **Accessories** (bags, belts, glasses, jewellery) are side buttons (D17).
- Tapping a zone **slides up a row of matching items**. Swiping through it puts each item on the mannequin live, and **See all** opens the full grid (D21). The torso row has **Base · Middle · Outer** layer tabs.
- **Choosing a full-body item** (dress, jumpsuit) **clears** the base top and the legs, and the other way round.
- **Tuck in** and **Trousers into boots** toggles (Q9).
- Actions: **Save outfit**, **Wearing today** (F9), **Share** (F12), **Adjust fit** for the selected item (F7).
- With the weather hint on, a weather chip shows today's forecast (F13).

### F7. Fit adjustment (D15)
- The selected garment shows **drag handles** on its anchor points, such as the shoulders and hem for a top. You can also move, scale and rotate it as a whole.
- **The adjustment is saved for that garment** and used every time it's worn, in every outfit.
- **Reset to automatic** undoes it.

### F8. Outfits
- A grid of saved outfits, drawn on the mannequin.
- Open one to put it on the mannequin, rename it or delete it.

### F9. Wear log
- **Wearing today** logs the current outfit. Items can also be marked worn on their own (Q15).
- An item's form shows when it was last worn and how often.
- The **Not worn in N months** list (F5) uses this log.

### F10. Locations and seasonal swap
- A list of places you create once, which can be renamed and reordered (D22).
- Each place shows what it holds.
- **Seasonal swap:** select items (or filter, e.g. "Summer"), then **Move to…** a place, all at once.

### F11. Same-item detection (D9)
- When a new photo looks like **the same physical item** as one already in the wardrobe, the form shows: "Looks like *Navy jeans* you already have."
- **Same item** adds the photo to that item (Q12). **Different item** keeps it separate.
- Only real matches of the same item are flagged, not merely similar clothes.

### F12. Share an outfit
- Renders the outfit on the mannequin as an image in the paper style and opens the phone's share sheet.
- If the mannequin is a real photo, the shared image uses the outline by default (Q6).

### F13. Weather hint (D25)
- **Off by default.** When it's switched on, Settings explains that a location goes to the free Open-Meteo weather service, and that this is the only data that leaves the phone (Q2).
- Dress-up shows today's temperature and rain, and the wardrobe can be filtered to clothes for the current season.

### F14. Packing lists
- A trip has a name and dates. You add outfits or single items (Q14).
- The checklist is **grouped by storage location**, and each item is ticked when packed.
- A finished trip can be archived.

### F15. Settings
- Language: English / Українська.
- Mannequin: **Photo / Outline** (D13), **Retake body photo**, **Delete original photo** (Q17).
- Weather hint on or off (D25).
- **Models** ([architecture §5](docs/architecture.md#5-model-lab-calibration)): the chosen model per task, the downloaded size, and the Model lab.
- **Backup and restore** (F16).
- Storage used, and a request for persistent storage.
- Locations, the not-worn threshold, and About & licences.

### F16. Backup and restore (R6)
- **Export** writes one file with all data and photos. It's saved through the share sheet, for example to iCloud Drive or Google Drive.
- **Restore** reads that file back, replacing the current wardrobe after a confirmation.
- The export screen warns that the file contains the body photo.
- Reminder: Q10.

### F17. Install and offline
- When opened in a browser tab, the app shows how to install it (Q16).
- After installation and the model download, everything works offline except the weather hint.
- When an update is ready, a small "Update ready, tap to reload" banner appears.

## 5. Body zones & categories

Approved on 2026-10-27 (D17); underwear and socks are excluded (D24).

| Zone | Layer | Categories |
|---|---|---|
| Head | n/a | hats, caps |
| Neck | n/a | scarves, ties |
| Torso | Base | T-shirts, tops, shirts, blouses |
| Torso | Middle | sweaters, hoodies, cardigans |
| Torso | Outer | jackets, coats, blazers |
| Full body (torso + legs) | Base | dresses, jumpsuits |
| Legs | n/a | trousers, jeans, shorts, skirts, leggings |
| Feet | n/a | shoes, boots, sneakers, sandals |
| Hands | n/a | gloves |
| Accessories (side buttons) | n/a | bags, belts, glasses, jewellery |

Swimwear and nightwear: Q1.

## 6. Non-goals (MVP)

- Photoreal try-on or any image-generation model (D5).
- Accounts, cloud sync, or sharing a wardrobe between phones.
- Underwear and socks (D24).
- Size, price and purchase-date fields; cost per wear (D23).
- Laundry status.
- True-to-size fitting (D16).
- Shopping, store links, or outfit recommendations from outside sources.

## 7. Success criteria

The numbers are targets. Model calibration on real phones (D12) decides whether they're met.

- A clean garment photo is cut out and classified in **under 10 s** on a recent phone.
- The AI's category is right **at least 8 times in 10** for clear flat-lay photos. It's always editable.
- Swiping through the row updates the mannequin **instantly** (under 100 ms).
- An automatic fit looks right without handles for **most** tops and bottoms photographed by the guide.
- Adding an item, from the shutter to saved after a quick review, takes **under 30 s**.
- Nothing but the app, the models and (if switched on) the weather request goes over the network.

## 8. Open questions

See [docs/decisions.md → Open questions](docs/decisions.md#open-questions). That list is the single source of truth.
