"""Scene timing + the finished soundtrack (narration, music bed with ducking, UI sounds).

Run through the CLI:  node scripts/studio.mjs audio <project>
Reads  project.json (scenes, events, cues, music, lead/pre/post/tail) and durations.json
Writes timing.json + timing.js (window.TIMING = {T, EV, CUE, SYNC, TOTAL}) and audio/mix_raw.wav;
the CLI then loudness-normalises it to audio/mix.wav (-14 LUFS, -1.5 dBTP).

Two modes (project.json "mode"):
  "narrated" (default): scene.start -> +pre (lead for the first scene) -> narration (vo..vo_end)
                        -> +post (+tail on the last scene, +hold for silent scenes) -> scene.end
  "footage":  the voice is audio/voice.wav from `studio cut` (the edited clips); scenes are given as
              {"id", "start", "end"} in seconds of the edited video (vo = start, vo_end = end).
  "film":     wordless, music-driven (story, art, music video): like footage, but no voice track;
              scenes {"id", "start", "end"} in seconds, music is usually your own score file.
Music (project.json "music"): "warm" | "calm" | "upbeat" (generated) | "none" |
  {"file": "src/assets/song.mp3", "start": 47.3, "gain_db": -3}  (a section of your own licensed song)
The score (src/score.json, real instruments, instruments.py) is rendered here with the timing just computed and mixed at
48 kHz stereo, ducked like the bed. It replaces a generated bed and plays on top of a song file. Without a score file the
mix is built exactly as before (mono, 24 kHz).
Arguments: <project> [ffmpeg] [soundfonts folder] [--score-only]; --score-only writes the timing and the score, then stops.
"""
import json, re, sys, pathlib
import numpy as np, soundfile as sf

ARGS = [a for a in sys.argv[1:] if a != "--score-only"]
SCORE_ONLY = "--score-only" in sys.argv[1:]
proj = pathlib.Path(ARGS[0])
ffmpeg = ARGS[1] if len(ARGS) > 1 else "ffmpeg"
SOUNDFONTS = ARGS[2] if len(ARGS) > 2 else None
SCORE_FILE = proj / "src" / "score.json"
try:
    cfg = json.loads((proj / "project.json").read_text())
except json.JSONDecodeError as e:
    sys.exit(f"ERROR: {proj / 'project.json'} is not valid JSON ({e.msg}: line {e.lineno} column {e.colno}, position {e.pos}). Fix the file (a comma, quote or bracket is usually missing) and run the command again.")
MODE = cfg.get("mode", "narrated")
if MODE not in ("narrated", "footage", "film"):
    sys.exit(f'unknown "mode": {MODE!r}; use "narrated", "footage" or "film"')
FILM = MODE == "film"
if FILM:                                # wordless: footage timing, no voice, no automatic whooshes
    MODE, cfg["voice_track"] = "footage", False
    cfg.setdefault("transition_whoosh", False)
if MODE == "narrated" and not (proj / "durations.json").is_file():
    sys.exit(f"ERROR: durations.json is missing: a narrated video is timed by its voice. Run studio voice {proj} first.")
dur = json.loads((proj / "durations.json").read_text()) if MODE == "narrated" else {}
SR = 24000
# pauses omitted from project.json: 9:16 is tighter (lead 0.4, pre 0.3, post 0.7, tail 2.0), other aspects 0.9, 0.6, 1.2, 2.5
DEFAULTS = {"lead": 0.4, "pre": 0.3, "post": 0.7, "tail": 2.0} if cfg.get("aspect") == "9:16" else {"lead": 0.9, "pre": 0.6, "post": 1.2, "tail": 2.5}
LEAD, PRE, POST, TAIL = (float(cfg.get(k, DEFAULTS[k])) for k in ("lead", "pre", "post", "tail"))
scenes = cfg.get("scenes") or sys.exit("project.json has no scenes")
_ids = [sc.get("id") for sc in scenes]
for _i, _id in enumerate(_ids):
    if not (isinstance(_id, str) and re.fullmatch(r"s\d+", _id)):
        sys.exit(f'ERROR: scene id {_id!r} is not allowed. Scene ids look like s1, s2, s3: rename it in project.json.')
    if _id in _ids[:_i]:
        sys.exit(f'ERROR: scene id "{_id}" is used twice. Give every scene its own id (s1, s2, s3) in project.json.')
