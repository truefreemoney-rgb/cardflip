# Social video backing tracks

Drop royalty-free MP3s in this folder. `scripts/social-video.mjs` rotates
through them one per day (sorted by file name) and mixes the day's track
into the day's videos, trimmed to length with a fade-out. No files here =
silent video. The three videos of a day (the 1pm movers video every site
posts, and the 7am and 7pm TikTok videos) are offset by slot so they do not
all use one track: 1pm keeps the plain day rotation, 7am is one track on, 7pm
two. With fewer than three tracks committed, videos that land on the same track
start 8 bars further in instead of repeating the opening. Only tracks in git
reach the GitHub runner (today: the one below); `SOCIAL_AUDIO_DIR` points a
local render at another folder.

Source: Pixabay Music (https://pixabay.com/music/). Its Content License
allows commercial use in videos with no attribution, which matters because
the posts go out by API with no room for credits. Note the track's Pixabay
URL next to its file name below so the license trail exists.

Picks: 15s videos, upbeat, no vocals, something that still sounds right when
it starts mid-phrase.

| file | Pixabay URL |
| ---- | ----------- |
| cinematic-soul-upbeat-success-happy-corporate-music-511436.mp3 (112.5 bpm, 1:13, start 10.08s) | https://pixabay.com/music/electronic-upbeat-success-happy-corporate-music-511436/ (Pixabay Content License; Chris picked it 09-27 night, first airs 09-28 7am) |

Tried and set aside (Chris picked one at a time; drop the file back in to use it):

- echoes_of_lumen-upbeat-music-happy-commercial-586975.mp3 (95.5 bpm, 0:52, start 2.95s) https://pixabay.com/music/beats-upbeat-music-happy-commercial-586975/ (aired 09-27; copy in Chris's Downloads)

- the_mountain-upbeat-upbeat-music-567448.mp3 (92.5 bpm, 3:15) https://pixabay.com/music/old-school-rnb-upbeat-upbeat-music-567448/ (ran 09-26; copy in Chris's Downloads)
- prettyjohn1-upbeat-upbeat-music-540858.mp3 (129 bpm) https://pixabay.com/music/beats-upbeat-upbeat-music-540858/
- vaitsez-fitness-fitness-workout-beat-582771.mp3 (107.5 bpm) https://pixabay.com/music/beats-fitness-fitness-workout-beat-582771/
- Chris also linked https://pixabay.com/music/old-school-hip-hop-upbeat-564418/ ("Upbeat" by The_Mountain, a different track from the one in the folder, never downloaded).

The cut follows the track: `scripts/lib/beat.mjs` finds the tempo, the
downbeat and where the track gets loud; each card holds one bar, the price
pops on beat 3, the art pulses on every beat (added 09-25, Chris: "match
the feel of the beat").
