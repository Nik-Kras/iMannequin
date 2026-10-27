# iMannequin: working notes for Claude

A free PWA (Android + latest iPhone) that turns a body photo into a paper-doll mannequin and catalogues the user's clothes with on-device AI.

## Source of truth
- `PRD.md` for features, and `docs/decisions.md` for every decision, rule and open question.
- `docs/architecture.md`, `docs/try-on.md` and `docs/design.md` for the how.
- When the owner decides something, add it to `docs/decisions.md` (next D number) and update the doc it affects.

## Rules
- **Propose, don't decide.** Names, design, features, stack and pivots need the owner's approval. Never add a feature that wasn't asked for; suggest it instead.
- **Photos never leave the phone (R1).** No server, analytics, error reporting or CDN fonts. The only allowed requests are app files, model downloads and, when the user switches it on, the weather hint.
- **Nothing personal in this public repo (R2).** No real photos of people or their clothes in code, tests, fixtures, screenshots or issues. Use synthetic or public-domain images and record their licence next to them.
- **Free and permissive (R3).** No paid services, accounts or fonts. Check a model's or library's licence (MIT / Apache / BSD) before adding it, and note it in `docs/architecture.md`.
- **Offline after first launch (R4).**
- **AI results are editable suggestions (R5).**
- **Backup and restore must keep working (R6):** bump the backup format version when the data model changes.
- **Every UI string exists in both `en` and `uk`**, and a test checks that their keys match.
- **Never draw a garment with a generative model (D5).** The try-on is a 2D paper doll.

## Commands
To be filled in when the app is scaffolded.
