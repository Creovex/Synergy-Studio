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
`"music": {"file": "src/assets/song.mp3", "start": 0}`), one of the generated beds, or the starter score.
**The starter score.** Write every hit (a slam, a knock, a word landing) once in project.json `cues`, then call
`studio_score`: it writes `src/assets/score.wav` with a soft bed and a short placeholder hit on every cue, at the
cue's time, and sets `"music"` to that file (a song of the user is left as it is). Then call `studio_audio`. The hits are placeholders that let you check timing and sync before the real music exists. You cannot write or run a score script of your own through the tools, so in
Claude Desktop the real score is the user's licensed track or the starter's hits: say so plainly, and when the
story needs more than hits, ask the user for a track or a composer's file.
Whichever you use, match the feeling to the act: plucks for curiosity, low rumble and thunder for fear, sparse
piano with rain for loneliness, a shimmer for wonder, a groove for joy, a warm chord to end. A generated bed is one
mood for the whole film: choose the one that fits the longest act (`calm` for lonely and wondering, `upbeat` for
joyful, `warm` for a gentle ending), or use those moods to brief the search for a track.
Cut the acts of the story to the track's structure (`studio_beats` gives the grid).

## Sound effects
`events` with `"sfx": "pop" | "click" | "whoosh"`; scene changes get a soft whoosh (`"transition_whoosh": false` to stop).

## Loudness
The mix is set to −14 LUFS (social platforms' target) through a gain and a 4x-oversampled true-peak limiter;
`studio_audio` and `studio_render` measure the result after the limiter and correct the gain until it is within
0.3 LU. `studio_check` measures the final file (±1 LU, true peak ≤ −1 dBTP).
A mix quieter than −70 LUFS (no music and no effects, or a nearly silent file) is kept silent, not raised, and
`studio_audio` says the video will have no sound; `studio_check` then fails loudness, which is right for a social video.
A mix too peaky to reach −14 within 1 LU after the limiter stops `studio_audio` with the reason and no mix: use a less
peaky track, softer hits or a lower `gain_db`.
A score full of hits (thuds, slams) has a high crest factor: the limiter has to take a lot off the peaks, and
`studio_audio` warns when that is over 6 dB. Then the hits sound flattened: use a quieter or less peaky track, or
fewer and softer hits. In a wordless film keep effects about 3 dB under the music's peaks; with a voice, no effect may
be more than 3 dB above the voice's usual level (`studio_audio` warns, and `studio_check` shows it as `sound balance`).
