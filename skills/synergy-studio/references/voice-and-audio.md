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

## Music: choose the engine first
Say which you chose and why in one line. Write a score only when the music carries meaning: a genre, an emotion, or
hits on the picture. Background music is the bed. All but the bed are written in the score file (below), and one score
may mix them.
| The video | Music |
|---|---|
| background: a calm, ambient or looping clip, a utility clip, a draft, any video where the music is only wallpaper | a generated bed: `calm`, `warm` or `upbeat`; do not write a score for it |
| cartoon, kids, toy-like, chiptune, retro game, very playful | **toy sounds**: `"synth"` tracks (`square` for chiptune, `pizz`, `musicbox`, `bell`), `"kit": "toy"` and cartoon hits (`boing`, `bonk`, `slide_down`, `splat`) |
| a genre (Afrobeats, amapiano, highlife, hip-hop, trap, lo-fi, R&B, house), warm, premium, documentary | **real instruments**: SoundFont programs and kits, with the genre recipe |
| cinematic, action, trailer | real orchestra (strings, brass, timpani, `impact`), plus toy `riser`, `whoosh` and `thud` for the effects |
| comedy, an animated playful film | real playful orchestra (pizzicato 45, clarinet 71, tuba 58, xylophone 13, woodblocks) with toy hits on the gags (`boing`, `bonk`, `slide_down`, `squeak`) |
| the user gave a track | their file; a score file may add timed hits (real or toy) on top, never a second melody |

## Music (`"music"` in project.json)
- Generated (licence-free, made by `studio_audio`): `warm` (96 BPM, pad + pluck), `calm` (72 BPM), `upbeat` (118 BPM), `none`.
- The user's own song: `{"file": "src/assets/song.mp3", "start": 47.3, "gain_db": -3}` plays from 47.3 s, ducked
  under the voice. Add the song with `studio_file_add`, then find a good section and the beat with `studio_beats` (`song: "src/assets/song.mp3"`; it writes beats.json).
  Commercial songs can be muted in TikTok/Instagram paid promotion; say so to the user.
- Music always dips under the voice automatically (about 8 dB).

## The score file (`src/score.json`): real instruments, locked to the picture
Write the music as data and the tools play it on sampled instruments (a General MIDI SoundFont), so every hit lands on
its frame and a rebuild gives the same bytes. How to compose it is the **music-for-picture** skill: read it with
`studio_reference` (`music-for-picture`, then `music-for-picture-score-format` for the file,
`music-for-picture-genres` for 13 genre recipes, `music-for-picture-action-sounds`, `music-for-picture-gm-map`).
- **Check it:** `studio_score` validates the file, solves the tempo from the anchors, renders it and reports the
  solved tempo, the time of bar 1, every anchor against its target (in samples), every hit, each track's peak, the note
  count and the raw peak. A refused file lists every problem with its fix; fix the file, never the audio. Read the
  report every time: a track more than 30 dB under the loudest is flagged as buried (fonts play some instruments far
  quieter than others; raise its `gain_db`). A key outside an instrument's samples would be silent, so it is refused.
- **Mix it:** `studio_audio` renders it again with the project's timing and mixes it at 48 kHz stereo. It replaces a
  generated bed; on a song file it plays on top and warns when it has notes (two pieces of music fight). Under a
  voice it ducks like the bed and sits 10 dB under the voice while it speaks.
- **Times in this tool** (the `at` of anchors and hits): seconds; `cue:<name>` (project.json `cues`); `<scene>.<event>`
  (project.json `events`, counted from the scene's narration start, or the scene start without a voice);
  `<scene>.start` and `<scene>.end`. An unknown name is refused with the list of names that exist.
- **Fields beyond the format:** `"seed"` (a whole number, default 1; another seed changes the humanising, never the
  times); `"reverb"`: `room` (default, 0.8 s), `hall` (2 s, cinematic) or `none` (kicks and basses always stay dry);
  per track `"gain_db"` (-40 to +24, exact), `"pan"` (-1 left to 1 right; a stereo sample keeps some width), `"bank"`,
  `"bend_range"` (1 to 24 semitones) and `"bends": [["4:1", -12, "1/2"]]` (glide to 12 semitones down over a half note;
  slides and the trombone "wah-wah"; a bend holds only until the next note of the track, which starts at normal pitch);
  hits `impact`, `sting` and `roll` (a timpani roll for one second ending on the hit), with `"pitch"` (default `C4`),
  `"offset"` (seconds) and `"gain_db"`. Meters are beats over 4; a grid has 4 steps per beat (16 in 4/4).
- **Sounds:** `"font"` is `musescore-lite` (installed by setup) or `fluidr3` when installed (`studio_setup_start` with
  `soundfont: "fluidr3"`); `studio_sounds` lists the programs and kits of a font. A program the font lacks is refused, never
  replaced. Without a SoundFont, `studio_score` stops and names the fix; it never plays silence.
- **Toy sounds** (made from oscillators and noise, no SoundFont needed):
  - a track `{"synth": "pizz", "notes": [...], "chords": [...]}` with the same positions, notes, chords, `rhythm`,
    `octave`, `gain_db`, `pan` and `humanize` as a real track (no `program`, no bends). Toy instruments:
    `pizz`, `bell`, `musicbox`, `whistle`, `pad`, `bass`, `stab`, `square` (`square` is the chiptune lead, `bass` stays dry);
  - drums `{"kit": "toy", "grids": [...]}`; the toy kit plays `kick`, `kick2`, `snare`, `rim`, `clap`, `esnare`, `chh`, `phh`, `ohh`, `tom_lo`, `tom_mid`, `tom_hi`, `crash`, `splash`, `shaker`, `wood_hi`, `wood_lo`;
  - hits `{"at": "cue:fall", "sound": "boing"}`: `boing`, `bonk`, `pop`, `squeak`, `splat`, `puff`, `slide_up`, `slide_down`, `tink`, `thud`, `nope`, `tweet`, `ring`, `thunder`
    start on their time; `whoosh` and `shimmer` are centred on it; `riser` ends on it. A hit's `"pitch"` sets the tone of
    `boing`, `pop`, `bonk`, the slides and `riser`.
- **What it cannot do:** vinyl crackle and tape wobble are not in the score file; the generated whoosh, pop and click
  of `events` and cue `sfx` still work beside it. The music ends with the video: `"length"` longer
  than the video is cut to it, and notes after the end are cut (the report counts them).

## Wordless films and scores
`"mode": "film"`: no voice at all; scenes are `{"id", "start", "end"}` in seconds and `events` place the
sound effects. For music, write a score file anchored to the cues, use the user's licensed track (add it with
`studio_file_add`, then `"music": {"file": "src/assets/song.mp3", "start": 0}`), or one of the generated beds.
**The starter score.** Without `src/score.json`, `studio_score` writes `src/assets/score.wav`: a soft bed and a short
placeholder hit on every cue, at the cue's time, and sets `"music"` to that file (a song of the user is left as it
is). The hits are placeholders that let you check timing and sync before the real music exists.
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