_mood = cfg.get("music", "warm")
if not (isinstance(_mood, dict) or (isinstance(_mood, str) and _mood in ("warm", "calm", "upbeat", "none"))):
    sys.exit(f'ERROR: unknown music {json.dumps(_mood)}. Set "music" to "warm", "calm", "upbeat", "none" or {{"file": "src/assets/song.mp3", "start": 0, "gain_db": -3}} in project.json.')
if MODE == "footage":
    bad = [sc.get("id", "?") for sc in scenes if "start" not in sc or "end" not in sc]
    if bad: sys.exit(f'{"film" if FILM else "footage"} mode: every scene needs "start" and "end" in seconds (missing in {", ".join(bad)})')

if MODE == "footage" and cfg.get("voice_track", True) and not (proj / "audio" / "voice.wav").is_file():
    sys.exit(f'ERROR: audio/voice.wav is missing. Run studio cut {proj} first (or set "voice_track": false for a music only project).')

T, t = {}, 0.0
if MODE == "footage":
    for sc in scenes:
        a, b = float(sc["start"]), float(sc["end"])
        T[sc["id"]] = {"start": a, "vo": a, "vo_end": b, "end": b, "dur": round(b - a, 3)}
    t = max(v["end"] for v in T.values())
for i, sc in enumerate(scenes if MODE == "narrated" else []):
    sid = sc["id"]
    if sid not in dur:
        sys.exit(f"no narration for {sid}: run `studio voice` first")
    start = t
    vo = start + (LEAD if i == 0 else float(sc.get("pre", PRE)))
    end = vo + dur[sid] + float(sc.get("post", POST)) + float(sc.get("hold", 0)) + (TAIL if i == len(scenes) - 1 else 0)
    T[sid] = {"start": round(start, 3), "vo": round(vo, 3), "vo_end": round(vo + dur[sid], 3), "end": round(end, 3),
              "dur": round(end - start, 3)}
    t = end
TOTAL = round(t, 3)

# events: {"s2": {"tools": 1.2, "setup_click": {"t": 4.4, "sfx": "click"}}}; times are after the scene's narration start
EV, SFX = {}, []
for sid, evs in (cfg.get("events") or {}).items():
    if sid not in T:
        sys.exit(f"events: unknown scene {sid}")
    EV[sid] = {}
    for name, v in evs.items():
        off = v["t"] if isinstance(v, dict) else v
        EV[sid][name] = off
        if isinstance(v, dict) and v.get("sfx"):
            SFX.append((T[sid]["vo"] + off, v["sfx"]))

# cues: one cue sheet for the page (CUE.name), the score (reads project.json) and the checks.
# {"slam": 21.4, "bang": {"t": 30.6, "sync": true, "sfx": "pop"}}; absolute seconds of the finished video.
# "sync": true makes studio check confirm that the sound starts on that frame; "sfx" adds a built in effect at the cue.
CUE, SYNC = {}, []
_cues = cfg.get("cues") or {}
if not isinstance(_cues, dict):
    sys.exit('ERROR: "cues" in project.json must be an object, for example {"slam": 21.4, "bang": {"t": 30.6, "sync": true}}.')
