# Voice, music and sound

## Voice (Kokoro, local)
`project.json`: `"voice"`, `"speed"` (default 0.95; 0.85–0.9 for a calm premium read, up to 1.05 for energy;
per scene too), `"lexicon"` for pronunciation. Check a brand name with `studio_say` (`text: "HAURA Scent"`) and
give the user the path of the WAV it returns to play. Keep `say` in normal spelling (captions come from it); put sound-alike spellings only
in `lexicon`.
| id | voice | id | voice |
|---|---|---|---|
| `af_heart` | warm female, US (default, best measured) | `am_michael` | male, US |
| `af_bella` | bright female, US | `am_adam` | deeper male, US |
| `af_nova`, `af_sky` | female, US | `bf_emma`, `bf_isabella` | female, UK |
| `bm_george`, `bm_lewis` | male, UK | | |
- Per scene overrides: `{"id": "s3", "say": "…", "voice": "am_michael", "speed": 1.0}`.
- Brand words: `"lexicon": {"LSPedia": "L S Pedia", "HAURA": "Hora"}` (spelling only changes the sound).
- A question mark barely lifts the pitch: keep questions short, or make them statements.
- `studio_voice` with `only: ["s3", "s5"]` re-voices just those scenes.
- Kokoro is English-first. For Nigerian Pidgin or other accents there is no matching voice: write those
  lines as on-screen text, or use the user's own recorded voice (footage mode).

## Music (`"music"` in project.json)
- Generated (licence-free, made by `studio_audio`): `warm` (96 BPM, pad + pluck), `calm` (72 BPM), `upbeat` (118 BPM), `none`.
- The user's own song: `{"file": "src/assets/song.mp3", "start": 47.3, "gain_db": -3}` plays from 47.3 s, ducked
  under the voice. Add the song with `studio_file_add`, then find a good section and the beat with `studio_beats` (`song: "src/assets/song.mp3"`; it writes beats.json).
  Commercial songs can be muted in TikTok/Instagram paid promotion; say so to the user.
- Music always dips under the voice automatically (about 8 dB).

## Wordless films and scores
`"mode": "film"`: no voice at all; scenes are `{"id", "start", "end"}` in seconds and `events` place the
sound effects. For music, use the user's licensed track (add it with `studio_file_add`, then
`"music": {"file": "src/assets/song.mp3", "start": 0}`) or one of the generated beds. No tool writes a custom
score, so when the story needs one, say so and ask the user for a track or a composer's file. Whichever you use,
match the feeling to the act: plucks for curiosity, low rumble and thunder for fear, sparse piano with rain for
loneliness, a shimmer for wonder, a groove for joy, a warm chord to end. A generated bed is one mood for the whole film: choose the one that fits the longest act (`calm` for lonely
and wondering, `upbeat` for joyful, `warm` for a gentle ending), or use those moods to brief the search for a track.
Cut the acts of the story to the track's structure (`studio_beats` gives the grid).

## Sound effects
`events` with `"sfx": "pop" | "click" | "whoosh"`; scene changes get a soft whoosh (`"transition_whoosh": false` to stop).

## Loudness
The mix is normalised to −14 LUFS with peaks at or below −1.5 dBTP (social platforms' target), and `studio_check` passes a true peak of −1.0 dBTP or lower; `studio_render`
re-normalises after AAC encoding; `studio_check` measures it (±1 LU).
