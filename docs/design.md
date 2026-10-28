---
name: iMannequin
description: Your wardrobe on a paper mannequin of yourself. Paper and ink; the only colour is your clothes.
colors:
  ink: "#141414"
  graphite: "#55524C"
  carbon: "#0D0D0D"
  on-carbon-2: "#B9B4AA"
  paper: "#EEECE7"
  sheet: "#FFFFFF"
  tissue: "#F6F4EF"
  pencil: "#CFCAC1"
  rule: "#E4E0D8"
  dash: "#9E998F"
  line: "#89847A"
  marker: "#B3261E"
typography:
  headline:
    fontFamily: "Prata, Georgia, serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Prata, Georgia, serif"
    fontSize: "21px"
    fontWeight: 400
    lineHeight: 1.2
  title-card:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  body-row:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.35
  meta:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
  label-small:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.2
  tag:
    fontFamily: "Caveat, cursive"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.1
  stamp:
    fontFamily: "Caveat, cursive"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1
rounded:
  thumb: "4px"
  card: "6px"
  field: "10px"
  button: "14px"
  pill: "999px"
  round: "50%"
  logo-tile: "22%"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  card: "16px"
  gutter: "20px"
  lg: "24px"
  content-top: "50px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0 22px"
    height: "52px"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0 22px"
    height: "52px"
  button-icon:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.round}"
    size: "44px"
  button-close:
    backgroundColor: "{colors.tissue}"
    textColor: "{colors.ink}"
    rounded: "{rounded.round}"
    size: "44px"
  text-action:
    textColor: "{colors.ink}"
    typography: "{typography.label-small}"
    padding: "0 10px"
    height: "44px"
  chip:
    backgroundColor: "{colors.tissue}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  segmented-track:
    backgroundColor: "{colors.tissue}"
    rounded: "{rounded.pill}"
    padding: "3px"
  segmented-option-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  switch-on:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    width: "52px"
    height: "32px"
  input:
    backgroundColor: "{colors.tissue}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 14px"
    height: "48px"
  card:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.card}"
    padding: "{spacing.card}"
  sheet:
    backgroundColor: "{colors.sheet}"
    padding: "12px 20px 0"
  tab-bar:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.graphite}"
    height: "84px"
  tab-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.pill}"
    width: "52px"
    height: "30px"
  tab-add:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.round}"
    size: "56px"
  slot-card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "0 8px"
    width: "140px"
  layer-thumb:
    backgroundColor: "{colors.tissue}"
    rounded: "{rounded.thumb}"
    width: "38px"
    height: "30px"
  luggage-tag:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.tag}"
    padding: "0 12px 0 9px"
    height: "32px"
  stamp:
    textColor: "{colors.ink}"
    typography: "{typography.stamp}"
    rounded: "{rounded.card}"
    padding: "0 14px"
    height: "40px"
---

# Design direction & screens

Status: **screens designed in two rounds; logo, fonts, navigation and the Dress-up layout decided (D28–D31). The design system (tokens, type, components) is recorded below from the approved boards.** Design canvas (private to the owner): https://claude.ai/artifact/LD7htDV8tUiJnA38KQ9M1x. The token block at the top of this file is the source of truth for values; the sections below say where and why to use them.

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

## 3. Logo (decided, D30)

The **"iM" monogram**: white Prata letters on a black rounded tile (iOS corner radius about 22% of the side; a round mask on Android), with the **iMannequin** wordmark in Prata. A light version (black letters on white) is used where the dark tile disappears, such as dark browser tabs. It replaces the mannequin mark of D26.

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
- Q4 dark mode
- Q6 privacy of shared images (the canvas shows the ⭐ option: outline by default)

Resolved: Q3 navigation (D29) and Q5 fonts (D28).

## 6. Language

English by default and Ukrainian in the app (D4). Every screen must fit the longer Ukrainian strings, so the canvas shows both languages for the densest screens.

---

# Design system