CUE_SFX = ("pop", "click", "whoosh")                              # the built in effects a cue may name
for name, v in _cues.items():
    raw = v.get("t") if isinstance(v, dict) else v
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        sys.exit(f'ERROR: cue "{name}" needs a time in seconds: "{name}": 21.4 or "{name}": {{"t": 21.4, "sync": true}}.')
    t0 = float(raw)
    if not 0 <= t0 <= TOTAL:
        sys.exit(f'ERROR: cue "{name}" at {t0} s is outside the video (0 to {TOTAL} s). Move it in project.json "cues".')
    if isinstance(v, dict) and v.get("sync") is not None and not isinstance(v["sync"], bool):
        sys.exit(f'ERROR: cue "{name}": "sync" must be true or false, not {json.dumps(v["sync"])}. Fix it in project.json "cues".')
    if isinstance(v, dict) and v.get("sfx") not in (None, "") and v["sfx"] not in CUE_SFX:
        sys.exit(f'ERROR: cue "{name}": unknown sfx {json.dumps(v["sfx"])}. Use one of {", ".join(CUE_SFX)} (or leave "sfx" out).')
    CUE[name] = t0
    if isinstance(v, dict) and v.get("sync"): SYNC.append(name)
    if isinstance(v, dict) and v.get("sfx"): SFX.append((t0, v["sfx"]))

SAFE = {"tiktok": [200, 400, 60, 180], "reels": [269, 672, 65, 65], "meta": [269, 672, 65, 65], "shorts": [288, 672, 60, 201]}
plat = str(cfg.get("platform", "")).lower()
timing = {"T": T, "EV": EV, "CUE": CUE, "SYNC": SYNC, "TOTAL": TOTAL, "fps": cfg.get("fps", 30), "aspect": cfg.get("aspect", "16:9"),
          "platform": plat, "safe": SAFE.get(plat) if cfg.get("aspect") == "9:16" else None}
(proj / "timing.json").write_text(json.dumps(timing, indent=1))
(proj / "timing.js").write_text("window.TIMING = " + json.dumps(timing) + ";\n")

score = None                                                        # (stereo 48 kHz array, report) when src/score.json exists
if SCORE_FILE.is_file():
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    from score_file import ScoreError
    try:
        from instruments import render_project, report_lines
        score = render_project(proj, timing, TOTAL, SOUNDFONTS)
    except ScoreError as e:
        sys.exit("ERROR: src/score.json was not played:\n  " + "\n  ".join(e.problems))
    except ImportError as e:
        sys.exit(f"ERROR: the instrument engine is not installed ({e}): run studio setup")
    print("\n".join(report_lines(score[1])))
    print("wrote audio/score-inst.wav and audio/score-report.json")
if SCORE_ONLY:
    if score is None:
        sys.exit("ERROR: there is no src/score.json to play")
    sys.exit(0)

n = int(TOTAL * SR) + SR
tt = np.arange(n) / SR
vo = np.zeros(n, np.float32)
if MODE == "footage" and cfg.get("voice_track", True):
    a, sr = sf.read(proj / "audio" / "voice.wav", dtype="float32")
    if a.ndim > 1: a = a.mean(1)
    if sr != SR: sys.exit(f"voice.wav must be {SR} Hz (made by `studio cut`)")
    vo[: min(n, len(a))] = a[:n]
for sc in (scenes if MODE == "narrated" else []):
    f = proj / "audio" / "vo" / f"{sc['id']}.wav"
    if f.exists():
        a, sr = sf.read(f, dtype="float32")
        if sr != SR: sys.exit(f"{f}: expected {SR} Hz")
        i = int(T[sc["id"]]["vo"] * SR); vo[i:i + len(a)] += a[: n - i]

def duck_curve(vo):                                                 # 1 with no voice, about 0.4 (-8 dB) while it speaks
    win = int(0.05 * SR); rms = np.sqrt(np.convolve(vo ** 2, np.ones(win) / win, "same"))
    duck = 1 - 0.6 * np.clip(rms / 0.03, 0, 1); k = int(0.3 * SR); return np.convolve(duck, np.ones(k) / k, "same")

rng = np.random.default_rng(7)
mood = cfg.get("music", "warm")
if score is not None and isinstance(mood, str) and mood in ("warm", "calm", "upbeat"):
    print(f'the score replaces the generated "{mood}" bed (src/score.json is the music)')
    mood = "none"
if score is not None and isinstance(mood, dict) and str(mood.get("file", "")).replace("\\", "/").lstrip("./") == "src/assets/score.wav":
    print("the score replaces the starter score src/assets/score.wav (src/score.json is the music)")
    mood = "none"
