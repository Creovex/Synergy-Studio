"""src/score.json: music written as data, checked and compiled to note events. No audio here (instruments.py plays them).

The format is the music-for-picture skill's references/score-format.md:
  {"tempo": {"bpm": 104, "meter": "4/4", "swing": 0.5, "max_stretch": 0.06},
   "anchors": [{"bar": 1, "at": 0.5}, {"bar": 9, "at": "cue:drop"}],
   "font": "musescore-lite", "seed": 1, "reverb": "room",
   "tracks": {"drums": {"kit": "standard", "grids": [{"bars": "1-8", "kick": "x.....x.x......."}]},
              "bass": {"program": 33, "notes": [["9:1", "A1", "1/8"]]},
              "keys": {"program": 4, "octave": 4, "rhythm": "..x...x...x...x.", "chords": [["1:1", "Am9", "1/1"]]}},
   "hits": [{"at": "s2.slam", "sound": "impact"}]}

Times named in "at" come from the project's timing: seconds, "cue:<name>" (project.json "cues"), "<scene>.<event>"
(project.json "events"), "<scene>.start" and "<scene>.end". An unknown name is an error, never a guess.

Every problem is collected and raised as one ScoreError whose lines each name the fix. Humanising comes from a hash of the
seed, never from a random generator, so the same file always gives the same events.
"""
import hashlib
import json
import math
import re

import toys

KITS = {"standard": 0, "room": 8, "power": 16, "electronic": 24, "tr808": 25, "jazz": 32, "brush": 40, "orchestra": 48}
DRUMS = {"kick": 36, "kick2": 35, "snare": 38, "rim": 37, "clap": 39, "esnare": 40, "chh": 42, "phh": 44, "ohh": 46,
         "tom_lo": 45, "tom_mid": 48, "tom_hi": 50, "crash": 49, "ride": 51, "splash": 55, "tamb": 54, "cowbell": 56,
         "bongo_hi": 60, "bongo_lo": 61, "conga_hi": 62, "conga_open": 63, "conga_lo": 64, "agogo": 67, "shaker": 70,
         "clave": 75, "wood_hi": 76, "wood_lo": 77, "triangle": 81}
DRY_DRUMS = {35, 36}                                  # kicks stay out of the reverb
DRY_PROGRAMS = range(32, 40)                          # the basses stay out of the reverb
CHORDS = {"": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "m7": [0, 3, 7, 10], "maj7": [0, 4, 7, 11],
          "m9": [0, 3, 7, 10, 14], "maj9": [0, 4, 7, 11, 14], "9": [0, 4, 7, 10, 14], "6": [0, 4, 7, 9], "m6": [0, 3, 7, 9],
          "sus2": [0, 2, 7], "sus4": [0, 5, 7], "dim": [0, 3, 6], "add9": [0, 4, 7, 14]}
GRID_VELOCITY = {"x": 100, "X": 120, "o": 45}
REVERBS = {"none": 0.0, "room": 0.8, "hall": 2.0}     # decay time in seconds
HIT_SOUNDS = ("impact", "sting", "roll")                # real instruments (SoundFont); toys.HITS are the cartoon ones
ALL_HITS = HIT_SOUNDS + tuple(toys.HITS)
TOP_FIELDS = {"length", "tempo", "anchors", "font", "seed", "reverb", "tracks", "hits"}
TEMPO_FIELDS = {"bpm", "meter", "swing", "max_stretch"}
DRUM_FIELDS = {"kit", "gain_db", "humanize", "grids", "pan"}
PITCHED_FIELDS = {"program", "bank", "gain_db", "humanize", "octave", "rhythm", "notes", "chords", "bend_range", "bends", "pan"}
SYNTH_FIELDS = {"synth", "gain_db", "humanize", "octave", "rhythm", "notes", "chords", "pan"}
TOY_DRUMS = [d for d, key in DRUMS.items() if key in toys.KIT]
HIT_FIELDS = {"at", "sound", "offset", "gain_db", "pitch"}
DEFAULT_STRETCH = 0.06
DEFAULT_HUMANIZE = 8
CHANNELS = 16


