# Social video audio

`spotlight-114bpm.mp3` is synthesized by `scripts/social-audio.mjs` (ffmpeg
`aevalsrc`, no samples or third-party recordings). It is CardFlip's own work
and may be used in any CardFlip post on any platform. Regenerate with:

```
node scripts/social-audio.mjs
```

Used by `scripts/social-video.mjs` (`--audio <path>` to swap, `--audio none`
for silent). Chord changes every 2.1s, matching the per-card beat.
