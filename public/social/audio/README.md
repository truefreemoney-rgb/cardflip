# Social video backing tracks

Drop royalty-free MP3s in this folder. `scripts/social-video.mjs` mixes one
into each video, trimmed to length with a fade-out. No files here = silent
video. Chris 09-30: "randomize the audio to audio we used in previous posts",
so the folder holds the tracks that have aired (six since 09-30 night, Chris:
"join them in the rotation"), and each day shuffles
them (seeded by the day, `scripts/lib/audio-plan.mjs`) across the day's three
videos (the 1pm movers video every site posts, and the 7am and 7pm TikTok
videos): three tracks, three videos, never the same one twice in a day. With
fewer tracks than videos, videos that land on the same track start 8 bars
further in instead of repeating the opening (moved onto the beat of that part
of the track, and off any drumless breakdown). Only tracks in git reach the
GitHub runner; `SOCIAL_AUDIO_DIR` points a local render at another folder.
Add a track only with Chris's yes, and give it a row below.

Source: Pixabay Music (https://pixabay.com/music/). Its Content License
allows commercial use in videos with no attribution, which matters because
the posts go out by API with no room for credits. Note the track's Pixabay
URL next to its file name below so the license trail exists.

Picks: 15s videos, upbeat, no vocals, something that still sounds right when
it starts mid-phrase.

| file | Pixabay URL |
| ---- | ----------- |
| cinematic-soul-upbeat-success-happy-corporate-music-511436.mp3 (113 bpm, 1:13, opens at about 9.6s; a 3s breakdown at about 34.6-37.7s) | https://pixabay.com/music/electronic-upbeat-success-happy-corporate-music-511436/ (Pixabay Content License; Chris picked it 09-27 night, first airs 09-28 7am) |
| echoes_of_lumen-upbeat-music-happy-commercial-586975.mp3 (95.5 bpm, 0:52, start 2.95s) | https://pixabay.com/music/beats-upbeat-music-happy-commercial-586975/ (Pixabay Content License; aired 09-27, back in rotation 09-30) |
| the_mountain-upbeat-upbeat-music-567448.mp3 (92.5 bpm, 3:15) | https://pixabay.com/music/old-school-rnb-upbeat-upbeat-music-567448/ (Pixabay Content License; aired 09-26, back in rotation 09-30) |
| cinematic-soul-dance-upbeat-background-music-success-vibes-511439.mp3 (123 bpm, 1:36, start 17.0s) | https://pixabay.com/music/dance-dance-upbeat-background-music-success-vibes-511439/ (Pixabay Content License; Chris picked it 09-30 night, first airs 10-01) |
| cinematic-soul-motivational-upbeat-music-winning-spirit-511443.mp3 (123 bpm, 2:23; drumless gaps early, so the first video opens about 73s in) | https://pixabay.com/music/dance-motivational-upbeat-music-winning-spirit-511443/ (Pixabay Content License; Chris picked it 09-30 night, first airs 10-01) |
| prettyjohn1-promo-promo-music_68sec-595667.mp3 (74 bpm, 1:08; one bar per card, ~3.2s, the quickest of the six) | https://pixabay.com/music/corporate-promo-promo-music-68sec-595667/ (Pixabay Content License; Chris picked it 09-30 night, first airs 10-01) |

Tried and set aside, never aired (drop the file back in only with Chris's yes):

- prettyjohn1-upbeat-upbeat-music-540858.mp3 (129 bpm) https://pixabay.com/music/beats-upbeat-upbeat-music-540858/
- vaitsez-fitness-fitness-workout-beat-582771.mp3 (107.5 bpm) https://pixabay.com/music/beats-fitness-fitness-workout-beat-582771/
- Chris also linked https://pixabay.com/music/old-school-hip-hop-upbeat-564418/ ("Upbeat" by The_Mountain, a different track from the one in the folder, never downloaded).

The cut follows the track: `scripts/lib/beat.mjs` finds the tempo (refined
past the coarse pass to about 0.05 bpm), the downbeat, where the track gets
loud and where it has no drums; each card holds two bars, the price pops on
beat 3, the art pulses on every beat (added 09-25, Chris: "match the feel of
the beat"). A new track needs no setup: `npm run test:socialtiktok` measures
the committed one against its audio.
