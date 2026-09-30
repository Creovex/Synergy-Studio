# Voice, music and sound

## Voice (Kokoro v1.0, local)
`project.json`: `"voice"`, `"speed"` (default 0.95; 0.85–0.9 for a calm premium read, up to 1.05 for energy;
per scene too), `"lexicon"` for pronunciation. Check a brand name with `studio say <dir> "HAURA Scent"` and
send the WAV to the user. Keep `say` in normal spelling (captions come from it); put sound-alike spellings only
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
- `studio voice <dir> --only s3,s5` re-voices just those scenes.
- Kokoro is English-first. For Nigerian Pidgin or other accents there is no matching voice: write those
  lines as on-screen text, or use the user's own recorded voice (footage mode).

## Music (`"music"` in project.json)
- Generated (licence-free, made by audio.py): `warm` (96 BPM, pad + pluck), `calm` (72 BPM), `upbeat` (118 BPM), `none`.
- The user's own song: `{"file": "src/assets/song.mp3", "start": 47.3, "gain_db": -3}` plays from 47.3 s, ducked
  under the voice. Find a good section and the beat with `studio beats <dir> src/assets/song.mp3` (beats.json).
  Commercial songs can be muted in TikTok/Instagram paid promotion; say so to the user.
- Music always dips under the voice automatically (about 8 dB).

## Wordless films and original scores
`"mode": "film"`: no voice at all; scenes are `{"id", "start", "end"}` in seconds and `events` place the
sound effects. For music, use the user's licensed track, or write an original score as a small numpy script
that follows the acts of the story. Match the instruments to the moods: plucks for curiosity, low rumble and
thunder for fear, sparse piano with rain for loneliness, a shimmer for wonder, a groove for joy, a warm
chord to end. Render it to `src/assets/score.wav` and use it as `"music": {"file": "src/assets/score.wav"}`.
Example: `media/claude-and-syn-story/scripts/score.py` in the storage repository (seven acts, a 110 BPM
build). Keep it deterministic (fixed seeds) so a rebuild gives the same file.

## Sound effects
`events` with `"sfx": "pop" | "click" | "whoosh"`; scene changes get a soft whoosh (`"transition_whoosh": false` to stop).

## Loudness
The mix is normalised to −14 LUFS with peaks ≤ −1.5 dBTP (social platforms' target); `studio render`
re-normalises after AAC encoding; `studio check` measures it (±1 LU).
