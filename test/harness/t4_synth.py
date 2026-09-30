"""T4 fixture: 20 words synthesised one at a time with Kokoro and joined with fixed gaps.

Usage (tool home venv python): python t4_synth.py <env.json> <spec.json> <out.wav> <truth.json>
spec.json: {"words": [...], "gaps": [...], "voice": "af_heart", "speed": 1.0, "onset_level": 0.01}
truth.json: {"sample_rate", "onsets" (seconds in the joined file), "duration", "words"}
The true onset of a word is the first sample of its clip whose absolute value exceeds onset_level.
"""
import json, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

env = json.load(open(sys.argv[1])); spec = json.load(open(sys.argv[2]))
words, gaps = spec["words"], spec["gaps"]
assert len(gaps) == len(words) - 1
k = Kokoro(env["kokoro_model"], env["kokoro_voices"])
parts, onsets, cursor, rate = [], [], 0, None
for i, w in enumerate(words):
    clip, sr = k.create(w, voice=spec["voice"], speed=float(spec["speed"]), lang="en-us")
    clip = clip.astype("float32"); rate = rate or sr; assert sr == rate
    over = np.flatnonzero(np.abs(clip) > spec["onset_level"])
    if not len(over): sys.exit(f"the clip for {w!r} is silent")
    onsets.append((cursor + int(over[0])) / rate)
    parts.append(clip); cursor += len(clip)
    if i < len(gaps):
        n = int(round(gaps[i] * rate)); parts.append(np.zeros(n, dtype="float32")); cursor += n
sf.write(sys.argv[3], np.concatenate(parts), rate, subtype="PCM_16")
json.dump({"sample_rate": rate, "onsets": onsets, "duration": cursor / rate, "words": words}, open(sys.argv[4], "w"), indent=1)
print(f"wrote {sys.argv[3]}: {len(words)} words, {cursor / rate:.2f} s")
