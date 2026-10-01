"""studio inspect: one picture of a stretch of the video, so a model that cannot hear can see what happened and when.

Run through the CLI:  node scripts/studio.mjs inspect <project> [--from s] [--to s]
Reads  timing.json, project.json, audio/layers.json (studio audio), audio/voice-report.json (studio voice),
       audio/mix-report.json, transcript.json (footage), and the newest MP4 in out/
Writes stills/inspect.png and prints the same timeline as text.

Rows, all on one time axis: frames of the video; scenes with what the voice was given; the voice level with the words
Whisper heard; the music level with a line 6 dB under the voice; the effects with their names; the level of the
finished MP4. Warnings (pauses, words heard differently, effects louder than the voice, loud music) are red.
"""
import json
import pathlib
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont

env = json.loads(pathlib.Path(sys.argv[1]).read_text())
proj = pathlib.Path(sys.argv[2])
want_from = float(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] != "" else None
want_to = float(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] != "" else None


def read(rel):
    f = proj / rel
    try:
        return json.loads(f.read_text()) if f.exists() else None
    except json.JSONDecodeError:
        return None


cfg = read("project.json") or {}
timing = read("timing.json")
if not timing:
    sys.exit("no timing.json yet: run studio audio first")
T, TOTAL = timing["T"], float(timing["TOTAL"])
t0 = max(0.0, want_from if want_from is not None else 0.0)
t1 = min(TOTAL, want_to if want_to is not None else TOTAL)
if t1 - t0 < 0.5:
    sys.exit(f"--from {t0} --to {t1}: the stretch must be at least 0.5 s inside the video (0 to {TOTAL} s)")
layers, vrep, mrep = read("audio/layers.json"), read("audio/voice-report.json") or {}, read("audio/mix-report.json") or {}
say = {sc["id"]: sc.get("say", "") for sc in cfg.get("scenes", [])}
notes = []                              # (time, text, is_warning) for the text timeline

# ---------------------------------------------------------------- words heard and warnings, on the video's time axis
heard = []                              # (start, end, text, bad)
if cfg.get("mode", "narrated") == "narrated":
    for sid, r in vrep.items():
        if sid not in T:
            continue
        base = T[sid]["vo"]
        bad_at = {round(p["at"], 2) for p in r.get("problems", [])}
        for w in r.get("heard_words", []):
            heard.append((base + w["start"], base + w["end"], w["text"], round(w["start"], 2) in bad_at))
        for p in r.get("problems", []):
            notes.append((base + p["at"], f'{sid}: voice {"breaks up" if p["broken"] else "says"} "{p["heard"]}" for "{p["expected"]}"', True))
        for p in r.get("pauses", []):
            notes.append((base + p["at"], f"{sid}: pause of {p['length']} s inside the line", True))
        for w in r.get("warnings", []):
            notes.append((base, f"{sid}: {w}", True))
        for c in r.get("changes", []):
            notes.append((base, f"{sid}: spoken as {c}", False))
else:
    for w in read("transcript.json") or []:
        heard.append((float(w["start"]), float(w["end"]), str(w["text"]), False))
for sid, v in T.items():
    notes.append((v["start"], f"{sid} starts" + (f': "{say.get(sid, "")}"' if say.get(sid) else ""), False))
CUES = timing.get("CUE") or {}
SYNC = set(timing.get("SYNC") or [])
for cname, ct in CUES.items():
    notes.append((float(ct), f"cue {cname}" + (" [sync]" if cname in SYNC else ""), False))
for e in mrep.get("effects", []):
    notes.append((e["at"], f'effect {e["name"]}: {e["over_voice_db"]:+.1f} dB against the voice', not e["ok"]))
if mrep.get("music_under_db") is not None:
    notes.append((0.0, f'music {mrep["music_under_db"]} dB under the voice while it speaks (keep 6 dB or more)', not mrep.get("music_ok", True)))

