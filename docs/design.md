# Design direction & screens

Status: **direction decided, screens not designed yet.** The design canvas link will go here once it exists, and this file will become the design system (tokens, type, components) once the owner approves the screens.

## 1. Look and feel (decided, D27)

- **Black and white, 2D, paper cut-outs on crumpled paper.**
- The UI is monochrome: white and off-white paper, black ink, grey shadows. **The only colour on screen is the user's clothes**, so garments stand out and the UI never clashes with them.
- **Paper surfaces:** crumpled white paper as the page, with cards and sheets as cut-out paper pieces. They have slightly uneven scissor-cut edges, a flat offset drop shadow, and some sit at a small tilt.
- **Garments are paper cut-outs too.** Each cut-out gets a thin white "scissor margin" and a drop shadow, like a sticker or a paper doll's outfit. This hides small cut-out errors and makes photos taken in different light look consistent.
- **Ink:** black lines, hand-cut or hand-drawn icons, and no gradients.

## 2. Motion ideas ⚑ (to explore on the canvas)

- Garments **flutter onto the mannequin** like a paper piece being dropped: a short fall with a slight rotation that settles flat.
- Bottom sheets **slide up like a sheet of paper** with a small curl at the top edge.
- Tab changes: **paper slips in from the side**, overlapping the previous page.
- Background removal: a **scissor line traces the garment's outline** while the model runs, then the background falls away.
- Saving an outfit: a **paper tag** is pinned to it.
- Everything respects the phone's Reduce Motion setting.

## 3. Logo (decided, D26)

An **outline of a person as a mannequin with two pieces of clothing on it**, in the same black-and-white paper-cut style. It must read at app-icon size, so the shapes need to be simple.

## 4. Screens to design

| Screen | Feature |
|---|---|
| Onboarding: welcome, language, privacy, model download | F1 |
| Body photo guide → camera → processing → key-point check | F1 |
| Dress-up: mannequin with zones, accessory buttons, sliding item row, layer tabs, toggles | F6 |
| See all (zone grid) | F6 |
| Adjust fit (handles) | F7 |
| Camera loop and gallery import, processing queue | F2 |
| To review inbox | F2, F3 |
| Item form: cut-out approval + pre-filled form + same-item banner | F3, F11 |
| Fix cut-out: model comparison, brush | F4 |
| Wardrobe grid with filters and search | F5 |
| Outfits grid | F8 |
| Wear log / not-worn list | F9 |
| Locations and seasonal swap (bulk move) | F10 |
| Share outfit preview | F12 |
| Weather chip and the Settings consent | F13 |
| Trips list, trip checklist grouped by location | F14 |
| Settings, Model lab, backup / restore | F15, F16, §5 of architecture |
| Install guide (browser tab, not installed) | F17 |

## 5. Design open questions

See [decisions.md](decisions.md#open-questions):
- Q3 tabs and navigation
- Q4 dark mode
- Q5 fonts (free only, R3)
- Q6 privacy of shared images

## 6. Language

English by default and Ukrainian in the app (D4). Every screen must fit the longer Ukrainian strings, so the canvas shows both languages for the densest screens.
