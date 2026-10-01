# The score file: music as precise, checkable data

Write music as data, not as code and not as audio. A tool turns the file into sound. Every note gets an exact
musical position, bars can be locked to picture cues, the file is validated before anything plays, and the same
file always renders to the same bytes. This is what makes code-to-video music precise in a way generated audio
is not.

The format is renderer-neutral: any tool that plays General MIDI through a SoundFont can implement it. In Synergy
Studio the file is `src/score.json`. Check the tool's own reference for its exact field names before writing one.

## Shape
```json
{
  "length": 36,
  "tempo": {"bpm": 104, "meter": "4/4", "swing": 0.5, "max_stretch": 0.06},
  "anchors": [{"bar": 1, "at": 0.5}, {"bar": 9, "at": "cue:drop"}],
  "font": "musescore-lite",
  "tracks": {
    "drums": {"kit": "standard", "gain_db": -2, "grids": [
      {"bars": "1-8",  "kick": "x.....x.x.......", "rim": "x..x..x.x..x..x.", "shaker": "oxoxoxoxoxoxoxox"},
      {"bars": "9-16", "kick": "x.....x.x.....x.", "rim": "x..x..x.x..x..x.", "shaker": "oxoxoxoxoxoxoxox", "conga_hi": "..x....x..x...o."}]},
    "bass": {"program": 33, "gain_db": -3, "notes": [["9:1", "A1", "1/8"], ["9:2:3", "A1", "1/16"], ["9:3", "C2", "1/8"]]},
    "keys": {"program": 4, "octave": 4, "rhythm": "..x...x...x...x.", "chords": [["1:1", "Am9", "1/1"], ["2:1", "G", "1/1"]]},
    "lead": {"program": 108, "notes": [["9:1", "E5", "1/8", 110], ["9:2:3", "C5", "1/8"]]}
  },
  "hits": [{"at": "cue:drop", "sound": "impact"}]
}
```

## Time
- **Musical positions** are `"bar:beat:sixteenth"`, all counted from 1 (`"9:1"` is bar 9's downbeat; `"9:2:3"` is the
  "and" of beat 2). Never type seconds for a musical note.
- **Durations** are fractions of a whole note (`"1/16"`, `"1/8"`, `"1/4"`, `"1/2"`, `"1/1"`) or beats (`"3b"`).
- **Anchors lock the music to the picture:**
  - One anchor places bar 1, so a later bar lands where the tempo puts it.
  - Two anchors make the tool solve the tempo so that both bars land exactly on their times. The solved tempo
    must stay within `max_stretch` (default 6%) of `bpm`, or the file is refused with the tempo it would need.
  - **Pick the bar numbers so the drop, the chorus or the logo moment starts on a downbeat at the picture's cue.**
    This is the single most important precision move.
- **`at` takes** a number of seconds or a name from the project's timing data: `"cue:<name>"` with a cue sheet, or the
  tool's own form for scene events. An unknown name is an error, never a guess.
- **Swing** is 0.5 (straight) to 0.75 and delays the off sixteenths. Use 0.56–0.62 for hip-hop and lo-fi.

## Tracks
- **Drums:** `"kit"` is one of `standard`, `room`, `power`, `electronic`, `tr808`, `jazz`, `brush`, `orchestra`. `grids` are
  16-step strings per bar for a bar range: `x` hit, `X` accent, `o` ghost, `.` rest. Exactly 16 characters.
- **Drum names:**

  | Group | Names |
  |---|---|
  | Kicks | `kick` `kick2` |
  | Snares and claps | `snare` `rim` `clap` `esnare` |
  | Hi-hats | `chh` `phh` `ohh` |
  | Toms | `tom_lo` `tom_mid` `tom_hi` |
  | Cymbals | `crash` `ride` `splash` |
  | Hand percussion | `tamb` `cowbell` `bongo_hi` `bongo_lo` `conga_hi` `conga_open` `conga_lo` `agogo` `shaker` `clave` `wood_hi` `wood_lo` `triangle` |

  (General MIDI notes in gm-map.md.)
- **Pitched:** `"program"` is the 0-based General MIDI number (gm-map.md).
  - `notes`: `[position, pitch or [pitches], duration, velocity?]`. Pitches are names like `A2`, `C#4`, `Bb3`; middle C is `C4`.
  - `chords`: `[position, symbol, duration]`.
    - Symbols are a root plus one of `` (major), `m`, `7`, `m7`, `maj7`, `m9`, `maj9`, `9`, `6`, `m6`, `sus2`, `sus4`, `dim` or `add9`.
    - `octave` sets the root's octave.
    - `rhythm` (16 steps) repeats the chord on those steps within its duration (skanks, stabs); without it the chord is held.
- **Mix per track:** `gain_db`. `humanize` sets the velocity spread, default 8; it is deterministic, never random.

## Hits (sound design locked to cues)
- `{"at": "cue:slam", "sound": "impact", "offset": 0}`.
- **Recipes:**
  - `impact`: orchestra hit, timpani and crash;
  - `sting`: brass, a bright pad and crash.
  - Tools may add more, for example `riser`, which ends on `at`, and `whoosh`, centred on `at`. An unknown recipe is refused.
- Use percussive layers for the moment itself. Strings and pads take 80–230 ms to swell (measured), so start them earlier.

## The tool's report (read it every time)
A render prints:
- the solved tempo and the time of bar 1;
- every anchor's bar time against its target;
- every hit's time;
- the note count;
- the raw peak before normalising.

Treat any anchor that is not exact, any refused field, or a raw peak over 1.0 that was not normalised as a bug to
fix in the file, not in the audio.

## Verified with a prototype (2026-10-01; tinysoundfont 0.3.7, FluidR3 and MuseScore General Lite)
- Two anchors solved 104 BPM to 103.7838 BPM, and bar 9 landed at 19.0000 s, exactly on its cue.
- 60 kicks over 15 bars each started 2.29 ms after their scheduled time: the kick sample's own attack, the same for
  every hit (zero jitter).
- A 36 s Afrobeats arrangement with 656 notes rendered in 3.0 s (FluidR3) or 4.4 s (MuseScore Lite).
- Two renders of the same file were byte-identical.
- The file was refused, with a message that names the fix, for:
  - a tempo stretch that was too big;
  - an unknown drum name;
  - a grid that was not 16 steps;
  - an unknown chord.
