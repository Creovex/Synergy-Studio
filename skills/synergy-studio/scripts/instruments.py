"""Plays a compiled score (score_file.py) on real sampled instruments from a General MIDI SoundFont, with tinysoundfont.

Run through the CLI:
  studio score <dir>     validates and renders src/score.json, prints the report (studio audio does the same, then mixes it)
  studio sounds          lists the installed font's programs and drum kits
Directly:  python instruments.py list [--font <id>] [--soundfonts <dir>]
           python instruments.py check <file.sf2|sf3>      (setup --soundfont: does the file load, how many presets)

Precision: events are sorted (a note off before a note on at the same sample) and the synth generates exactly up to each
event's sample, so every note starts on its own sample; nothing is stepped in fixed blocks. The synth runs at -8 dB
(an 808 kick peaks at 1.41 at 0 dB). tinysoundfont has no reverb, so a convolution reverb with a fixed noise impulse
follows; kicks and basses stay dry. The same file always renders to the same bytes.

The fonts live in <tool home>/soundfonts/ with fonts.json ({"default": id, "fonts": {id: {"file", "sha256"}}}) written by setup.
"""
import json
import pathlib
import sys
import time

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from score_file import ScoreError, compile_score, load_score, REVERBS  # noqa: E402

SR = 48000
SYNTH_GAIN_DB = -8
TAIL_S = 2.0                      # notes ring out after the last one
WET_LEVEL = 0.25                  # the reverb's level against the dry sound
PREDELAY_S = {"room": 0.012, "hall": 0.025}
BEND_STEP_S = 0.01                # a glide is applied in 10 ms steps
FLUSH_SAMPLES = SR // 10          # silence generated between passes, so no release tail crosses into the next
BURIED_DB = 30                    # a track whose peak is this far under the loudest track is reported as buried
CENTRE_BEND = 8192
SETUP_FIX = ("run studio setup (it downloads MuseScore General, about 40 MB), or download a General MIDI SoundFont "
             "(.sf2 or .sf3) and run studio setup --soundfont <that file>")


def default_soundfonts():
    return pathlib.Path(sys.prefix).resolve().parent / "soundfonts"   # <home>/venv -> <home>/soundfonts


def write_float_wav(path, x, sr=SR):
    """A 32 bit float WAV with only the fmt and data chunks. libsndfile adds a PEAK chunk holding the clock time of the
    write, so the same samples written a second apart gave different bytes; this file depends on the samples alone."""
    import struct
    data = np.ascontiguousarray(x, dtype="<f4").tobytes()
    ch = 1 if x.ndim == 1 else x.shape[1]
    fmt = struct.pack("<HHIIHH", 3, ch, sr, sr * ch * 4, ch * 4, 32)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(data)) + b"WAVE")
        f.write(b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data)


# ---------------------------------------------------------------- fonts
def installed_fonts(folder):
    """(default id, {id: path}) of the fonts setup installed; (None, {}) when there are none."""
    try:
        reg = json.loads((pathlib.Path(folder) / "fonts.json").read_text())
    except (OSError, json.JSONDecodeError):
        return None, {}
    listed = reg.get("fonts") if isinstance(reg, dict) and isinstance(reg.get("fonts"), dict) else {}
    fonts = {k: pathlib.Path(folder) / v["file"] for k, v in listed.items()
             if isinstance(v, dict) and isinstance(v.get("file"), str) and (pathlib.Path(folder) / v["file"]).is_file()}
    default = reg.get("default") if reg.get("default") in fonts else next(iter(fonts), None)
    return default, fonts


def find_font(folder, wanted=None):
    """(id, path) of the font to play. Raises ScoreError naming the fix when it is missing: never silence."""
    default, fonts = installed_fonts(folder)
    if not fonts:
        raise ScoreError([f"no SoundFont is installed, so the score cannot be played: {SETUP_FIX}"])
    key = wanted or default
    if key not in fonts:
        raise ScoreError([f'font {json.dumps(wanted)} is not installed (installed: {", ".join(fonts)}). Remove "font" to use '
                          f'{default}, or install it: studio setup --soundfont <id or file>'])
    return key, fonts[key]


