"""Generate the narration: one WAV per scene with Kokoro v1.0 (local, offline).

Run through the CLI:  node scripts/studio.mjs voice <project> [--only s3,s5]
Reads  <project>/project.json : voice, speed, lexicon, scenes[{id, say}]
Writes <project>/audio/vo/<id>.wav (24 kHz mono, silence trimmed) and <project>/durations.json
"""
import json, re, sys, pathlib
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

env = json.loads(pathlib.Path(sys.argv[1]).read_text())          # env.json written by setup
proj = pathlib.Path(sys.argv[2])
only = set(sys.argv[3].split(",")) if len(sys.argv) > 3 and sys.argv[3] else None
cfg = json.loads((proj / "project.json").read_text())
voice, speed = cfg.get("voice", "af_heart"), float(cfg.get("speed", 0.95))
lang = "en-gb" if voice[:1] == "b" else "en-us"
lexicon = cfg.get("lexicon", {})

k = Kokoro(env["kokoro_model"], env["kokoro_voices"])
(proj / "audio" / "vo").mkdir(parents=True, exist_ok=True)
dur_file = proj / "durations.json"
durations = json.loads(dur_file.read_text()) if dur_file.exists() else {}

def spoken(text):
    for word, say in lexicon.items():                               # brand names, acronyms
        text = re.sub(r"\b" + re.escape(word) + r"\b", say, text)
    return text

for sc in cfg["scenes"]:
    sid, say = sc["id"], (sc.get("say") or "").strip()
    if only and sid not in only:
        continue
    out = proj / "audio" / "vo" / f"{sid}.wav"
    if not say:                                                     # silent scene: uses "hold"
        durations[sid] = 0.0
        if out.exists(): out.unlink()
        continue
    v_ = sc.get("voice", voice)                                  # a British voice (b…) needs the en-gb phonemes
    audio, sr = k.create(spoken(say), voice=v_, speed=float(sc.get("speed", speed)), lang="en-gb" if v_[:1] == "b" else "en-us")
    a = audio.astype("float32")
    idx = np.where(np.abs(a) > 0.01)[0]
    a = a[max(0, idx[0] - 600): idx[-1] + 2400] if len(idx) else a
    sf.write(out, a, sr)
    durations[sid] = round(len(a) / sr, 3)
    words = len(say.split())
    wps = words / max(durations[sid], 0.1)
    print(f"{sid}: {durations[sid]:.2f} s, {words} words ({wps:.1f} words/s)" + ("   <- rushed: cut words (keep 2.5-3.3)" if wps > 3.5 else ""))

dur_file.write_text(json.dumps(durations, indent=1))
print("total narration", round(sum(durations.values()), 2), "s")