class ScoreError(Exception):
    """Every problem found in the score file, one line each."""

    def __init__(self, problems):
        super().__init__("\n".join(problems))
        self.problems = list(problems)


# ---------------------------------------------------------------- small readers
def pitch_number(name):
    """"C4" is 60 (middle C), "A1" 33, "Bb3" 58, "C#4" 61; None when it is not a pitch name."""
    m = re.fullmatch(r"([A-Ga-g])([#b]?)(-?\d)", str(name).strip())
    if not m:
        return None
    pc = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}[m.group(1).lower()] + {"#": 1, "b": -1, "": 0}[m.group(2)]
    n = 12 * (int(m.group(3)) + 1) + pc
    return n if 0 <= n <= 127 else None


def chord_notes(symbol, octave):
    """The MIDI notes of a chord symbol with its root in `octave` ("Am9", 4); None when the symbol is unknown."""
    m = re.fullmatch(r"([A-G][#b]?)(.*)", str(symbol).strip())
    if not m or m.group(2) not in CHORDS:
        return None
    root = pitch_number(f"{m.group(1)}{octave}")
    if root is None:
        return None
    notes = [root + i for i in CHORDS[m.group(2)]]
    return notes if max(notes) <= 127 else None


def beats_per_bar(meter):
    m = re.fullmatch(r"(\d+)/4", str(meter))
    return int(m.group(1)) if m and 1 <= int(m.group(1)) <= 12 else None


def position_beats(pos, bpb):
    """"bar:beat:sixteenth" (each from 1) as beats from bar 1's downbeat; None when it cannot be read."""
    parts = str(pos).split(":")
    if not 1 <= len(parts) <= 3 or not all(p.isdigit() for p in parts):
        return None
    bar, beat, six = (int(p) for p in parts + ["1"] * (3 - len(parts)))
    if bar < 1 or not 1 <= beat <= bpb or not 1 <= six <= 4:
        return None
    return (bar - 1) * bpb + (beat - 1) + (six - 1) / 4


def duration_beats(text):
    """"1/8" (a fraction of a whole note) or "3b" (beats) as beats; None when it cannot be read."""
    s = str(text).strip()
    m = re.fullmatch(r"(\d+(?:\.\d+)?)b", s)
    if m:
        return float(m.group(1)) if float(m.group(1)) > 0 else None
    m = re.fullmatch(r"(\d+)/(\d+)", s)
    if m and int(m.group(1)) > 0 and int(m.group(2)) in (1, 2, 3, 4, 6, 8, 12, 16, 24, 32):
        return 4 * int(m.group(1)) / int(m.group(2))
    return None


def bar_range(text, label, problems):
    m = re.fullmatch(r"(\d+)(?:-(\d+))?", str(text).strip())
    if not m or int(m.group(1)) < 1 or (m.group(2) and int(m.group(2)) < int(m.group(1))):
        problems.append(f'{label}: "bars" must be a bar or a range such as "1-8", not {json.dumps(text)}')
        return []
    return list(range(int(m.group(1)), int(m.group(2) or m.group(1)) + 1))


def unit(seed, *key):
    """A number in [0, 1) from the seed and a key: the same inputs always give the same number."""
    h = hashlib.blake2b(json.dumps([seed, *key]).encode(), digest_size=8).digest()
    return int.from_bytes(h, "big") / 2 ** 64


def humanized(velocity, spread, seed, *key):
    return max(1, min(127, round(velocity + (unit(seed, *key) - 0.5) * 2 * spread)))


def swung(beats, swing):
    """Delays the off sixteenths (the 2nd and 4th of each beat): swing 0.5 is straight, 0.6 a lazy hip hop feel."""
    frac = beats - math.floor(beats)
    if abs(frac - 0.25) < 1e-9 or abs(frac - 0.75) < 1e-9:
        return beats + (swing - 0.5) * 0.5
    return beats


