# Scanner outline research (10-15 / 10-16), kept for auto-scan

The live card outline and its green "ready" were removed on 10-16 (Chris:
"screw the green indicator, just put some text at the top"). Everything
measured on the way is kept here so a later AUTO-SCAN (fire the capture by
itself when one card is lined up) can start from data, not from scratch.

## Data (local, gitignored)
- `.outline-dumps/` ~450 phone frames: full 1920x1920 JPEG + JSON per frame
  (crop geometry, guide, the finder's box, per-tick boxes with reasons).
  Rounds: 10-15 noon binder frames (`2026-10-15T16-0x`); 10-16 `02-3x`
  (binder, post twitch fix); `04-21..04-26` round 1 (binder, loose card,
  ceiling light); `05-01..05-05` round 2; `05-16..05-19` round 3
  (`05-16/17` light off, `05-18/19` ceiling light). Back up this folder
  before any cleanup: it cannot be re-recorded the same way.
- `scripts/outline-eval/labels.json`: 18 hand-labeled card boxes (crop px),
  the ground truth for `bench.mjs`.
- By-eye "box across two or more cards" labels, round 3 (used by
  `strip-cues/feat3.mjs` as `X=`): light off 05-17-02,04,06,09,10,12,14,16,
  18,21,25,29,42,44,46,48,50,52,54,56; ceiling light 05-18-05,07,19, 05-19-02.

## Scripts (`node --experimental-strip-types`, from the repo root)
- `scripts/outline-eval/bench.mjs`: corner finder vs labels + stability.
  10-16: 4/18 correct (IoU >= 0.9), mean IoU 0.756; tracked box moves 1.0 %
  median across shifted runs (0.9-1.6 % with sensor noise).
- `show-live.mjs`, `tick-jitter.mjs`: montages and per-tick movement.
- `strip-cues/`: "does the page run through the box" cues on the phone's
  own box per frame: `feat.mjs` edge share, `feat2.mjs` signed edges + band,
  `feat3.mjs` tilt-tolerant smooth strip (the best), `big.mjs` large frames
  with the box, `gate*.cjs` / `why.cjs` / `st*.cjs` tally the green gate per
  tick from the dumps. Paths inside are absolute (Chris's PC).
- `pageThrough()` at the end of `src/lib/photoQuality.ts`: the first strip
  test (flat + page-coloured + runs past the box). Unused by the app.

## Findings
- Corner finder (rounded-corner templates in four patches round the guide):
  on a binder page the box hugs the pocket, a seam or two cards as often as
  the card (4/18). The card's edge through a sleeve reads about 2.5x fainter
  than the seams and sleeve edges round it; eight gray-level cues tried, none
  separates them (docs/STATE.md 10-16 entries have the numbers).
- Green gate on corner scores: all four >= 30 + side support >= 0.7 went
  green in 2 of 17 ceiling-light windows; 3 of 4 >= 25 + support 0.6 went
  green in 15 of 17 but let boxes across two or four cards go green.
- Steadiness: the live tracked box moves ~7 % of the guide per tick on a
  still card (bench said 1 %); a 3 % hold-still gate never passed, 10 % did.
- Page-strip test: the gap between pockets is 10-20 crop px of smooth
  plastic between card borders, and the boxes sit a few degrees off it, so
  lines must be allowed to tilt. Best cue = smooth line (roughness < 10,
  same gray past both ends): columns clean (10/20 straddles, 0 false
  positives); rows catch 9 more with 4 false positives (cream text-box bands,
  flat art). Overall 16/20 caught, 5 false positives on 41 light-off frames;
  3/4 with 1 false positive under the ceiling light. Not good enough to gate.

## If auto-scan is tried
- Decide on the GUIDE, not the finder's box: "one card lined up with the
  guide" = a card edge near each guide side + no seam through the middle
  70 % + steady + light OK. The next lever is colour or a learned cue, not
  more gray-level geometry.
- Measure first (memory: measure before tuning): label a round by eye with
  the montages, score the rule offline, then one phone round.