Recorded on 2026-10-28 from the approved boards (style board, Dress-up, the Garment and Mannequin parts, and the app screens). Where boards disagree, the drift is listed in [Known drift](#known-drift); it is not part of the system.

## Overview

**Creative North Star: "The Paper Doll Wardrobe"**

The mannequin is you. Everything else is paper and ink: a crumpled paper page, white cut-out cards, black ink for text and actions. The clothes are the only colour on screen (D27). Garments are cut-outs with a white scissor margin, so they read as pieces you can pick up and put on.

The world is calm and tactile, not cute. Titles are set in Prata, a high-contrast serif (D28). Text is Onest. Handwriting, in Caveat, appears only where a person would write by hand: tags on storage places and outfits, stamps, notes. Screens are dense but quiet, built for one thumb while standing (PRODUCT.md, principle 4).

**Key Characteristics:**
- Crumpled paper ground with white cut-out cards that cast soft offset shadows.
- Ink and graphite only; the clothes carry all the colour.
- Prata titles, Onest text, Caveat for hand-written tags and stamps.
- Paper devices with meaning: luggage tags, rubber stamps, the pen circle, dashed callout lines.
- Dress-up shows every slot at once, each joined to its body part (D31).

## Colors

A monochrome stationery palette: warm off-white paper, white sheets, near-black ink. One red, used only for errors.

### Primary
- **Ink** (`ink`): text, primary buttons, icons, selected states, the logo tile, the active tab pill and the centre +. Selection is always shown by turning a piece of paper to ink, never by a colour.

### Neutral
- **Graphite** (`graphite`): secondary text, meta lines, idle callout lines. 6.6:1 on paper, 7.8:1 on sheet.
- **Carbon** (`carbon`): black paper fields for hero moments (onboarding, model download, the share card).
- **On-carbon grey** (`on-carbon-2`): secondary text on carbon (9.4:1).
- **Crumpled paper** (`paper`): the page ground, always with the crumple texture.
- **Sheet** (`sheet`): cards, sheets, bars, the tab bar.
- **Tissue** (`tissue`): insets inside a sheet: thumbnail wells, segmented-control tracks, input fills, unselected chips, the close button.
- **Line** (`line`, #89847A): the border of an unselected control: option cards, chips, the notes field, cells, progress tracks and dots. 3:1 or more on sheet, paper and tissue (WCAG 1.4.11; bug audit #45).
- **Pencil** (`pencil`): disabled buttons (with graphite text) and other quiet borders that don't mark a control.
- **Rule** (`rule`): hairline dividers between rows inside a card.
- **Dash** (`dash`): dashed outlines of empty slots and "add" or "none" cards. Empty slots also carry a + icon and a label, so the dash is never the only cue.

### Error
- **Marker** (`marker`): destructive actions and errors only (6.5:1 on sheet).

### Named Rules
**The Clothes Are the Colour Rule.** No hue appears in the UI except a garment's own colour and the marker red for errors. Swatches inside colour chips are garment colours, so they count as clothes.

**The Marker Rule.** Marker red is never decoration. If nothing is wrong or being deleted, there is no red on screen.

## Typography

**Display Font:** Prata (with Georgia, serif)
**Body Font:** Onest (with system-ui, sans-serif)
**Handwriting:** Caveat (with cursive)

**Character:** A fashion-editorial serif for titles against a clean, slightly warm grotesque for everything you read and tap. Caveat is the pen in the margin. All three are free Google Fonts with Cyrillic (D28, R3). The app self-hosts the font files; nothing loads from a font CDN (R1, R4). The boards load Google Fonts only because the canvas needs it.

### Hierarchy
- **Headline** (Prata 400, 30px, 1.05): one screen title per screen, top left.
- **Title** (Prata 400, 21px): section titles in sheets and lists ("Under the bed").
- **Card title** (Onest 600, 16px): the heading of a settings or form card.
- **Body** (Onest 400, 16px, 1.45): paragraphs and explanations. Inputs also use 16px so iOS does not zoom.
- **Row** (Onest 500, 15px): list rows and item names.
- **Meta** (Onest 400, 13px, graphite): counts, dates, places. Slot labels in Dress-up use 12px.
- **Label** (Onest 600, 16px; 15px in tight rows): buttons. Text actions use Onest 600, 14px.
- **Tag** (Caveat 600, 18–22px): luggage tags, place names, handwritten notes.
- **Stamp** (Caveat 700, 22px): rubber stamps for finished states.

### Named Rules
**The 12px Floor Rule.** No text is smaller than 12px. The only exception is the favicon-size logo tile, which is an image.

**The Text Size Rule (D59).** The sizes above are at the phone's default text size. In CSS a text size is written as `calc(N * var(--t))`, where `--t` is one pixel of text: on an iPhone it follows iOS Text Size (the root font is `-apple-system-body`, 17px by default), elsewhere the browser's root size. Body text grows up to 200 %. `--t-title` (headlines) stops at 150 %. `--t-tight` (Dress-up, the tab bar, segmented controls and badges) stops at 125 %, and the Dress-up slot callouts stay at 100 %. A control that holds text uses `min-height`, never `height`, so a larger size grows it instead of cutting the text. Only the "iM" mark and the 120px countdown digit stay fixed.

**The Pen Only Writes Rule.** Caveat is for words a person would write by hand: places, outfit names, stamps, notes. Never for buttons, titles, body text or numbers you need to read precisely.

## Layout

Phone first, designed at 390 × 844 (D1). Screens that scroll are drawn taller (for example 390 × 1240).

- **Ground:** the crumpled paper page fills the screen. There is no fake status bar; content starts 50px from the top.
- **Gutters:** 20px at the sides; 16px for full-bleed rows such as filter chips, card grids and the Dress-up clothes row.
- **Header:** the screen title on the left; at most two 44px round actions on the right. Back links are a chevron plus the previous screen's name.
- **Rhythm:** spacing steps of 4, 8, 12, 16, 20 and 24px. Gaps inside a control are 2–6px; between controls 8–12px; card padding 16px.
- **Tab bar:** pinned to the bottom, 84px tall (D29). Settings opens from the Dress-up header, not from a tab.
- **Dress-up layout (D31):** the mannequin on the left; a fixed column of slot cards on the right, each at the height of its body part. The clothes row opens as a sheet below the mannequin, never over it. Every slot is on the page without scrolling.

### Named Rules
**The Never Over the Body Rule.** Nothing covers the mannequin on Dress-up. Sheets stop at its feet.

## Elevation & Depth

Depth is physical paper: a sheet lying on another sheet. Shadows are offset down and right, and softly blurred, as if lit from the top left. Paper pieces may tilt slightly (about ±0.6°) to feel hand-placed; tags and stamps tilt more.

### Shadow Vocabulary
- **Paper at rest** (`0 0 0 .5px rgba(20,20,20,.07), 1px 2px 3px rgba(20,20,20,.14)`): every card, slot, round icon button and the search bar.
- **Lifted, selected** (`0 0 0 .5px rgba(20,20,20,.08), 2px 6px 12px rgba(20,20,20,.18)`): the chosen garment card in the clothes row (also raised 3px), a selected slot.
- **Ink button** (`1px 2px 4px rgba(20,20,20,.25)`): the primary button.
- **Bottom sheet** (`0 -4px 16px rgba(20,20,20,.08)`): sheets that slide up, with a torn or curled top edge.
- **Tab bar** (`0 -2px 10px rgba(20,20,20,.05)`).
- **Centre +** (`0 0 0 5px #FFFFFF, 1px 5px 12px rgba(20,20,20,.3)`): a white ring that cuts it out of the bar.
- **Logo tile** (`0 0 0 .5px rgba(20,20,20,.12), 0 2px 6px rgba(20,20,20,.22)`).

### Named Rules
**The Soft Paper Rule.** Paper shadows are offset and blurred. No hard, zero-blur block shadows.

**The Lift Means Chosen Rule.** The lifted shadow means "selected" or "on top". Never use it for decoration.

## Shapes

- **Cut-out cards and sheets:** gently rounded corners, like trimmed paper (`card`, 6px).
- **Thumbnail wells and layer thumbnails:** nearly square (`thumb`, 4px).
- **Buttons:** soft rectangles (`button`, 14px).
- **Inputs:** a rounder field (`field`, 10px).
- **Chips, segmented controls, switches, the active-tab pill:** full pills.
- **Round buttons and the centre +:** circles.
- **Luggage tags:** a square end and a round end (3px on the eyelet side, half the height on the other), with a small eyelet circle.
- **Torn and curled edges:** only on sheets and bars that slide (D27, §2).
- **Logo tile:** about 22% of the side (D30); round on Android.

## Components

### Buttons
Firm, inked, thumb-sized.
- **Primary:** ink fill, white label, 52–54px tall, ink-button shadow. Can lead with a 20px icon ("Save outfit").
- **Secondary:** white with a 1.5px ink border, same size.
- **Icon-only:** square 52px with a 1.5px ink border (Share), or a 44px white circle with the rest shadow (header actions, Extras).
- **Close:** 44px tissue circle with an ink cross.
- **Text actions:** Onest 600, 14px, 44px tall, no underline ("See all", "Adjust fit").
- **Hover / focus:** links go graphite on hover. Focus is a 2px ink outline, 2px offset, on everything.

### Chips
- **Filter and choice chips:** tissue fill, ink text, Onest 500, about 14.5px. Selected: ink fill, white text.
- **Option chips in forms:** white with a 1.5px `line` border; selected is ink with a white label.
- **Add chips:** transparent with a 1.5px dashed `dash` border ("+ Colour", "+ new place").
- **Colour chips:** a 24px swatch of the garment colour with a 2px white ring, then the name.
- **Suggested by AI:** a small filled four-point star (13–14px) sits next to any value the app pre-filled (R5). It means "you can change this", nothing else.

### Segmented controls
- A pill track with 3px padding; the selected option is an ink pill with white text.
- On a white sheet the track is tissue. On the paper ground the track is a white sheet with the rest shadow.

### Toggles
- **Switch:** 52 × 32px pill, 24px white knob. On is ink. Used in settings rows, with `role="switch"`.
- **Inline option switch:** 38 × 22px, only inside a 44px-tall labelled button in a sheet ("Tuck in", "Trousers into boots").
- The off track must reach 3:1 against its sheet.

### Inputs
- **Text field:** tissue fill, no border, 48px tall, 14px side padding, Onest 16px. Label above in Onest 500, 13–14px.
- **Search bar:** a white paper bar on the ground, 48px tall, rest shadow, search icon on the left.
- **Place picker:** a white field with a 1.5px ink border and the place written in Caveat.
- **Focus:** the 2px ink outline. **Error:** marker-red message under the field.

### Cards and containers
- **Corner Style:** 6px.
- **Background:** sheet on paper; tissue wells inside.
- **Shadow Strategy:** paper at rest; lifted when selected.
- **Border:** none. Selected option cards get a 2px ink border; unselected ones a 1.5px `line` border.
- **Internal Padding:** 16px; garment cards in the clothes row 7px.
- **Garment card:** white card, a tissue well with the cut-out, the name in 12px under it. Selected: 2px ink ring, lifted shadow, raised 3px.
- **Hero fields:** carbon black paper with white Prata titles and on-carbon-2 text.

### Sheets
- White, full width, bottom-sheet shadow, a curled top edge drawn as an SVG.
- Header row 44px: a Prata 21px title, text actions, and the close button.

### Navigation (tab bar, D29)
- Four tabs: Dress-up, Wardrobe, then the raised centre +, then Outfits, Trips.
- Labels in Onest 12px. Inactive tabs: ink icon, graphite label (500). Active tab: the icon in a 52 × 30px ink pill, label in ink, weight 600, `aria-current="page"`.
- The centre +: a 56px ink circle raised 13px above the bar, cut out by a 5px white ring. It opens the camera loop ("Add clothes").
- No other + buttons in screen headers.

### Paper devices
Use them only where they carry meaning.
- **Luggage tag:** Caveat, 1.5px ink border, an eyelet circle, a slight tilt (−1.5° to −5°). For storage places, outfit names and the "on you" tag.
- **Rubber stamp:** 2px ink border, 6px corners, Caveat 700 22px, opacity 0.85, rotated −6° to −10°. For finished states ("packed", "worn", "done"). Nothing disappears; it gets stamped.
- **Pen circle:** a hand-drawn open ellipse, 2px ink, round caps, slightly rotated, over the selected cell in a grid.
- **Crumple texture:** an SVG noise and lighting filter on the paper ground, multiplied in at about 0.55 opacity. It is the only gradient-like effect allowed.

### Dress-up signature parts (D31)
- **Slot card:** a 140px-wide cut-out card in the right-hand column. A label line (12px graphite) over the item name (13px, 600, up to two lines), with a 34 × 30 thumbnail well. Empty slots are half-transparent with a dashed `dash` border, a + well and "Add hat". The selected slot gets a 2px ink border and the lifted shadow.
- **Callout leader:** a dashed graphite line (1.3px, 3/3 dash) from the slot to its body part, ending in a small white dot. The active slot's line turns solid ink (1.6px).
- **Layer thumbnails:** the Top slot shows Base, Middle and Outer as three 38 × 30 tissue thumbnails. An empty layer has a dashed outline and a small +. The label reads "Top, 2 of 3 layers".
- **Layer tabs:** a segmented control (Base, Middle, Outer) at the top of the Top sheet.
- **Clothes row:** a horizontal row of garment cards in the sheet below the mannequin, starting with a dashed "None" card.
- **Hanger row (alternative view):** garments hang from an ink rail on drawn hangers. The garment that is on you is replaced by an empty hanger with an "on you" luggage tag.
- **Extras:** a 44px round button at the mannequin's side for bags, belts and glasses (D17).

### Iconography
- Inline SVG, 24 × 24 grid, drawn at 18–22px; 1.8px stroke, round caps and joins, no fill. `aria-hidden="true"`; the button carries the label.
- Hand-drawn feel, no icon fonts, no emoji, no icons in tinted squares.

## Accessibility floors

- **Targets:** every tap target is at least 44 × 44px, with 8px or more between targets.
- **Text:** never below 12px. Inputs use 16px.
- **Contrast:** text reaches 4.5:1 (ink 15.6:1 and graphite 6.6:1 on paper). Controls and their states reach 3:1.
- **Focus:** the 2px ink outline with a 2px offset is always visible.
- **Selection:** never colour only. Selected things turn ink, gain a border, a lift, or a pen circle, and set `aria-pressed` or `aria-current`.
- **Motion:** every paper animation respects Reduce Motion (§2).
- **Dragging:** Adjust fit and the brush have tap or button alternatives (PRODUCT.md).

## Ukrainian strings

Ukrainian runs about a quarter to a third longer than English (D4). The boards check the densest screens in both languages.
- Labels wrap to two lines instead of shrinking or truncating: slot names clamp at two lines; garment names wrap under the card.
- Paired buttons share the row by flex, never by fixed widths ("Так, той самий" / "Ні, інша річ").
- Chip rows wrap or scroll sideways; never squeeze the padding.
- Tab labels must fit at 12px under the icon: **Примірка · Гардероб · Образи · Поїздки** (D33).
- Caveat tags hold short phrases ("під ліжком", "у дивані"). Keep them to a few words.
- Set `lang="uk"` so hyphenation and screen readers work.

## Do's and Don'ts

### Do:
- **Do** keep the UI in ink, graphite and paper; let the garments be the colour.
- **Do** use the paper-at-rest shadow on every card and the lifted shadow only for selected pieces.
- **Do** show every Dress-up slot at once, each joined to its body part by a callout line (D31).
- **Do** open the clothes row below the mannequin.
- **Do** give every garment a white scissor margin and a drop shadow.
- **Do** mark pre-filled values with the AI star and keep them editable (R5).
- **Do** use only drawn garments and an outline or stand-in mannequin in the repo and its screenshots (R2).

### Don't:
- **Don't** use hard, zero-blur offset shadows.
- **Don't** put an eyebrow or small label above a heading, or use tracked uppercase labels.
- **Don't** write progress as text ("Step 2 of 3"); show it with bars or dots.
- **Don't** use gradients other than the crumple texture, glass effects, or icons in tinted squares.
- **Don't** use marker red for anything but errors and delete.
- **Don't** set Caveat for buttons, titles or body text.
- **Don't** cover the mannequin with a sheet or menu.

## Known drift

Found on the boards and not part of the system. Fix on the next board pass.
- **Text progress:** Item form shows "2 of 3" / "2 з 3" in its header.
- **Chip height:** form and filter chips draw at 36px on the boards. In the app every chip gets a 44px touch area (an invisible hit area around the 36px chip), which satisfies the floor.
- **Segmented tracks:** Settings uses the paper colour inside a white card instead of tissue.
- **Switches:** the boards draw three sizes (52 × 32, 44 × 26, 38 × 22). The app uses one: 44 × 26 with a 44px touch area, off track #8F8A80 (about 3.4:1 on white).