# ---------------------------------------------------------------- names of times in the project
def time_names(timing):
    """Every name a score may use for a time, from timing.json's data: {"cue:slam": 21.4, "s2.drop": 7.9, "s2.start": 6.0}."""
    names = {}
    for sid, t in (timing.get("T") or {}).items():
        names[f"{sid}.start"] = float(t["start"])
        names[f"{sid}.end"] = float(t["end"])
    for sid, evs in (timing.get("EV") or {}).items():
        base = float(timing["T"][sid]["vo"])          # events count from the scene's narration start (the scene start without a voice)
        for name, off in evs.items():
            names[f"{sid}.{name}"] = round(base + float(off), 6)
    for name, t in (timing.get("CUE") or {}).items():
        names[f"cue:{name}"] = float(t)
    return names


def resolve_time(value, names, label, problems):
    if isinstance(value, bool):
        value = None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value in names:
        return names[value]
    known = ", ".join(sorted(names)) or "none yet: add cues or events to project.json"
    problems.append(f'{label}: {json.dumps(value)} is not a time. Use seconds, or one of: {known}')
    return None


# ---------------------------------------------------------------- tempo
def solve_tempo(tempo, anchors, bpb):
    """(seconds per beat, time of bar 1) from the anchors. Raises ScoreError when the anchors need too big a stretch."""
    bpm = float(tempo["bpm"])
    stretch = float(tempo.get("max_stretch", DEFAULT_STRETCH))
    if not anchors:
        return 60 / bpm, 0.0
    if len(anchors) == 1:
        (bar, at), = anchors
        return 60 / bpm, at - (bar - 1) * bpb * 60 / bpm
    (b1, t1), (b2, t2) = sorted(anchors)
    if b1 == b2 or t2 <= t1:
        raise ScoreError([f"anchors: two anchors name bar {b1}: anchor two different bars" if b1 == b2 else
                          f"anchors: bar {b2} must come after bar {b1} in time ({t1:.3f} s and {t2:.3f} s)"])
    spb = (t2 - t1) / ((b2 - b1) * bpb)
    need = 60 / spb
    if abs(need / bpm - 1) > stretch + 1e-12:
        raise ScoreError([f"anchors: bar {b1} at {t1:.3f} s and bar {b2} at {t2:.3f} s need {need:.2f} BPM, "
                          f"{100 * (need / bpm - 1):+.1f}% from bpm {bpm:g} (max_stretch allows {100 * stretch:.0f}%). "
                          f"Set bpm near {need:.1f}, or anchor other bars"])
    return spb, t1 - (b1 - 1) * bpb * spb


# ---------------------------------------------------------------- the checked file
def check_fields(obj, allowed, label, problems):
    if not isinstance(obj, dict):
        problems.append(f"{label} must be an object")
        return False
    for k in obj:
        if k not in allowed:
            problems.append(f'{label}: unknown field "{k}" (allowed: {", ".join(sorted(allowed))})')
    return True


def number_in(obj, key, lo, hi, default, label, problems):
    v = obj.get(key, default)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        problems.append(f'{label}: "{key}" must be a number from {lo} to {hi}, not {json.dumps(v)}')
        return default
    return v


def read_tempo(score, problems):
    tempo = score.get("tempo")
    if not check_fields(tempo, TEMPO_FIELDS, "tempo", problems):
        return None, None
    if "bpm" in tempo:
        bpm = number_in(tempo, "bpm", 40, 240, None, "tempo", problems)
    else:
        bpm = None
        problems.append('tempo: "bpm" is missing, for example "bpm": 104')
    checked = {"bpm": bpm,                                   # only checked values go on: a bad one is a problem, never a crash
               "swing": number_in(tempo, "swing", 0.5, 0.75, 0.5, "tempo", problems),
               "max_stretch": number_in(tempo, "max_stretch", 0, 0.25, DEFAULT_STRETCH, "tempo", problems)}
    bpb = beats_per_bar(tempo.get("meter", "4/4"))
    if bpb is None:
        problems.append(f'tempo: "meter" must be beats over 4, such as "4/4" or "3/4", not {json.dumps(tempo.get("meter"))}')
    return checked, bpb


