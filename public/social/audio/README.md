# Social video backing tracks

Drop royalty-free MP3s in this folder. `scripts/social-video.mjs` rotates
through them one per day (sorted by file name) and mixes the day's track
into the set-spotlight video, trimmed to length with a 0.5s fade-out. No
files here = silent video.

Source: Pixabay Music (https://pixabay.com/music/). Its Content License
allows commercial use in videos with no attribution, which matters because
the posts go out by API with no room for credits. Note the track's Pixabay
URL next to its file name below so the license trail exists.

Picks: 15s videos, upbeat, no vocals, something that still sounds right when
it starts mid-phrase.

| file | Pixabay URL |
| ---- | ----------- |
| the_mountain-upbeat-upbeat-music-567448.mp3 (92.5 bpm, 3:15) | https://pixabay.com/music/old-school-rnb-upbeat-upbeat-music-567448/ (Pixabay Content License, verified 09-26) |

Tried and set aside 09-25 (Chris picked one for now; drop the file back in to use it):

- prettyjohn1-upbeat-upbeat-music-540858.mp3 (129 bpm) https://pixabay.com/music/beats-upbeat-upbeat-music-540858/
- vaitsez-fitness-fitness-workout-beat-582771.mp3 (107.5 bpm) https://pixabay.com/music/beats-fitness-fitness-workout-beat-582771/
- Chris also linked https://pixabay.com/music/old-school-hip-hop-upbeat-564418/ ("Upbeat" by The_Mountain, a different track from the one in the folder, never downloaded).

The cut follows the track: `scripts/lib/beat.mjs` finds the tempo, the
downbeat and where the track gets loud; each card holds one bar, the price
pops on beat 3, the art pulses on every beat (added 09-25, Chris: "match
the feel of the beat").