if score is not None and isinstance(mood, dict) and score[1]["pitched_tracks"]:
    print(f'WARNING: the score plays notes on top of {mood.get("file")}: two pieces of music fight. Keep the score to hits and drums, or set "music": "none"')
music = np.zeros(n, np.float32)
if isinstance(mood, dict):                                         # the user's own song, one section
    import subprocess
    if not (proj / mood.get("file", "")).is_file(): sys.exit(f'music file not found: {mood.get("file")} (path is relative to the project folder)')
    (proj / "audio").mkdir(parents=True, exist_ok=True); tmpw = proj / "audio" / "_song.wav"
    subprocess.run([ffmpeg, "-loglevel", "error", "-y", "-ss", str(mood.get("start", 0)), "-t", str(TOTAL + 1), "-i", str(proj / mood["file"]),
                    "-ac", "1", "-ar", str(SR), str(tmpw)], check=True)
    a, _ = sf.read(tmpw, dtype="float32"); tmpw.unlink(); music[: min(n, len(a))] = a[:n] * 10 ** (mood.get("gain_db", -3) / 20) / 0.9
    duck = duck_curve(vo)
    music *= duck * np.minimum(1, tt / 0.3) * np.minimum(1, np.maximum(0, TOTAL - tt) / 2.0)
elif mood != "none":
    chords = {"warm": [[261.63, 329.63, 392.0, 493.88], [220.0, 261.63, 329.63, 392.0], [174.61, 220.0, 261.63, 329.63], [196.0, 246.94, 293.66, 329.63]],
              "calm": [[220.0, 277.18, 329.63, 415.3], [185.0, 220.0, 277.18, 329.63], [146.83, 185.0, 220.0, 277.18], [164.81, 207.65, 246.94, 329.63]],
              "upbeat": [[293.66, 369.99, 440.0, 554.37], [246.94, 293.66, 369.99, 440.0], [196.0, 246.94, 293.66, 369.99], [220.0, 277.18, 329.63, 440.0]]}[mood]
    bpm = {"warm": 96, "calm": 72, "upbeat": 118}[mood]
    seg = 4.0
    for k in range(int(TOTAL / seg) + 2):                            # soft chord pad
        f = chords[k % 4]; a0 = int(k * seg * SR); a1 = min(n, int((k + 1) * seg * SR + 0.8 * SR))
        if a0 >= n: break
        ts = np.arange(a1 - a0) / SR
        env = np.minimum(1, ts / 0.8) * np.minimum(1, np.maximum(0, (a1 - a0) / SR - ts) / 0.8)
        for j, fr in enumerate(f):
            for det in (-0.6, 0.6):
                music[a0:a1] += (0.05 / (1 + j * 0.3)) * env * np.sin(2 * np.pi * (fr / 2 if j == 0 else fr) * (1 + det / 1200) * ts + rng.uniform(0, 6))
    beat = 60 / bpm
    for b in range(int(TOTAL / beat)):                               # gentle pluck on the beat
        i = int(b * beat * SR); L = int(0.25 * SR)
        if i + L >= n: break
        ts = np.arange(L) / SR; f = chords[int(b * beat / seg) % 4][b % 4] * 2
        music[i:i + L] += (0.05 if mood == "upbeat" else 0.035) * np.exp(-ts * 18) * np.sin(2 * np.pi * f * ts)
    duck = duck_curve(vo)                                            # music dips under the voice
    music *= duck * np.minimum(1, tt / 1.5) * np.minimum(1, np.maximum(0, TOTAL - tt) / 2.5)

fx = np.zeros(n, np.float32)
def click(t0, amp=0.25):
    i = int(t0 * SR); L = int(0.03 * SR)
    if i + L >= n: return
    ts = np.arange(L) / SR
    fx[i:i + L] += amp * np.exp(-ts * 220) * np.sin(2 * np.pi * 2400 * ts) + amp * 0.15 * np.exp(-ts * 120) * rng.standard_normal(L)
