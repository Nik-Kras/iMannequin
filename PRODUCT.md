# Product

<!-- impeccable:product-schema 1 -->

Derived on 2026-10-28 from [PRD.md](PRD.md) and [docs/decisions.md](docs/decisions.md). Every line below was confirmed by the owner on 2026-10-27; those two files stay the source of truth.

## Platform

web

An installable PWA used on phones: recent Android (Chrome) and the latest iPhone (Safari, iOS 26+). Designed at 390 × 844 first (D1).

## Users

- Anyone with a recent phone who wants to see their own clothes on themselves before getting dressed, and to know what they own and where it's kept. One wardrobe per phone, no accounts (PRD §2).
- Typical moments: getting dressed in the morning (Dress-up), adding a pile of clothes in one sitting (Camera loop), packing for a trip (Trips), and seasonal clear-outs (Locations, Not worn).
- English by default, Ukrainian in the app (D4).

## Product Purpose

Your wardrobe on a paper mannequin of yourself. One A-pose body photo becomes the mannequin; each garment, photographed flat, is cut out and classified on the phone and becomes a paper cut-out that dresses that mannequin. It is also a catalogue of what you own and where each piece is stored ("under the bed", "in the sofa").

Success: adding an item from shutter to saved takes under 30 s; swiping through the row updates the mannequin instantly; an automatic fit looks right for most tops and bottoms (PRD §7).

## Positioning

The mannequin is **you**, built from your own photo, and everything runs on the phone: no server, no accounts, nothing uploaded. It's a 2D paper doll, deliberately not a photoreal try-on (D5).

## Operating Context

- Flat-lay garment photos on a plain background, shot from above; tops with sleeves at about 45° to match the A-pose (D14).
- Real storage places in a home: wardrobe, under the bed, the sofa box, the shelf (F10).
- Trips are packed by walking round the flat, so packing lists are grouped by storage place (Q14 ⭐).

## Capabilities and Constraints

- Features F1–F17 are all in the MVP (D6); body zones and layers in PRD §5.
- Free: no paid services, accounts or fonts (R3). Permissive licences only (R3, R8).
- Photos never leave the phone. The only network use is the app, the models and, if the user switches it on, the weather hint (R1, D25).
- Works offline after the first launch (R4).
- Every AI result is an editable suggestion (R5).
- Backup and restore to a file is required (R6).
- Excluded: underwear and socks (D24), photoreal try-on (D5), sizes, prices and laundry (D23).

## Brand Commitments

- Name: **iMannequin** (D26).
- Logo: an outline of a person as a mannequin with two pieces of clothing on it (D26). Round-1 logos were rejected as "boring and too casual"; the app icon as "too simple, typical AI slop" (2026-10-28).
- Look: black and white, 2D, paper cut-outs on crumpled paper, with paper-cut animations (D27). The only colour on screen is the user's clothes.
- Type: Prata (display) chosen on 2026-10-28, with Onest (text) and Caveat (handwritten tags). Tenor Sans is the accepted alternative.

## Evidence on Hand

- No real photos may appear in the public repo or its screenshots (R2). Designs use drawn garments and an outline or stand-in mannequin.
- No users, reviews, press or usage numbers exist. None may be invented.

## Product Principles

1. The user's clothes are the only colour; the interface is paper and ink.
2. Suggest, then let the user decide: every AI result is a pre-filled, editable field.
3. Private by construction: nothing leaves the phone unless the user switches it on.
4. One-handed and fast: dressing and adding clothes happen with a thumb, standing up.

## Accessibility & Inclusion

- Two languages, so every screen has to fit the longer Ukrainian strings (D4).
- Respect the phone's Reduce Motion setting for every paper animation (docs/design.md §2).
- Drag interactions (Adjust fit, brush) need a tap or button alternative (WCAG 2.2 dragging movements).