# ---------------------------------------------------------------- the finished MP4: frames and its level
out = proj / "out"
mp4s = sorted([p for p in out.glob("*.mp4") if not p.name.endswith("-share.mp4") and not p.name.startswith("render-raw")], key=lambda p: p.stat().st_mtime) if out.exists() else []
mp4 = mp4s[-1] if mp4s else None
ffmpeg = env["ffmpeg"]
frames = []
final_db = None
if mp4:
    n_frames = 8
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n_frames):
            t = t0 + (t1 - t0) * (i + 0.5) / n_frames
            f = pathlib.Path(tmp) / f"f{i}.png"
            subprocess.run([ffmpeg, "-loglevel", "error", "-y", "-ss", f"{t:.3f}", "-i", str(mp4), "-frames:v", "1", "-vf", "scale=-2:220", str(f)], check=False)
            if f.exists():
                frames.append((t, Image.open(f).convert("RGB")))
    raw = subprocess.run([ffmpeg, "-loglevel", "error", "-i", str(mp4), "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], capture_output=True).stdout
    a = np.frombuffer(raw, dtype="<f4").astype(np.float64)
    w = 400                                                          # 50 ms at 8 kHz
    if a.size >= w:
        n = a.size // w
        final_db = 20 * np.log10(np.maximum(np.sqrt((a[: n * w].reshape(n, w) ** 2).mean(1)), 1e-6))

# ---------------------------------------------------------------- drawing
W, LEFT, RIGHT = 1800, 150, 30
font = ImageFont.load_default(size=18)
small = ImageFont.load_default(size=15)
bold = ImageFont.load_default(size=22)
FRAME_H = 220 if frames else 0
ROWS = [("scenes", 70), ("voice", 170), ("music", 110), ("effects", 110), ("finished MP4", 110)]
H = 60 + FRAME_H + 40 + sum(h for _, h in ROWS) + 20
img = Image.new("RGB", (W, H), (250, 250, 247))
d = ImageDraw.Draw(img)
RED, INK, GREY, BLUE, GREEN, ORANGE = (200, 30, 30), (30, 30, 30), (150, 150, 150), (40, 90, 200), (40, 140, 90), (220, 120, 20)
x_of = lambda t: LEFT + (t - t0) / (t1 - t0) * (W - LEFT - RIGHT)
d.text((20, 18), f'{cfg.get("name", proj.name)}: {t0:.2f} to {t1:.2f} s of {TOTAL} s', font=bold, fill=INK)

y = 60
if frames:
    fw = (W - LEFT - RIGHT) // len(frames)
    for i, (t, im) in enumerate(frames):
        im.thumbnail((fw - 6, FRAME_H - 26))
        img.paste(im, (LEFT + i * fw + (fw - im.width) // 2, y))
        d.text((LEFT + i * fw + fw // 2 - 25, y + FRAME_H - 22), f"{t:.2f} s", font=small, fill=INK)
    y += FRAME_H
else:
    d.text((LEFT, y), "no rendered MP4 yet: the frames and the finished level appear after studio render", font=font, fill=GREY)
    y += 30

# time axis
step = next(s for s in (0.1, 0.25, 0.5, 1, 2, 5, 10, 20) if (t1 - t0) / s <= 24)
d.line([(LEFT, y + 30), (W - RIGHT, y + 30)], fill=GREY)
tick = np.ceil(t0 / step) * step
while tick <= t1 + 1e-9:
    d.line([(x_of(tick), y + 24), (x_of(tick), H - 20)], fill=(225, 225, 222))
    d.text((x_of(tick) - 14, y + 4), f"{tick:g}", font=small, fill=INK)
    tick += step
y += 40


def row_label(name, y0, h):
    d.text((14, y0 + h // 2 - 10), name, font=font, fill=INK)
    d.line([(LEFT, y0 + h), (W - RIGHT, y0 + h)], fill=(210, 210, 205))


def level_plot(values, step_s, y0, h, colour, lo=-60.0, hi=0.0, fill=True):
    if values is None or len(values) == 0:
        return
    pts = []
    for i, v in enumerate(values):
        t = i * step_s
        if t0 <= t <= t1:
            yy = y0 + h - (min(max(v, lo), hi) - lo) / (hi - lo) * (h - 8)
            pts.append((x_of(t), yy))
    if len(pts) > 1:
        if fill:
            d.polygon(pts + [(pts[-1][0], y0 + h), (pts[0][0], y0 + h)], fill=tuple(int(c + (255 - c) * 0.7) for c in colour))
        d.line(pts, fill=colour, width=2)


for name, h in ROWS:
    row_label(name, y, h)
    if name == "scenes":
        for sid, v in T.items():
            a_, b_ = max(v["start"], t0), min(v["end"], t1)
            if b_ <= a_:
                continue
            d.rectangle([x_of(a_), y + 6, x_of(b_), y + h - 6], outline=GREY, fill=(236, 236, 230))
            text = f'{sid}  {say.get(sid, "")}'
            maxc = max(4, int((x_of(b_) - x_of(a_)) / 9))
            d.text((x_of(a_) + 6, y + 12), text[:maxc] + ("…" if len(text) > maxc else ""), font=small, fill=INK)
    elif name == "voice":
        if layers:
            level_plot(layers["voice"], layers["step"], y, h - 50, BLUE)
        for k, (a_, b_, text, bad) in enumerate(sorted(heard)):
            if a_ > t1 or b_ < t0:
                continue
            yy = y + h - 46 + (k % 2) * 20
            d.text((x_of(max(a_, t0)), yy), text, font=small, fill=RED if bad else INK)
    elif name == "music":
        if layers:
            level_plot(layers["music"], layers["step"], y, h, GREEN)
            if mrep.get("voice_db") is not None:
                g = mrep["voice_db"] - 6
                yy = y + h - (g + 60) / 60 * (h - 8)
                d.line([(LEFT, yy), (W - RIGHT, yy)], fill=ORANGE, width=1)
                d.text((W - RIGHT - 250, yy - 18), "6 dB under the voice", font=small, fill=ORANGE)
    elif name == "effects":
        if layers:
            level_plot(layers["effects"], layers["step"], y, h, (120, 80, 160))
            if mrep.get("voice_db") is not None:
                g = mrep["voice_db"] + 3
                yy = y + h - (g + 60) / 60 * (h - 8)
                d.line([(LEFT, yy), (W - RIGHT, yy)], fill=ORANGE, width=1)
                d.text((W - RIGHT - 270, yy - 18), "3 dB over the voice", font=small, fill=ORANGE)
        for e in mrep.get("effects", []):
            if t0 <= e["at"] <= t1:
                c = RED if not e["ok"] else INK
                d.polygon([(x_of(e["at"]) - 6, y + 4), (x_of(e["at"]) + 6, y + 4), (x_of(e["at"]), y + 14)], fill=c)
                d.text((x_of(e["at"]) + 8, y + 2), f'{e["name"]} {e["over_voice_db"]:+.1f} dB', font=small, fill=c)
    elif name == "finished MP4" and final_db is not None:
        level_plot(final_db, 0.05, y, h, INK)
    y += h

for cname, ct in CUES.items():                                       # cues: a blue line across all rows, named at the top
    ct = float(ct)
    if t0 <= ct <= t1:
        top = 60 + FRAME_H + 40
        for yy in range(top, H - 20, 12):
            d.line([(x_of(ct), yy), (x_of(ct), min(yy + 6, H - 20))], fill=BLUE, width=2)
        d.text((x_of(ct) + 5, top + 2), f"cue {cname}" + (" [sync]" if cname in SYNC else ""), font=small, fill=BLUE)
for t, text, bad in notes:                                           # red markers across all rows
    if bad and t0 <= t <= t1:
        d.line([(x_of(t), 60 + FRAME_H + 40), (x_of(t), H - 20)], fill=RED, width=2)

shot = proj / "stills" / "inspect.png"
shot.parent.mkdir(parents=True, exist_ok=True)
img.save(shot)

# ---------------------------------------------------------------- the same as text
print(f"inspect {t0:.2f} to {t1:.2f} s (video {TOTAL} s); picture: stills/inspect.png")
if not layers:
    print("  no layer levels yet: run studio audio to add the voice, music and effects rows")
for t, text, bad in sorted(notes):
    if t0 - 0.01 <= t <= t1:
        print(f"  {t:6.2f} s  {'WARN ' if bad else '     '}{text}")
spoken = [(a_, text) for a_, b_, text, bad in sorted(heard) if t0 <= a_ <= t1]
if spoken:
    print("  heard: " + " ".join(f"{text}[{a_:.2f}]" for a_, text in spoken))
if layers:
    i0, i1 = int(t0 / layers["step"]), int(t1 / layers["step"]) + 1
    for k in ("voice", "music", "effects"):
        seg = [v for v in layers[k][i0:i1] if v > -60]
        print(f"  {k}: " + (f"loudest {max(seg):.1f} dB, typical {float(np.median(seg)):.1f} dB" if seg else "silent"))