def read_anchors(score, names, problems):
    out = []
    for i, a in enumerate(score.get("anchors") or []):
        label = f"anchors[{i}]"
        if not check_fields(a, {"bar", "at"}, label, problems):
            continue
        if not isinstance(a.get("bar"), int) or isinstance(a.get("bar"), bool) or a["bar"] < 1:
            problems.append(f'{label}: "bar" must be a bar number from 1')
            continue
        t = resolve_time(a.get("at"), names, label, problems)
        if t is not None:
            out.append((a["bar"], t))
    if len(out) > 2:
        problems.append("anchors: give one or two anchors (one places bar 1; two solve the tempo)")
        return out[:1]                                       # the error stands; one anchor lets the rest of the file be checked
    return out


def load_score(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise ScoreError([f"src/score.json is not valid JSON ({e.msg}: line {e.lineno} column {e.colno}). Fix the file (a comma, quote or bracket is usually missing)"])


# ---------------------------------------------------------------- compiling
class Compiler:
    """Turns the checked file into events: notes (t, channel, key, velocity, length, dry, gain, group) and controls (t, channel, kind,
    value). `dry` keeps a note out of the reverb; `gain` is a linear level the renderer applies exactly (a hit's gain_db)."""

    def __init__(self, score, names, problems):
        self.score, self.names, self.problems = score, names, problems
        self.seed = score.get("seed", 1)
        self.channels = {}                   # (bank, preset, is_drums, track) -> channel
        self.programs = []                   # [(channel, bank, preset, is_drums, label)]
        self.notes, self.controls, self.hits = [], [], []
        self.gain, self.group = 1.0, ""            # the current track's linear gain and name (the renderer plays each group alone)
        self.pan, self.toy, self.toys = 0.0, None, []   # self.toy: None (SoundFont), "kit" or a toy voice name

    def channel(self, bank, preset, drums, owner, label):
        key = (bank, preset, drums, owner)
        if key not in self.channels:
            if len(self.channels) >= CHANNELS:
                self.problems.append(f"{label}: more than {CHANNELS} instruments (tracks plus hit layers): merge tracks that share an instrument")
                return None
            ch = len(self.channels)
            self.channels[key] = ch
            self.programs.append((ch, bank, preset, drums, label))
        return self.channels[key]

    def at(self, beats):
        return self.t0 + swung(beats, self.swing) * self.spb

    def note(self, beats, ch, key, vel, length_beats, dry=False):
        if self.toy:                               # a toy sound: made by toys.py, not the SoundFont
            t = self.at(beats)
            kind = "kit" if self.toy == "kit" else "voice"
            self.toys.append({"kind": kind, "name": self.toy, "key": key, "vel": vel, "length": length_beats * self.spb, "t": t,
                              "start": t, "dry": key in toys.DRY_KIT if kind == "kit" else self.toy in toys.DRY_VOICES,
                              "gain": self.gain, "group": self.group, "pan": self.pan})
            return
        if ch is not None:                         # None: the track already has a problem; its notes are still checked
            self.notes.append((self.at(beats), ch, key, vel, length_beats * self.spb, dry, self.gain, self.group))

    def track_gain(self, name, track, ch, label):
        """The track's gain is applied exactly to its own render pass (a font's quiet piano can be raised); pan is the channel's."""
        gain = number_in(track, "gain_db", -40, 24, 0, label, self.problems)
        pan = number_in(track, "pan", -1, 1, 0, label, self.problems)
        self.gain, self.group, self.pan = round(10 ** (gain / 20), 6), name, pan
        if ch is not None:
            self.controls.append((-1.0, ch, "cc", (10, round(64 + pan * 63))))

    def drum_track(self, name, track):
        label = f'tracks.{name}'
        kit = track.get("kit")
        ch = None
        self.toy = "kit" if kit == "toy" else None
        if kit == "toy":
            pass                                   # the toy kit is made by toys.py; it needs no channel
        elif kit not in KITS:                      # still check the grids, so every problem of the track is listed at once
            self.problems.append(f'{label}: unknown kit {json.dumps(kit)} (kits: {", ".join(KITS)}, or "toy")')
        else:
            ch = self.channel(128, KITS[kit], True, name, label)
        self.track_gain(name, track, ch, label)
        spread = number_in(track, "humanize", 0, 40, DEFAULT_HUMANIZE, label, self.problems)
        steps = 4 * self.bpb
        for gi, grid in enumerate(track.get("grids") or []):
            glabel = f"{label}.grids[{gi}]"
            if not isinstance(grid, dict):
                self.problems.append(f"{glabel} must be an object")
                continue
            bars = bar_range(grid.get("bars"), glabel, self.problems)
            for drum, pattern in grid.items():
                if drum == "bars":
                    continue
                if drum not in DRUMS:
                    self.problems.append(f'{glabel}: unknown drum "{drum}" (drums: {", ".join(DRUMS)})')
                    continue
                if self.toy and DRUMS[drum] not in toys.KIT:
                    self.problems.append(f'{glabel}: the toy kit has no "{drum}" (toy drums: {", ".join(TOY_DRUMS)})')
                    continue
                if not isinstance(pattern, str) or len(pattern) != steps:
                    self.problems.append(f'{glabel}.{drum}: a grid is exactly {steps} steps of x (hit), X (accent), o (ghost) and . (rest); '
                                         f'{json.dumps(pattern)} has {len(pattern) if isinstance(pattern, str) else "no"} steps')
                    continue
                if set(pattern) - set("xXo."):
                    self.problems.append(f'{glabel}.{drum}: {json.dumps(pattern)} has {", ".join(repr(c) for c in sorted(set(pattern) - set("xXo.")))}; '
                                         'a step is x (hit), X (accent), o (ghost) or . (rest)')
                    continue
                for bar in bars:
                    for step, c in enumerate(pattern):
                        if c == ".":
                            continue
                        beats = (bar - 1) * self.bpb + step / 4
                        vel = humanized(GRID_VELOCITY[c], spread, self.seed, name, drum, bar, step)
                        self.note(beats, ch, DRUMS[drum], vel, 0.25, dry=DRUMS[drum] in DRY_DRUMS)

    def synth_track(self, name, track):
        """A toy instrument track: the same notes, chords and rhythm as a SoundFont track, played by toys.py."""
        label = f'tracks.{name}'
        voice = track.get("synth")
        if voice not in toys.VOICES:
            self.problems.append(f'{label}: unknown synth {json.dumps(voice)} (toy instruments: {", ".join(toys.VOICES)})')
            return
        self.toy = voice
        self.track_gain(name, track, None, label)
        spread = number_in(track, "humanize", 0, 40, DEFAULT_HUMANIZE, label, self.problems)
        for i, n in enumerate(track.get("notes") or []):
            self.one_note(name, label, f"notes[{i}]", n, None, spread, False)
        octave = number_in(track, "octave", 0, 8, 4, label, self.problems)
        rhythm = track.get("rhythm")
        if rhythm is not None and (not isinstance(rhythm, str) or len(rhythm) != 4 * self.bpb or set(rhythm) - set("xXo.")):
            self.problems.append(f'{label}: "rhythm" is exactly {4 * self.bpb} steps of x, X, o and .')
            rhythm = None
        for i, c in enumerate(track.get("chords") or []):
            self.one_chord(name, label, f"chords[{i}]", c, None, spread, False, octave, rhythm)

    def pitched_track(self, name, track):
        label = f'tracks.{name}'
        prog, bank = track.get("program"), track.get("bank", 0)
        bad_bank = isinstance(bank, bool) or not isinstance(bank, int) or not 0 <= bank <= 127
        if bad_bank:
            self.problems.append(f'{label}: "bank" must be a whole number from 0 to 127 (leave it out for General MIDI, bank 0)')
        if not isinstance(prog, int) or isinstance(prog, bool) or not 0 <= prog <= 127:
            self.problems.append(f'{label}: "program" must be a General MIDI program from 0 to 127 (gm-map.md), or give "kit" for drums')
            return
        if bad_bank:
            return
        ch = self.channel(bank, prog, False, name, label)
        if ch is None:
            return
        self.track_gain(name, track, ch, label)
        spread = number_in(track, "humanize", 0, 40, DEFAULT_HUMANIZE, label, self.problems)
        dry = prog in DRY_PROGRAMS
        rng = number_in(track, "bend_range", 1, 24, 2, label, self.problems)
        if "bend_range" in track:
            self.controls.append((-1.0, ch, "bend_range", float(rng)))
        for i, n in enumerate(track.get("notes") or []):
            self.one_note(name, label, f"notes[{i}]", n, ch, spread, dry)
        octave = number_in(track, "octave", 0, 8, 4, label, self.problems)
        rhythm = track.get("rhythm")
        if rhythm is not None and (not isinstance(rhythm, str) or len(rhythm) != 4 * self.bpb or set(rhythm) - set("xXo.")):
            self.problems.append(f'{label}: "rhythm" is exactly {4 * self.bpb} steps of x, X, o and .')
            rhythm = None
        for i, c in enumerate(track.get("chords") or []):
            self.one_chord(name, label, f"chords[{i}]", c, ch, spread, dry, octave, rhythm)
        for i, b in enumerate(track.get("bends") or []):
            self.one_bend(label, f"bends[{i}]", b, ch, rng)

    def one_note(self, name, label, where, n, ch, spread, dry):
        if not isinstance(n, list) or not 3 <= len(n) <= 4:
            self.problems.append(f'{label}.{where}: a note is [position, pitch or [pitches], duration, velocity?], for example ["9:1", "A1", "1/8"]')
            return
        beats, length = position_beats(n[0], self.bpb), duration_beats(n[2])
        pitches = n[1] if isinstance(n[1], list) else [n[1]]
        keys = [pitch_number(p) for p in pitches]
        vel = n[3] if len(n) == 4 else 100
        if beats is None:
            self.problems.append(f'{label}.{where}: position {json.dumps(n[0])} is not "bar:beat:sixteenth" (each from 1, beat at most {self.bpb})')
        if length is None:
            self.problems.append(f'{label}.{where}: duration {json.dumps(n[2])} is not a fraction such as "1/8" or beats such as "3b"')
        if None in keys or not keys:
            self.problems.append(f'{label}.{where}: {json.dumps(n[1])} is not a pitch name such as "A2", "C#4" or "Bb3"')
        if isinstance(vel, bool) or not isinstance(vel, int) or not 1 <= vel <= 127:
            self.problems.append(f"{label}.{where}: velocity must be 1 to 127")
            return
        if beats is None or length is None or None in keys or not keys:
            return
        for j, key in enumerate(keys):
            self.note(beats, ch, key, humanized(vel, spread, self.seed, name, where, j), length, dry)

    def one_chord(self, name, label, where, c, ch, spread, dry, octave, rhythm):
        if not isinstance(c, list) or len(c) != 3:
            self.problems.append(f'{label}.{where}: a chord is [position, symbol, duration], for example ["1:1", "Am9", "1/1"]')
            return
        beats, length, keys = position_beats(c[0], self.bpb), duration_beats(c[2]), chord_notes(c[1], int(octave))
        if beats is None:
            self.problems.append(f'{label}.{where}: position {json.dumps(c[0])} is not "bar:beat:sixteenth"')
        if length is None:
            self.problems.append(f'{label}.{where}: duration {json.dumps(c[2])} is not a fraction such as "1/1" or beats such as "2b"')
        if keys is None:
            self.problems.append(f'{label}.{where}: unknown chord {json.dumps(c[1])}. A chord is a root (C, F#, Bb) plus one of: '
                                 + ", ".join(repr(q) for q in CHORDS) + ' (for example "Am9", "G", "Fmaj7")')
        if beats is None or length is None or keys is None:
            return
        if rhythm is None:
            hits = [(beats, length, 100)]
        else:                                          # the rhythm repeats bar by bar inside the chord's length
            hits, step = [], 0
            while step / 4 < length - 1e-9:
                b = beats + step / 4
                c_ = rhythm[int(round((b % self.bpb) * 4)) % len(rhythm)]
                if c_ != ".":
                    hits.append((b, min(0.25, length - step / 4), GRID_VELOCITY[c_]))
                step += 1
        for k, (b, ln, v) in enumerate(hits):
            for j, key in enumerate(keys):
                self.note(b, ch, key, humanized(v, spread, self.seed, name, where, k, j), ln, dry)

    def one_bend(self, label, where, b, ch, rng):
        """[position, semitones, duration?]: glides from the current bend to `semitones` over the duration (a jump without one)."""
        if not isinstance(b, list) or not 2 <= len(b) <= 3 or isinstance(b[1], bool) or not isinstance(b[1], (int, float)):
            self.problems.append(f'{label}.{where}: a bend is [position, semitones, duration?], for example ["4:1", -12, "1/2"]')
            return
        beats = position_beats(b[0], self.bpb)
        length = duration_beats(b[2]) if len(b) == 3 else 0
        if beats is None or length is None:
            self.problems.append(f'{label}.{where}: position or duration cannot be read')
            return
        if abs(b[1]) > rng:
            self.problems.append(f'{label}.{where}: a bend of {b[1]} semitones needs "bend_range" of at least {abs(b[1])} (it is {rng})')
            return
        self.controls.append((self.at(beats), ch, "bend_to", (float(b[1]), length * self.spb, float(rng))))

    def hit(self, i, h):
        label = f"hits[{i}]"
        if not check_fields(h, HIT_FIELDS, label, self.problems):
            return
        t = resolve_time(h.get("at"), self.names, label, self.problems)
        if h.get("sound") not in ALL_HITS:
            self.problems.append(f'{label}: unknown sound {json.dumps(h.get("sound"))} (real instruments: {", ".join(HIT_SOUNDS)}; '
                                 f'toy: {", ".join(toys.HITS)})')
            return
        offset = number_in(h, "offset", -2, 2, 0, label, self.problems)
        gain = number_in(h, "gain_db", -40, 0, 0, label, self.problems)
        root = pitch_number(h.get("pitch", "C4"))
        if root is None or not 24 <= root <= 103:              # the recipes play two octaves under and over the pitch
            self.problems.append(f'{label}: "pitch" must be a pitch name from C1 to G7, such as "C4"')
            return
        if t is None:
            return
        t += offset
        self.hits.append({"sound": h["sound"], "at": h["at"], "t": round(t, 6)})
        g = round(10 ** (gain / 20), 6)               # applied to the hit's sound exactly; velocity would follow the font's curve
        if h["sound"] in toys.HITS:
            self.toys.append({"kind": "hit", "name": h["sound"], "key": root, "vel": 100, "length": toys.HIT_LENGTH[h["sound"]], "t": t,
                              "start": toys.hit_start(h["sound"], t), "dry": False, "gain": g, "group": "hits", "pan": 0.0})
            return
        vel = lambda v: max(1, min(127, round(v)))
        kit = self.channel(128, 0, True, "hits", label)
        if kit is None:
            return

        def add(prog, keys, v, secs):
            ch = self.channel(0, prog, False, "hits", label)
            if ch is not None:
                self.notes.extend((t, ch, k, vel(v), secs, False, g, "hits") for k in keys)
        if h["sound"] == "impact":                   # orchestra hit, a low timpani, a crash and a kick: all speak within 4 ms
            add(55, [root - 12], 120, 1.2)
            add(47, [root - 24], 120, 1.8)
            self.notes += [(t, kit, 49, vel(115), 2.0, False, g, "hits"), (t, kit, 36, vel(127), 0.5, True, g, "hits")]
        elif h["sound"] == "sting":                  # score-format.md: brass, a bright pad and a crash
            add(61, [root, root + 4, root + 7], 115, 1.4)
            add(88, [root + 12, root + 16, root + 19], 100, 1.6)
            self.notes.append((t, kit, 49, vel(110), 2.0, False, g, "hits"))
        else:                                        # roll: timpani 32nds rising for one second, ending on the hit
            n = 24
            ch = self.channel(0, 47, False, "hits", label)
            for k in range(n if ch is not None else 0):
                tk = t - (n - k) * (1.0 / n)
                self.notes.append((tk, ch, root - 24, vel(40 + 70 * k / n), 0.08, False, g, "hits"))
            add(47, [root - 24], 120, 1.8)
            self.notes.append((t, kit, 49, vel(118), 2.0, False, g, "hits"))


def compile_score(score, timing):
    """Checks the score and compiles it. Returns a dict: notes, controls, programs, hits, tempo facts, anchors, reverb, font.
    Raises ScoreError with every problem found."""
    problems = []
    if not check_fields(score, TOP_FIELDS, "score.json", problems):
        raise ScoreError(problems)
    names = time_names(timing)
    tempo, bpb = read_tempo(score, problems)
    anchors = read_anchors(score, names, problems)
    reverb = score.get("reverb", "room")
    if reverb not in REVERBS:
        problems.append(f'"reverb" must be one of {", ".join(REVERBS)}, not {json.dumps(reverb)}')
    seed = score.get("seed", 1)
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        problems.append('"seed" must be a whole number from 0 (another seed changes the humanising, not the notes)')
    length = score.get("length")
    if length is not None and (isinstance(length, bool) or not isinstance(length, (int, float)) or length <= 0):
        problems.append('"length" must be the music\'s length in seconds')
    tracks = score.get("tracks") or {}
    if not isinstance(tracks, dict):
        problems.append('"tracks" must be an object of named tracks')
        tracks = {}
    bpm = tempo.get("bpm") if isinstance(tempo, dict) else None
    if bpb is None or isinstance(bpm, bool) or not isinstance(bpm, (int, float)) or not 40 <= bpm <= 240:
        raise ScoreError(problems or ['tempo: "bpm" is missing'])          # nothing can be placed without a tempo
    try:
        spb, t0 = solve_tempo(tempo, anchors, bpb)
    except ScoreError as e:                                  # recorded; the tracks are still checked at the written tempo
        problems += e.problems
        spb, t0 = 60 / float(bpm), 0.0
    c = Compiler(score, names, problems)
    c.spb, c.t0, c.bpb, c.swing = spb, t0, bpb, tempo["swing"]
    for name, track in tracks.items():
        kind = "kit" if isinstance(track, dict) and "kit" in track else "synth" if isinstance(track, dict) and "synth" in track else "program"
        if not check_fields(track, {"kit": DRUM_FIELDS, "synth": SYNTH_FIELDS, "program": PITCHED_FIELDS}[kind], f"tracks.{name}", problems):
            continue
        {"kit": c.drum_track, "synth": c.synth_track, "program": c.pitched_track}[kind](name, track)
        c.toy = None
    for i, h in enumerate(score.get("hits") or []):
        c.hit(i, h)
    if not c.notes and not c.toys and not problems:
        problems.append('the score has no notes: add "tracks" (grids, notes or chords) or "hits" (a silent score is never played)')
    early = [n for n in c.notes if n[0] < -1e-9] + [(e["start"],) for e in c.toys if e["start"] < -1e-9]
    if early:
        problems.append(f"{len(early)} notes start before 0 s (the first at {min(n[0] for n in early):.3f} s): move a hit or roll later, "
                        "anchor bar 1 later, or start the music in a later bar")
    if problems:
        raise ScoreError(list(dict.fromkeys(problems)))
    bar_time = lambda bar: t0 + (bar - 1) * bpb * spb
    anchor_rows = [{"bar": a["bar"], "at": a["at"], "target_s": round(t, 6), "bar_s": round(bar_time(a["bar"]), 6)}
                   for a, (_, t) in zip(score.get("anchors") or [], anchors)]
    pitched = [name for name, track in tracks.items() if isinstance(track, dict) and "kit" not in track and (track.get("notes") or track.get("chords"))]
    return {"notes": sorted(c.notes), "toys": sorted(c.toys, key=lambda e: (e["start"], e["group"], e["kind"], e["key"])),
            "controls": c.controls, "programs": c.programs, "hits": c.hits, "pitched_tracks": pitched,
            "bpm": float(tempo["bpm"]), "bpm_solved": 60 / spb, "bar1_s": t0, "beats_per_bar": bpb, "anchors": anchor_rows,
            "reverb": reverb, "font": score.get("font"), "length": length, "seed": seed}