def load_synth(path):
    import tinysoundfont                     # imported here, so projects without a score never need it
    synth = tinysoundfont.Synth(samplerate=SR, gain=SYNTH_GAIN_DB)
    return synth, synth.sfload(str(path))


def missing_presets(synth, sfid, programs, font_name):
    out = []
    for _, bank, preset, drums, label in programs:
        name = synth.sfpreset_name(sfid, bank, preset)
        if not name:                        # None when the font lacks it; an empty name counts as missing too
            what = f"drum kit {preset} (bank 128)" if drums else f"program {preset} (bank {bank})"
            out.append(f"{label}: {what} is not in {font_name}. Choose one that is (studio sounds lists them); nothing is substituted")
    return out


NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
SILENT = 10 ** (-100 / 20)        # a key quieter than -100 dBFS in its first 100 ms has no sample in the font


def silent_keys(synth, sfid, compiled, font_name):
    """Every key the score plays, sounded alone for 100 ms: a key outside an instrument's samples renders silence, so it is
    refused with its name and track instead of leaving a hole in the music."""
    labels = {ch: label for ch, _, _, _, label in compiled["programs"]}
    out = []
    set_up_channels(synth, sfid, compiled["programs"], [c for c in compiled["controls"] if c[2] == "cc"])
    for ch, key in sorted({(x[1], x[2]) for x in compiled["notes"]}):
        synth.sounds_off()
        synth.generate(FLUSH_SAMPLES)
        synth.noteon(ch, key, 100)
        peak = float(np.abs(np.frombuffer(synth.generate(SR // 10), dtype=np.float32)).max())
        synth.noteoff(ch, key)
        if peak < SILENT:
            out.append(f"{labels[ch]}: {NAMES[key % 12]}{key // 12 - 1} (key {key}) makes no sound in {font_name}, it is outside that "
                       "instrument's samples: move it an octave toward the middle or choose another program")
    synth.sounds_off()
    return out


# ---------------------------------------------------------------- events to samples
def note_events(notes, block=None):
    """[(sample, order, channel, key, velocity)]; order 0 = note off, 2 = note on, so an off comes first at the same sample.
    A note that starts while the same key still sounds on its channel ends there; two notes of one key starting on the same
    sample are one note (the longer, at the louder velocity), since a synth cannot release them separately. `block` steps
    every event to the next multiple of that many samples, the way a fixed block renderer would: only the timing test's
    falsifier uses it."""
    snap = (lambda s: s) if not block else (lambda s: -(-s // block) * block)
    by_key = {}
    for t, ch, key, vel, length, *_ in notes:
        on, off = snap(round(t * SR)), snap(round((t + length) * SR))
        same = by_key.setdefault((ch, key), {})
        prev = same.get(on)
        same[on] = [max(off, on + 1, prev[0] if prev else 0), max(vel, prev[1] if prev else 0)]
    out = []
    for (ch, key), starts in by_key.items():
        ons = sorted(starts)
        for i, on in enumerate(ons):
            off, vel = starts[on]
            if i + 1 < len(ons) and ons[i + 1] < off:
                off = ons[i + 1]
            out += [(on, 2, ch, key, vel), (off, 0, ch, key, 0)]
    return out


def bend_events(controls):
    """Glides as pitch wheel steps: [(sample, 1, channel, "bend", value)]. A glide starts at t and reaches its value at
    t + duration; a new glide on the channel cuts the running one off where it is."""
    out, glides = [], {}                       # channel -> [(sample, value)] of the glide in progress
    for t, ch, kind, value in sorted((c for c in controls if c[2] == "bend_to"), key=lambda c: c[0]):
        semis, secs, rng = value
        s0 = round(t * SR)
        running = [p for p in glides.get(ch, []) if p[0] < s0]
        start = running[-1][1] if running else CENTRE_BEND
        target = int(round(CENTRE_BEND + semis / rng * 8191))
        steps = max(1, int(secs / BEND_STEP_S)) if secs else 1
        points = [(round((t + k * secs / steps) * SR), max(0, min(16383, start + (target - start) * k // steps)))
                  for k in range(1 if not secs else 0, steps + 1)]
        out = [e for e in out if not (e[2] == ch and e[0] >= s0)] + [(s, 1, ch, "bend", v) for s, v in points]
        glides[ch] = running + points
    return out


def bend_resets(notes, controls):
    """A bend holds only until the next note of its track: each note on a bent channel starts at normal pitch, unless a glide
    on that channel is running at that moment (a slide written across the note)."""
    windows = {}
    for t, ch, kind, value in controls:
        if kind == "bend_to":
            windows.setdefault(ch, []).append((round(t * SR), round((t + value[1]) * SR)))
    out = []
    for x in notes:
        on = round(x[0] * SR)
        if x[1] in windows and not any(a <= on <= b for a, b in windows[x[1]]):
            out.append((on, 1, x[1], "bend", CENTRE_BEND))
    return out


def set_up_channels(synth, sfid, programs, controls):
    for ch, bank, preset, drums, _ in programs:
        synth.program_select(ch, sfid, bank, preset, drums)
        synth.pitchbend(ch, CENTRE_BEND)
    for _, ch, kind, value in controls:
        if kind == "cc":
            synth.control_change(ch, *value)
        elif kind == "bend_range":
            synth.pitchbend_range(ch, value)


def play(synth, events, n):
    """Generates n stereo samples, applying each event exactly at its sample."""
    out = np.zeros((n, 2), np.float32)
    cursor = 0
    for sample, order, ch, key, vel in sorted(events, key=lambda e: (e[0], e[1], e[2], str(e[3]))):
        if sample >= n:                        # after the end: never started, so nothing rings into the next pass
            break
        if sample > cursor:
            out[cursor:sample] = np.frombuffer(synth.generate(sample - cursor), dtype=np.float32).reshape(-1, 2)
            cursor = sample
        if order == 0:
            synth.noteoff(ch, key)
        elif order == 1:
            synth.pitchbend(ch, vel)
        else:
            synth.noteon(ch, key, vel)
    if n > cursor:
        out[cursor:] = np.frombuffer(synth.generate(n - cursor), dtype=np.float32).reshape(-1, 2)
    return out


# ---------------------------------------------------------------- reverb
def impulse(kind, seed):
    """A stereo noise impulse with an exponential decay. The noise comes from a fixed bit generator stream, so it never changes."""
    rt60 = REVERBS[kind]
    n = int(rt60 * SR)
    pre = int(PREDELAY_S[kind] * SR)
    raw = np.random.PCG64(seed).random_raw(2 * n)                 # raw 64 bit words: stable across numpy versions
    noise = (raw / 2.0 ** 63 - 1.0).reshape(2, n)
    decay = np.exp(-6.9 * np.arange(n) / (rt60 * SR))
    ir = np.zeros((2, pre + n))
    ir[:, pre:] = noise * decay
    return ir / np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))


def convolve(x, ir):
    size = 1 << int(np.ceil(np.log2(len(x) + ir.shape[1])))
    out = np.empty_like(x, dtype=np.float64)
    for c in range(2):
        y = np.fft.irfft(np.fft.rfft(x[:, c], size) * np.fft.rfft(ir[c], size), size)
        out[:, c] = y[: len(x)]
    return out


# ---------------------------------------------------------------- the whole render
def render(compiled, font_path, length_s, block=None, levels=None):
    """Stereo float32 at 48 kHz, length_s plus the tail. Raises ScoreError when a preset is missing from the font or a key
    has no sound in it. `levels`, when given, receives each track's peak in dBFS (the hits as "hits")."""
    synth, sfid = load_synth(font_path)
    name = pathlib.Path(font_path).name
    problems = missing_presets(synth, sfid, compiled["programs"], name)
    if problems:
        raise ScoreError(problems)
    problems = silent_keys(synth, sfid, compiled, name)
    if problems:
        raise ScoreError(problems)
    n = int(round((length_s + TAIL_S) * SR))
    bends = bend_events(compiled["controls"])

    def one_pass(notes):
        synth.sounds_off()                     # a fast release, not silence: run it out before the pass begins
        synth.generate(FLUSH_SAMPLES)
        set_up_channels(synth, sfid, compiled["programs"], compiled["controls"])
        return play(synth, bend_resets(notes, compiled["controls"]) + bends + note_events(notes, block), n).astype(np.float64)

    # one pass per track (and per hit gain), kicks and basses dry, the rest to the reverb; each scaled by its gain exactly
    dry, wet, peaks = np.zeros((n, 2)), np.zeros((n, 2)), {}
    for key in sorted({(x[7], x[6]) for x in compiled["notes"]}):
        part = np.zeros((n, 2))
        for is_dry in (True, False):
            notes = [x for x in compiled["notes"] if (x[7], x[6]) == key and x[5] == is_dry]
            if notes:
                p = key[1] * one_pass(notes)
                part += p
                if is_dry or compiled["reverb"] == "none":
                    dry += p
                else:
                    wet += p
        peak = float(np.abs(part).max())
        peaks[key[0]] = max(peaks.get(key[0], -200.0), round(20 * np.log10(max(peak, 1e-10)), 1))
    if levels is not None:
        levels.update(peaks)
    if compiled["reverb"] == "none":
        return dry.astype(np.float32)
    return (dry + wet + WET_LEVEL * convolve(wet, impulse(compiled["reverb"], compiled["seed"]))).astype(np.float32)


def render_project(proj, timing, total, soundfonts=None):
    """Checks, compiles and renders <proj>/src/score.json against the project's timing. Writes audio/score-inst.wav and
    audio/score-report.json; returns (stereo array at 48 kHz, report). Raises ScoreError with every problem."""
    proj = pathlib.Path(proj)
    began = time.time()
    compiled = compile_score(load_score(proj / "src" / "score.json"), timing)
    font_id, font_path = find_font(soundfonts or default_soundfonts(), compiled["font"])
    heard = min(float(compiled["length"] or total), float(total))   # audio.py cuts the music at the end of the video
    length = heard                                                   # nothing is rendered past it (a long "length" filled a disk)
    if not any(x[0] < heard for x in compiled["notes"]):
        raise ScoreError([f"no note of the score starts before {heard:.2f} s, the end of the music in this video: "
                          "anchor the bars earlier or write notes in the first bars (a silent score is never played)"])
    levels = {}
    audio = render(compiled, font_path, length, levels=levels)
    report = make_report(compiled, font_id, font_path, audio, heard, time.time() - began, levels)
    (proj / "audio").mkdir(parents=True, exist_ok=True)
    write_float_wav(proj / "audio" / "score-inst.wav", audio)
    (proj / "audio" / "score-report.json").write_text(json.dumps(report, indent=1))
    return audio, report


def make_report(compiled, font_id, font_path, audio, length, seconds, levels):
    late = [x for x in compiled["notes"] if x[0] > length]
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    loudest = max(levels.values()) if levels else 0.0
    buried = [f"{g} peaks at {v} dBFS, {loudest - v:.0f} dB under the loudest track: raise its \"gain_db\" or choose another "
              "program (this font plays it quietly)" for g, v in sorted(levels.items()) if loudest - v > BURIED_DB]
    return {"font": font_id, "font_file": pathlib.Path(font_path).name, "bpm": compiled["bpm"],
            "bpm_solved": round(compiled["bpm_solved"], 4), "bar1_s": round(compiled["bar1_s"], 6),
            "anchors": [{**a, "off_samples": round((a["bar_s"] - a["target_s"]) * SR, 3)} for a in compiled["anchors"]],
            "hits": compiled["hits"], "notes": len(compiled["notes"]), "channels": len(compiled["programs"]),
            "pitched_tracks": compiled["pitched_tracks"],
            "raw_peak": round(peak, 4), "raw_peak_dbfs": round(20 * np.log10(max(peak, 1e-9)), 1),
            "length_s": round(length, 3), "render_s": round(seconds, 2), "reverb": compiled["reverb"],
            "track_peaks_dbfs": dict(sorted(levels.items())),
            "warnings": ([f"{len(late)} notes start after the music's end at {length:.2f} s and are cut off"] if late else []) + buried}


def report_lines(r):
    stretch = 100 * (r["bpm_solved"] / r["bpm"] - 1)
    lines = [f"score: src/score.json on {r['font']} ({r['font_file']}), reverb {r['reverb']}",
             f"  tempo {r['bpm']:g} BPM asked, {r['bpm_solved']} BPM solved ({stretch:+.2f}%); bar 1 at {r['bar1_s']:.3f} s"]
    for a in r["anchors"]:
        target = f"{a['at']} = {a['target_s']:.3f} s" if isinstance(a["at"], str) else f"{a['target_s']:.3f} s"
        lines.append(f"  anchor bar {a['bar']} -> {target}: bar {a['bar']} at {a['bar_s']:.6f} s ({a['off_samples']:+.2f} samples)")
    for h in r["hits"]:
        lines.append(f"  hit {h['sound']} at {h['at']} = {h['t']:.3f} s")
    lines.append("  track peaks: " + ", ".join(f"{g} {v} dBFS" for g, v in r["track_peaks_dbfs"].items()))
    lines.append(f"  {r['notes']} notes on {r['channels']} channels; raw peak {r['raw_peak']} ({r['raw_peak_dbfs']} dBFS) before the mix sets its level; "
                 f"{r['length_s']:.1f} s of music rendered in {r['render_s']:.1f} s")
    lines += [f"  ! {w}" for w in r["warnings"]]
    return lines


# ---------------------------------------------------------------- listing and checking fonts
def list_font(folder, wanted=None):
    font_id, path = find_font(folder, wanted)
    synth, sfid = load_synth(path)
    lines = [f"{font_id}: {path.name}", "programs (bank 0, the number to give as \"program\"):"]
    lines += [f"  {p:3d}  {synth.sfpreset_name(sfid, 0, p)}" for p in range(128) if synth.sfpreset_name(sfid, 0, p)]
    lines.append("drum kits (bank 128, the name to give as \"kit\"):")
    from score_file import KITS
    names = {v: k for k, v in KITS.items()}
    others = 0
    for p in range(128):
        name = synth.sfpreset_name(sfid, 128, p)
        if name and p in names:
            lines.append(f'  "{names[p]}"  {name} (kit {p})')
        elif name:
            others += 1
    missing = [k for k, p in KITS.items() if not synth.sfpreset_name(sfid, 128, p)]
    if missing:
        lines.append(f"  not in this font: {', '.join(missing)}")
    if others:
        lines.append(f"  ({others} more kits in the font have no kit name in a score)")
    return lines


def check_file(path):
    synth, sfid = load_synth(path)
    progs = sum(1 for p in range(128) if synth.sfpreset_name(sfid, 0, p))
    kits = sum(1 for p in range(128) if synth.sfpreset_name(sfid, 128, p))
    if progs == 0:
        raise ScoreError([f"{path} loads but has no bank 0 programs: it is not a General MIDI SoundFont"])
    return progs, kits


def main(argv):
    args, opts = [], {}
    it = iter(argv)
    for a in it:
        if a in ("--font", "--soundfonts"):
            opts[a[2:]] = next(it, None)
        else:
            args.append(a)
    folder = pathlib.Path(opts.get("soundfonts") or default_soundfonts())
    try:
        if args[:1] == ["list"]:
            print("\n".join(list_font(folder, opts.get("font"))))
        elif args[:1] == ["check"] and len(args) == 2:
            progs, kits = check_file(args[1])
            print(f"ok {progs} programs, {kits} drum kits")
        else:
            sys.exit("usage: instruments.py list [--font <id>] [--soundfonts <dir>] | check <file>")
    except ScoreError as e:
        sys.exit("ERROR: " + str(e))
    except Exception as e:                    # a file tinysoundfont cannot read
        sys.exit(f"ERROR: the SoundFont could not be read ({e}). Use a .sf2 or .sf3 General MIDI SoundFont")


if __name__ == "__main__":
    main(sys.argv[1:])
