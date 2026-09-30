"""Scene timing + the finished soundtrack (narration, music bed with ducking, UI sounds).

Run through the CLI:  node scripts/studio.mjs audio <project>
Reads  project.json (scenes, events, music, lead/pre/post/tail) and durations.json
Writes timing.json + timing.js (window.TIMING = {T, EV, TOTAL}) and audio/mix_raw.wav;
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
"""
import json, sys, pathlib
import numpy as np, soundfile as sf

proj = pathlib.Path(sys.argv[1])
ffmpeg = sys.argv[2] if len(sys.argv) > 2 else "ffmpeg"
cfg = json.loads((proj / "project.json").read_text())
MODE = cfg.get("mode", "narrated")
if MODE not in ("narrated", "footage", "film"):
    sys.exit(f'unknown "mode": {MODE!r}; use "narrated", "footage" or "film"')
FILM = MODE == "film"
if FILM:                                # wordless: footage timing, no voice, no automatic whooshes
    MODE, cfg["voice_track"] = "footage", False
    cfg.setdefault("transition_whoosh", False)
dur = json.loads((proj / "durations.json").read_text()) if MODE == "narrated" else {}
SR = 24000
LEAD, PRE, POST, TAIL = (float(cfg.get(k, d)) for k, d in (("lead", 0.9), ("pre", 0.6), ("post", 1.5), ("tail", 2.5)))
scenes = cfg.get("scenes") or sys.exit("project.json has no scenes")
if MODE == "footage":
    bad = [sc.get("id", "?") for sc in scenes if "start" not in sc or "end" not in sc]
    if bad: sys.exit(f'{"film" if FILM else "footage"} mode: every scene needs "start" and "end" in seconds (missing in {", ".join(bad)})')

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

SAFE = {"tiktok": [200, 400, 60, 180], "reels": [269, 672, 65, 65], "meta": [269, 672, 65, 65], "shorts": [288, 672, 60, 201]}
plat = str(cfg.get("platform", "")).lower()
timing = {"T": T, "EV": EV, "TOTAL": TOTAL, "fps": cfg.get("fps", 30), "aspect": cfg.get("aspect", "16:9"),
          "platform": plat, "safe": SAFE.get(plat) if cfg.get("aspect") == "9:16" else None}
(proj / "timing.json").write_text(json.dumps(timing, indent=1))
(proj / "timing.js").write_text("window.TIMING = " + json.dumps(timing) + ";\n")

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

rng = np.random.default_rng(7)
mood = cfg.get("music", "warm")
music = np.zeros(n, np.float32)
if isinstance(mood, dict):                                         # the user's own song, one section
    import subprocess
    if not (proj / mood.get("file", "")).is_file(): sys.exit(f'music file not found: {mood.get("file")} (path is relative to the project folder)')
    (proj / "audio").mkdir(parents=True, exist_ok=True); tmpw = proj / "audio" / "_song.wav"
    subprocess.run([ffmpeg, "-loglevel", "error", "-y", "-ss", str(mood.get("start", 0)), "-t", str(TOTAL + 1), "-i", str(proj / mood["file"]),
                    "-ac", "1", "-ar", str(SR), str(tmpw)], check=True)
    a, _ = sf.read(tmpw, dtype="float32"); tmpw.unlink(); music[: min(n, len(a))] = a[:n] * 10 ** (mood.get("gain_db", -3) / 20) / 0.9
    win = int(0.05 * SR); rms = np.sqrt(np.convolve(vo ** 2, np.ones(win) / win, "same"))
    duck = 1 - 0.7 * np.clip(rms / 0.03, 0, 1); k = int(0.3 * SR); duck = np.convolve(duck, np.ones(k) / k, "same")
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
    win = int(0.05 * SR); rms = np.sqrt(np.convolve(vo ** 2, np.ones(win) / win, "same"))
    duck = 1 - 0.6 * np.clip(rms / 0.03, 0, 1)                         # music dips under the voice
    k = int(0.3 * SR); duck = np.convolve(duck, np.ones(k) / k, "same")
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
def pop(t0, amp=0.3):
    i = int(t0 * SR); L = int(0.12 * SR)
    if i + L >= n: return
    ts = np.arange(L) / SR; f = 520 * np.exp(-ts * 8)
    fx[i:i + L] += amp * np.exp(-ts * 30) * np.sin(2 * np.pi * np.cumsum(f) / SR)
for t0, kind in SFX:
    {"click": click, "whoosh": whoosh, "pop": pop}.get(kind, click)(t0)
if cfg.get("transition_whoosh", True):
    for sc in scenes[1:]:
        whoosh(T[sc["id"]]["start"])

mix = vo + 0.9 * music + fx
(proj / "audio").mkdir(parents=True, exist_ok=True)
sf.write(proj / "audio" / "mix_raw.wav", np.stack([mix, mix], 1), SR)
for s_, v in T.items():
    if MODE == "narrated": print(f"  {s_}: {v['start']:6.2f}–{v['end']:6.2f} s  (narration {v['vo']:.2f}–{v['vo_end']:.2f}; event t counts from {v['vo']:.2f})")
    else: print(f"  {s_}: {v['start']:6.2f}–{v['end']:6.2f} s  (event t counts from the scene start, {v['start']:.2f})")
narr = sum(dur.get(sc["id"], 0) for sc in scenes) if MODE == "narrated" else 0
print("TOTAL", TOTAL, "s" + (f"  (narration {narr:.1f} s + pauses {TOTAL - narr:.1f} s)" if MODE == "narrated" else ""))
if cfg.get("length") and TOTAL > float(cfg["length"]) * 1.05:
    over = TOTAL - float(cfg["length"])
    print(f"WARNING: {TOTAL} s is {over:.1f} s over the target length {cfg['length']} s. Cut about {int(over * 2.8) + 1} words,"
          " or lower pre/post/tail/lead in project.json (each scene adds pre + post seconds around its narration).")
