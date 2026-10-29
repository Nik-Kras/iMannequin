# Bug audit, October 2026 (build e954c91, 2026-10-28)

**Why.** On the owner's iPhone, "Використати це фото" (Use this photo) did nothing after a good A-pose photo. The tap handler swallowed every error, so the failure was invisible. The owner asked for Sentry (D50) and for the audit pipeline used on RHP: find, reproduce, cover with tests and fix.

**Method.** Five review agents went over the app in parallel. Each used published skills or agent prompts as its checklist, the same set used for the GymLog and RHP audits:
- **Live test.** One agent drove the preview build in WebKit (the iPhone Safari engine) with the iPhone 15 Pro profile and a persistent profile, like an installed app. It used:
  - a fake live camera filming synthetic garments or a drawn A-pose figure, or refusing permission;
  - real cut-out and classification models, served from a local mirror;
  - messy taps, double taps, reloads mid-flow (iOS killing the app), small screens and the keyboard.
- **Reviews.** The other four read the code and ran experiments:
  - navigation, state and storage;
  - interaction design (Nielsen's heuristics);
  - performance and memory, measured as process memory of WebKit and Chromium;
  - accessibility and visuals.

Everything is synthetic (R2): garments are the design canvas's paper shapes, the body is a drawn figure, and MediaPipe is replaced by key points computed from the drawing.

**Checklists.** Installed globally in `~/.claude` and translated from Android/Compose to an iPhone home-screen web app:
- android/skills: navigation-event, edge-to-edge, jetpack-compose-performance, anr-audit-and-fix.
- chrisbanes/skills: compose-animations, compose-performance, compose-focus-navigation, compose-state-and-effects.
- wshobson/agents: interaction-design, mobile-android-design, accessibility-compliance, `/design-review`, ui-visual-validator.
- VoltAgent/awesome-claude-code-subagents: ui-ux-tester, accessibility-tester, ux-researcher, mobile-app-developer.
- new-silvermoon/awesome-android-agent-skills: android-accessibility, compose-performance-audit.
- anhvt52/jetpack-compose-skills: modern-jetpack-compose.
- The project's design skills: impeccable, ui-ux-pro-max and taste-skill.

**Severity.** High breaks a flow, loses data, fails silently or risks iOS killing the app. Medium is annoying or frequent. Low is polish.

## The list

### Data loss and storage (WebKit / iPhone)

1. **High · Photos waiting in the queue are lost when the app closes, and the queue stalls.**
   - Every state change rewrites the queue record that holds the photo Blob. After a relaunch, or after one dead Blob, the job's own "failed" write throws outside the try. `pump()` dies with a rejected promise and `resumed` caches the rejection. The inbox then shows "still cutting" forever, with no cancel or retry.
   - The Photo is created from the stale `job.blob` handle.
   - **Fix:**
     - Store the photo bytes once, in their own table.
     - Every per-job write gets its own catch.
     - Unreadable photos become failed jobs with a "photo lost, take it again" message.
     - The runner re-arms itself.
     - Pending rows can be removed.
   - `src/data/queue.ts`.
2. **High · Approving or saving garments from an earlier session blanks their images, and backup export then fails.**
   - These paths rewrite Photo records that hold Blobs by re-storing IndexedDB-backed Blob handles:
     - `setCutoutApproved`
     - `saveCutout`
     - `mergeIntoExisting`
     - Settings "Delete original photo"
   - The images read as dead until a relaunch.
   - **Fix:** rewrite such records only with in-memory copies of their Blobs.
   - `src/wardrobe/ops.ts`, `src/screens/Settings.tsx`.
3. **High · Silent failures across the app (the same class as the owner's bug).**
   - Writes can fail on iOS (the IndexedDB connection is lost after the camera or picker). None of these handlers catches the error:
     - Add clothes shutter and gallery import: the flash fires even when nothing was stored.
     - Item form Save: the button stays disabled forever.
     - "Looks good", "Use for try-on", "Yes, same one".
     - Save outfit, Wearing today, Undo, every draft change.
     - Adjust fit Done, Fix cut-out "Use", Season swap, See all.
     - Outfits open, rename and delete.
     - Trip delete and edits, place rename.
     - Settings switches, the body-photo Skip, the install guide and the backup reminder.
   - **Fix:**
     - One `useAction` helper: busy guard, reopen-and-retry, `reportError`, and an error toast with Retry.
     - Store photos as in-memory copies.
     - A write that hangs is treated as a lost connection after 10 s.
4. **High · A settings read error or a failed start leaves a blank page.**
   - `App()` reads settings outside the error boundary, and `boot()` has no catch.
   - **Fix:**
     - Put the boundary above everything.
     - Make `boot()` show the bilingual error screen.
     - Send unhandled rejections to the black box.
5. **Medium · Backup.**
   - Restore copies the other phone's crash-report choice, weather location and model choices.
   - It leaves the anchors table stale.
   - One unreadable image fails the whole export.
   - Export and restore hold the whole wardrobe in memory 2–3 times (restore of 150 items peaked at 1.1 GB).
   - **Fix:**
     - Keep this phone's settings.
     - Clear anchors.
     - Skip unreadable images and say how many.
     - Restore reads zero-copy slices of the stored (uncompressed) entries.
     - Export flushes chunks as it goes.

### Crashes and memory (iPhone kills a tab at about 2 GB)

6. **High · Adding clothes crashes the page on the 2nd–3rd garment.**
   - Terminating a worker that holds an ONNX Runtime WebGPU session kills the WebKit page (4 of 4 runs). The queue swaps cut-out ↔ CLIP for every garment.
   - The crash guard then blames the wrong model, because RUNNING is set for the next job before the old worker is terminated.
   - **Fix:**
     - Dispose sessions before terminating.
     - Release before marking.
     - Process a batch in two phases (cut out all, then analyse all), so each model loads once per batch.
7. **High · The default cut-out model (BiRefNet-lite on WebGPU) grows to 4 GB and fails with `bad_alloc`.**
   - ORMBG peaks around 1.2 GB.
   - **Fix:** ORMBG becomes the default and the onboarding download. BiRefNet stays selectable in the Model lab.
8. **High · Models stay in memory after the queue empties, and classification loads both CLIP models.**
   - Measured: 1.67 GB still resident after 5 garments, and 2.75 GB after 20.
   - **Fix:**
     - Release the worker when the queue is idle.
     - Cache the prompt embeddings, so the text model loads once per phone.
9. **High · The body photo is processed at full camera resolution on the main thread.**
   - A 24–48 MP gallery photo used 0.8–1.6 GB, with freezes of 0.25–0.6 s.
   - The original File is stored, and its bytes are copied only at "Use", minutes later.
   - **Fix:** downscale to 2048 px when the photo is picked or shot, as the architecture already specifies, and keep the pose mask at model resolution.
10. **Medium-High · The search model peaks at about 4 GB even in its smallest size, runs automatically once downloaded, and is never released.**
    - The 1.7B default would likely be killed on the first free-text search.
    - The download screen promises it "downloads later when search needs it", which never happens.
    - **Fix:**
      - Release it right after it answers.
      - Never run it on WebAssembly.
      - Run it only after an explicit tap.
      - Make the copy say where to get it.
11. **Medium · The Dress-up row and See all decode full cut-outs, and every tap re-copies every visible card (35 MB per tap with 220 items).**
    - The Add-clothes strip decodes 2048 px originals for 48 px thumbnails.
    - Gallery import blocks until every photo is downscaled.
    - **Fix:**
      - Show thumbnails first.
      - Key object URLs by photo id.
      - Make small previews at enqueue time.
      - Fill the strip progressively.

### Body photo

12. **High · "Take photo" silently drops the photo when the live camera fails.**
    - The hidden inputs unmount with the camera.
    - The fallback `click()` runs from an async callback, which iOS blocks.
    - There is no message.
    - **Fix:**
      - Keep the inputs mounted.
      - Show "Camera not available" with a real file input.
13. **Medium · No way past a pose check the user disagrees with.**
    - It contradicts R5: every AI result is an editable suggestion.
    - The arm-angle wording disagrees with the check: the guide says 30–45°, but 25° passes.
    - The check title shows even when no person was found.
    - **Fix:** add "Use anyway" for arm-angle and framing issues, and unify the wording.
14. **Medium · Skipping the body photo leaves no path back.**
    - Dress-up never offers it.
    - Settings says "Retake" for a photo never taken.
    - A reload on the check screen throws the processed photo away.
    - **Fix:**
      - A card on Dress-up.
      - "Take body photo" in Settings.
      - The pending photo is kept for the session.
15. **Medium · Body camera.**
    - The white "Cancel" and the hint are drawn straight on the video: 1.45:1 against a light wall.
    - After backgrounding, the countdown captures a black frame.
    - The countdown reads only the digit to VoiceOver, with no sound for the last seconds.

### Adding and reviewing clothes

16. **High · The queue doesn't say which photo failed or why.**
    - Failed rows show ⚠ instead of the photo.
    - Network, storage and memory errors are reported as "no garment found".
    - There is one progress bar stuck at 6% while models download.
    - Non-image files are dropped silently.
    - **Fix:**
      - Show the photo in the row.
      - Three messages, each with its own action: Retake / Download models / Retry.
      - Per-photo states.
      - "N files weren't photos".
17. **High · Reviewing each garment takes too many steps.**
    - Save is below the fold and scrolls back to the top for every item.
    - "Looks good" and Save compete as two black buttons; Save already approves the cut-out.
    - The place must be picked again for every item.
    - **Fix:**
      - A sticky footer: "Save and next · 2 of 6".
      - "Looks good" becomes a quiet tick.
      - The last place used is suggested first, marked ✦.
18. **High · Item-form edits are discarded on back, on the edge swipe or when iOS kills the app.**
    - Wardrobe search and filters are also reset when returning from an item.
    - **Fix:**
      - Drafts kept for the session and restored.
      - Ask before discarding.
      - Filters in the URL.
19. **Medium · "Not now" on the model download has no way back.**
    - The first garment then silently downloads 231 MB.
    - A reload mid-download shows the full size again.
    - **Fix:**
      - Settings shows whether models are downloaded, with a Download button.
      - Add clothes shows a banner.
      - Partial files count.
20. **Medium · The AI's guesses look like decisions.**
    - When the classifier finds nothing, the category silently defaults to T-shirt without the ✦ mark.
    - The name always carries ✦.
    - **Fix:** leave the category unselected and required, with "The AI didn't recognise it".
21. **Medium · Destructive taps without confirmation or undo.**
    - Retake in review and in Fix cut-out deletes the photo, and Close then lands on "not found".
    - Tapping a saved outfit silently replaces an unsaved Dress-up combination.
    - Leaving Adjust fit discards the drags while its note says "Saved".
    - Season swap has no undo.
    - Tapping "✓ Logged" deletes today's wear entry.

### Navigation and taps

22. **Medium · After onboarding, the back gesture returns to the model download and Welcome.**
    - Welcome and the download screen also reopen for an onboarded user.
23. **Medium · Double taps create duplicates:**
    - Save outfit ×3
    - Wearing today ×2
    - New trip ×2
    - New place ×2
    - Settings and the centre + pushed twice, so Close reopens the camera
    - Two quick accessory taps lose one
    - Settings writes race (read then put)
24. **Medium · `goBack()` guesses from `history.length`.**
    - It can do nothing, or leave the app in a browser tab.
    - Sheets aren't history entries, so the edge swipe leaves the screen instead of closing the sheet.
25. **Low · Dead-end deep links.**
    - `#/fit/<missing>` shows an empty stage whose Done does nothing.
    - `#/item/<missing>/fix` is blank.
26. **Low · Welcome opens scrolled after the install guide.**

### Dress-up and try-on screens

27. **High (small screens) · Dress-up layout collides.**
    - The slot column is pushed into the header, under the Settings button.
    - An open clothes row covers the feet and the Shoes slot, against D31's "never over the body".
    - The Tuck-in toggle is clipped at 393 px.
    - Save and Wearing today overlap at 320 px.
    - Adjust fit's hem handles sit under its panel on an SE.
28. **Low · Small defects.**
    - The "Extras" label sits over the mannequin's legs.
    - The Adjust fit back link is out of line.
    - The mannequin's body zones duplicate the slots for VoiceOver and are as small as 29×15 px.
    - See all hides items with no season.

### Outfits, wear log, trips, sharing, settings

29. **Medium · Wear log input is incomplete compared with D46.**
    - A single item can't be marked worn.
    - A day can't be opened to fix or delete an entry.
30. **Medium · "Save to Photos" claims success.** On iPhone an `<a download>` never reaches Photos. **Fix:** use the share sheet, which has "Save Image"; the fallback says "Download".
31. **Medium · The install guide doesn't say that a Safari tab and the home-screen app keep separate data.** A wardrobe built in the tab won't appear in the app.
32. **Medium · Sheets with text fields ignore the keyboard.**
    - The trip, save-outfit, place and rename sheets have their buttons behind the iOS keyboard.
    - Return in the trip name creates a trip at once.
33. **Low · Trips.**
    - An end date before the start silently blocks Create.
    - A past trip says "in -27 days".
    - The piece picker has no search or headings.
34. **Low · Deleted default places come back on the next navigation.**
35. **Low · Share "Add my photo" works and claims a body photo when there is none.**
36. **Medium-Low · The backup reminder comes too early.**
    - It shows from the first item, as a black ⚠ bar.
    - Its Ukrainian action "Зберегти" collides with saving an outfit.
    - **Fix:** from 10 items or 3 days; "Створити копію".
37. **Low · The Settings icon reads as a sun or brightness.** Places is only reachable through it.

### Accessibility and visuals

38. **Medium · Text doesn't scale.** Every size is in px, so iOS Text Size has no effect in the installed app.
39. **Medium · Horizontal overflow and clipped labels at 320 px and with page zoom.** Affected: the Outfits header, Wearing today, the tab bar, and the item form.
40. **Medium · Names truncated.** Outfit tags cut at about 13 characters. Card names lose their second line. Two pairs of jeans look identical.
41. **Medium · Reduce Motion makes the scan line strobe at 20–30 Hz, and freezes the spinner.**
42. **Medium · Touch targets under 44 px.** Affected:
    - segmented controls (34 px)
    - the language control
    - season chips
    - search clear
    - the tips pill
    - backup "Back up"
    - Fix cut-out tool tabs
    - quick-place tags
    - the brand field
43. **Medium · VoiceOver.**
    - Focus stays on `<body>` after every navigation, and the document title never changes.
    - Sheets don't move focus in or restore it, and the background stays reachable.
    - The item form has no h1.
    - Colour chips announce "Remove green, selected".
44. **Medium · Toasts.**
    - The live region is mounted together with its text, so VoiceOver may stay silent.
    - Undo disappears after 3.5 s.
    - On Dress-up the toast covers Save and Wearing today, and in Add clothes it covers the queue strip.
45. **Low-Medium · Control boundaries below 3:1.** Pencil on white is 1.63:1 for unselected chips, the notes field, cells and dots. **Fix:** a `--line` token at #89847A (3.15–3.72:1).
46. **Low-Medium · Caveat place names at 14–16 px read like 11 px, and the pin icon floats.**
47. **Low · Disabled buttons at 40% opacity (2.69:1).**
48. **Low · Touch feedback and motion.**
    - Cards, slots, chips and rows have no pressed state.
    - Sheets vanish without animating out.
49. **Low · Visual defects.**
    - The Fix cut-out action bar shows text through it.
    - "Cut-out approved" is overlapped on SE.
    - Failed-row buttons wrap.
    - See all's pen circle covers the place.
    - "Export a copy" wraps.
50. **Low · Copy.**
    - "Гаразд" for the cut-out.
    - "р.." after a date.
    - "0.1 с" instead of "0,1 с".
    - "в налаштуваннях браузера" in a home-screen app.
    - Default outfit names too long.
    - "✓ Збережено" vs "✓ Записано" side by side.
    - "Looks like Olive skirt".
    - The search empty state repeats itself.

### Found on the owner's phone after the audit (Android, Chrome)

51. **High · A photo with the feet cut off says "We couldn't find a person".** MediaPipe found all 33 points, but the ankles and heels were outside the photo, so their visibility was low and no mannequin was made (it needs the feet for shoes). The check screen then showed "no person" for every photo without a mannequin, hiding the real reasons. The arm-angle check was also skipped whenever the ankles were out of the frame, so arms held by the sides weren't named.
   - **Fix:** "no person" only when there are no points. Otherwise the screen lists the problems: feet cut off, arms too close (now measured from shoulders to hips when the feet are out of the frame). A rejected photo reaches Sentry as a warning with its issue codes (D50), so this is visible next time.
52. **High · R1: MediaPipe posts usage logs to Google.** `@mediapipe/tasks-vision` 1.2.0 starts a logger with every task that posts to `odml.pa.googleapis.com` every minute and when the task closes. There is no option to turn it off. Sentry's network trace showed the request right after the pose model loaded.
   - **Fix:** before MediaPipe loads, the app answers that address itself without the network; the logger treats the failure as final and stops. A test runs the real pose model and fails if any request leaves for a host other than the app and Sentry.

53. **Low · The centre + is cut by the tab bar's torn edge.** The torn paper strip along the top of the tab bar (`.tabbar::before`) is a positioned element, so it painted over the raised + and cut a band across its top, leaving a dark sliver above the zigzag. Found by the owner on the phone.
   - **Fix:** the + is positioned above the strip; its white ring now covers the torn edge, as designed. A test checks that the top of the + is the button itself.

54. **Low · Adjust fit's arrow pad ignored taps for a moment.** The pad was drawn before the garment was placed on the mannequin, and a tap in that moment did nothing. Under load an end-to-end test caught it (it failed once in 155).
   - **Fix:** the pad is disabled until the garment is placed. The test passed 90 times in a row afterwards.

## Status

**All 50 items are fixed (2026-10-28)**, two of them only in part (#9 and #40), and so are #51–#54, three found on the owner's phone and one by a flaky test afterwards. Each item has tests named after its number (`#N`). They fail on the old code and pass on the fixed code.

**How it was fixed.** Four agents worked in parallel, each in its own git worktree and owning a set of files:
- data, AI and memory;
- body photo and Dress-up;
- adding and reviewing clothes;
- app shell, outfits, trips and settings.

Each one:
1. wrote the `#N` tests first;
2. ran them against a build of the unfixed code;
3. fixed the cause;
4. reran its tests and everyone else's.

The branches were merged one after another; #38 (text size) came last, because it touches every stylesheet.

**Proof that the tests catch the bugs.** Every new end-to-end test was run against the build that was on the phone (e954c91):

| Tests | Run on e954c91 | Failed there | Passed there, as expected |
|---|---|---|---|
| Body photo and Dress-up, shell and life screens | 98 | 94 | #0 ×2 (the hardening already deployed with D50), and #23 and #24, regression guards for behaviour that already worked |
| Data, AI and memory (real models) | 8 | 8, including the page crash of #6 | none |
| Adding and reviewing clothes | 37 | 36 | #11 “one image URL per queued photo”. It failed on the agent's pre-fix build, whose strip code is the same, so its result on the old code depends on timing; the other #11 test shows the bug |
| Text size (#38) | 4 | 3 | “nothing cut off at 200 %”: on the old code text never grows, so nothing can be cut off; it guards the fix |

New unit tests cover the queue runner, worker lifecycle, backup, search, reminder rule, wear log and naming. Each of them failed on the old modules.

**Changed from the plan:**
- **#6.** Disposing the models before terminating a worker did not stop the crash. In WebKit, terminating any worker that has run a WebGPU session kills the page about 1.5 s later. That held even with the GPU device destroyed and a 2.5 s wait. So a WebGPU worker is never terminated; it disposes its sessions and is reused ([architecture §3](architecture.md#3-processing-model)).
- **#11.** The job record no longer holds the photo. Screens read the queue only through `useQueueView()`, which joins the write-once photo table.

**Partly fixed or left open:**
- **#9.** The full-size photo is decoded once, to scale it to 2048 px. The 2048 px copy is still decoded twice, once for the pose and once for the cut-out, about 12 MB each. Merging them needs a change to the pose result.
- **#40.** Dress-up slot names still stop at 2 lines, and the slot callouts don't grow with the text size. Open question Q19 proposes hiding the zone label when a garment is on.
- **#23.** "+ New place" double-tapped from the item form didn't reproduce in WebKit. The shared form fix covers it, and "Add" in Places has a test.
- Two items needed no change: #45 (the body step dots are all ink on step 3 of 3) and #50 (the "✓" in "Saved" is an icon, already hidden from VoiceOver).

**Judgement calls.** These are logged as D51–D60 in [decisions](decisions.md), marked "owner to confirm":
- ORMBG is the default cut-out model.
- The body photo is scaled to 2048 px, and the check offers "Use anyway".
- Reviewing clothes uses "Save and next".
- The backup reminder comes from 10 items or 3 days after the first item.
- Back closes an open sheet first, and the item form asks before discarding.
- The search model runs only when you tap.
- The wear log can be edited by day.
- Dress-up gets a "Create your mannequin" card and handles small screens.
- Text follows the phone's text size.
- "Save to Photos" opens the share sheet, and the install guide explains that a tab and the app keep separate data.

**Bugs found while fixing:**
- The backup counted lost image files, not photos. One garment whose three images were lost read as "3 photos". It now counts records.
- At 200 % text, buttons, segmented controls, the backup reminder and Dress-up overflowed. They are covered by #38.

**Tested by mechanism only.** Desktop WebKit can't reproduce these, so the tests check how they work:
- memory on a real iPhone (#6–#9; WebKit and Chromium figures are in the reports);
- the keyboard (#32, via `visualViewport`);
- VoiceOver (#43, focus and `inert`);
- iOS Text Size (#38, via the root font size);
- going to the background (#15, via `visibilitychange`);
- pressed states (#48, via the `:active` rules).

**Still to check on the phone:**
- the body photo end to end;
- a 10-garment batch with the real models (WebKit peaked at 1.9 GB, close to the iOS limit);
- the share sheet's Save Image;
- camera permission prompts;
- the countdown tick;
- VoiceOver;
- Text Size.

Any failure there reaches Sentry (D50).

**Test reliability (2026-10-29).** The end-to-end tests now also run on an Android phone in Chromium (D63). That surfaced only test problems, now fixed:
- the model mirror handed 100+ MB files through the test protocol, which closes Chromium (now a local file server);
- `openApp` rewrote the settings outside a transaction and could erase a flag the app had just set (#34 failed 5 times in 30; now 60 of 60);
- the backup test (#5) relied on WebKit losing images, which it doesn't do every time (now the lost images are simulated: 20 of 20 on both phones);
- #26, #42 and #50 assumed an iPhone screen, the removed backup banner (D54) and the iPhone's camera setting.