def whoosh(t0, amp=0.18):
    i = int(t0 * SR) - int(0.35 * SR); L = int(0.7 * SR)
    if i < 0 or i + L >= n: return
    ts = np.arange(L) / SR; noise = np.convolve(rng.standard_normal(L), np.ones(40) / 40, "same")
    fx[i:i + L] += amp * np.sin(np.pi * ts / 0.7) ** 2 * noise
def pop(t0, amp=0.2):                                               # 0.3 sat 4.8 dB over the voice (speech.balance)
    i = int(t0 * SR); L = int(0.12 * SR)
    if i + L >= n: return
    ts = np.arange(L) / SR; f = 520 * np.exp(-ts * 8)
    fx[i:i + L] += amp * np.exp(-ts * 30) * np.sin(2 * np.pi * np.cumsum(f) / SR)
for t0, kind in SFX:
    {"click": click, "whoosh": whoosh, "pop": pop}.get(kind, click)(t0)
if cfg.get("transition_whoosh", True):
    for sc in scenes[1:]:
        whoosh(T[sc["id"]]["start"])

SCORE_SR = 2 * SR                                                  # the score keeps its 48 kHz: hats and cymbals live above 12 kHz
SCORE_PEAK = 0.5                                                    # the score stem's peak before ducking
SCORE_UNDER_VOICE_DB = 10.0                                         # with a voice, the score sits this far under it while it speaks


def upsample2(x):
    """24 kHz to 48 kHz through the spectrum: the band limited voice and bed come out unchanged, the same bytes every run."""
    X = np.fft.rfft(x.astype(np.float64)); Y = np.zeros(len(x) + 1, complex); Y[: len(X)] = X
    return np.fft.irfft(Y, 2 * len(x)) * 2


BUS_BLOCK = 240                                                     # 5 ms blocks at 48 kHz
BUS_RATIO = 3.0
BUS_MAX_DB = 6.0                                                    # the bus never takes more than this
BUS_ATTACK_BLOCKS, BUS_RELEASE_DB_PER_BLOCK = 2, 0.25               # about 10 ms down, 1 dB back every 20 ms


def bus_compress(s):
    """A gentle bus compressor for the score (3:1 above the level of its loud stretches, at most 6 dB), so the final
    limiter has less to take off the drum and hit transients. Deterministic: block peaks and a smoothed gain curve."""
    nb = len(s) // BUS_BLOCK
    if nb < 4: return s
    pk = np.abs(s[: nb * BUS_BLOCK]).max(axis=1).reshape(nb, BUS_BLOCK).max(axis=1)
    active = pk[pk > 1e-4]
    if active.size < 4: return s
    thr = np.percentile(active, 80)                                 # the level the groove reaches often; only what rises above is held
    want = np.minimum(BUS_MAX_DB, np.maximum(0, 20 * np.log10(np.maximum(pk, 1e-9) / thr)) * (1 - 1 / BUS_RATIO))
    for i in range(nb - 2, -1, -1):                                 # look ahead: start pulling down before the transient
        want[i] = max(want[i], want[i + 1] - BUS_MAX_DB / BUS_ATTACK_BLOCKS)
    g = np.empty(nb); g[0] = want[0]
    for i in range(1, nb):                                          # let go slowly
        g[i] = max(want[i], g[i - 1] - BUS_RELEASE_DB_PER_BLOCK)
    curve = np.interp(np.arange(len(s)), np.arange(nb) * BUS_BLOCK + BUS_BLOCK / 2, 10 ** (-g / 20))
    return s * curve[:, None]


def score_stem(stem, music24):
    """The score at 48 kHz stereo: set to its level, cut at the end of the video, ducked under the voice and kept
    SCORE_UNDER_VOICE_DB under it while it speaks. Also returns the music layer at 24 kHz mono for the balance checks."""
    s = np.zeros((2 * n, 2)); m = min(len(s), len(stem)); s[:m] = stem[:m]
    s = bus_compress(s)                                             # measured: limiter 6.9 -> 2.8 dB on an Afrobeats film, same loudness
    peak = float(np.max(np.abs(s)))
    if peak > 0: s *= SCORE_PEAK / peak
    end = min(len(s), int(round(TOTAL * SCORE_SR))); f0 = max(0, end - int(0.05 * SCORE_SR))
    s[f0:end] *= np.linspace(1, 0, end - f0)[:, None]; s[end:] = 0
    s *= np.repeat(duck_curve(vo), 2)[:, None]
    alone = lambda: s.mean(1).reshape(-1, 2).mean(1)               # the score at 24 kHz mono
    heard = lambda: music24 + alone()
    under = balance(vo, alone(), fx, SR, [])["music_under_db"]       # the score alone: a song's level has its own warning
    if under is not None and under < SCORE_UNDER_VOICE_DB:
        s *= 10 ** ((under - SCORE_UNDER_VOICE_DB) / 20)
    return s, heard()


mix = vo + 0.9 * music + fx
(proj / "audio").mkdir(parents=True, exist_ok=True)
# balance of the layers (speech.py): music under the voice, and every effect against the voice
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from speech import balance, MUSIC_UNDER_DB, EFFECT_OVER_DB
music_heard = 0.9 * music
if score is not None:
    stem, music_heard = score_stem(score[0], music_heard)
fx_events = [(t0, kind) for t0, kind in SFX] + ([(T[sc["id"]]["start"], "whoosh (scene change)") for sc in scenes[1:]] if cfg.get("transition_whoosh", True) else [])
bal = balance(vo, music_heard, fx, SR, fx_events)
if bal["music_under_db"] is not None and not bal["music_ok"]:
    print(f"WARNING: the music is only {bal['music_under_db']:.1f} dB under the voice while it speaks (keep it {MUSIC_UNDER_DB:.0f} dB or more under):"
          + (' lower "gain_db" of the song' if isinstance(mood, dict) else ' choose a calmer mood or "music": "none"'))
for ev in bal["effects"]:
    if not ev["ok"]:
        print(f"WARNING: the {ev['name']} at {ev['at']:.2f} s is {ev['over_voice_db']:.1f} dB louder than the voice's usual level (keep effects at most {EFFECT_OVER_DB:.0f} dB above it): move it off the words or drop it")
(proj / "audio" / "mix-report.json").write_text(json.dumps(bal, indent=1))
from speech import layer_levels                                     # what studio inspect draws: each layer's level over time
(proj / "audio" / "layers.json").write_text(json.dumps({**layer_levels(vo, music_heard, fx, SR), "events": [{"at": round(t, 2), "name": k} for t, k in fx_events]}))
if score is None:
    sf.write(proj / "audio" / "mix_raw.wav", np.stack([mix, mix], 1), SR)
else:                                                               # float, so the hits are never clipped before mastering
    from instruments import write_float_wav                          # float, and the same bytes for the same samples
    write_float_wav(proj / "audio" / "mix_raw.wav", (upsample2(mix)[:, None] + stem).astype(np.float32), SCORE_SR)
for s_, v in T.items():
    if MODE == "narrated": print(f"  {s_}: {v['start']:6.2f}–{v['end']:6.2f} s  (narration {v['vo']:.2f}–{v['vo_end']:.2f}; event t counts from {v['vo']:.2f})")
    else: print(f"  {s_}: {v['start']:6.2f}–{v['end']:6.2f} s  (event t counts from the scene start, {v['start']:.2f})")
narr = sum(dur.get(sc["id"], 0) for sc in scenes) if MODE == "narrated" else 0
print("TOTAL", TOTAL, "s" + (f"  (narration {narr:.1f} s + pauses {TOTAL - narr:.1f} s)" if MODE == "narrated" else ""))
if cfg.get("length") and TOTAL > float(cfg["length"]) * 1.05:
    over = TOTAL - float(cfg["length"])
    print(f"WARNING: {TOTAL} s is {over:.1f} s over the target length {cfg['length']} s. Cut about {int(over * 2.8) + 1} words,"
          " or lower pre/post/tail/lead in project.json (each scene adds pre + post seconds around its narration).")
