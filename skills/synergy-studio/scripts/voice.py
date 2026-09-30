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
try:
    cfg = json.loads((proj / "project.json").read_text())
except json.JSONDecodeError as e:
    sys.exit(f"ERROR: {proj / 'project.json'} is not valid JSON ({e.msg}: line {e.lineno} column {e.colno}, position {e.pos}). Fix the file (a comma, quote or bracket is usually missing) and run the command again.")
for _i, _sc in enumerate(cfg["scenes"]):
    _id = _sc.get("id")
    if not (isinstance(_id, str) and re.fullmatch(r"s\d+", _id)):
        sys.exit(f'ERROR: scene id {_id!r} is not allowed. Scene ids look like s1, s2, s3: rename it in project.json.')
    if _id in [x.get("id") for x in cfg["scenes"][:_i]]:
        sys.exit(f'ERROR: scene id "{_id}" is used twice. Give every scene its own id (s1, s2, s3) in project.json.')

def speed_of(v, where):                                            # Kokoro accepts 0.5 to 2.0; 0.85 to 1.1 sounds natural
    try: x = float(v)
    except (TypeError, ValueError): x = float("nan")
    if not 0.5 <= x <= 2.0:
        sys.exit(f'ERROR: speed {v!r} ({where}) is outside 0.5 to 2.0. Set "speed" to a number between 0.85 and 1.1 in project.json.')
    if not 0.85 <= x <= 1.1:
        print(f"WARNING: speed {x} ({where}) is outside 0.85 to 1.1, the range that sounds natural")
    return x

voice = cfg.get("voice", "af_heart")
speed = speed_of(cfg.get("speed", 0.95), "project")
for _sc in cfg["scenes"]:
    if "speed" in _sc: speed_of(_sc["speed"], f"scene {_sc['id']}")
lang = "en-gb" if voice[:1] == "b" else "en-us"
lexicon = cfg.get("lexicon", {})

VOICES = ["af_heart", "af_bella", "af_nova", "af_sky", "am_michael", "am_adam", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"]
for where, v_ in [("project voice", voice)] + [(f"scene {sc['id']}", sc["voice"]) for sc in cfg["scenes"] if "voice" in sc]:
    if v_ not in VOICES:                                            # refuse before the model is loaded
        sys.exit(f'unknown voice {v_!r} ({where}). Use one of: {", ".join(VOICES)}')

print(f"voice {voice}, language {lang}, speed {speed}")
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
    lang_ = "en-gb" if v_[:1] == "b" else "en-us"
    audio, sr = k.create(spoken(say), voice=v_, speed=float(sc.get("speed", speed)), lang=lang_)
    a = audio.astype("float32")
    idx = np.where(np.abs(a) > 0.01)[0]
    a = a[max(0, idx[0] - 600): idx[-1] + 2400] if len(idx) else a
    sf.write(out, a, sr)
    durations[sid] = round(len(a) / sr, 3)
    words = len(say.split())
    wps = words / max(durations[sid], 0.1)
    print(f"{sid}: {durations[sid]:.2f} s, {words} words ({wps:.1f} words/s)" + (f"   [voice {v_}, {lang_}]" if v_ != voice else "") + ("   <- rushed: cut words (keep 2.5-3.3)" if wps > 3.5 else ""))

dur_file.write_text(json.dumps(durations, indent=1))
print("total narration", round(sum(durations.values()), 2), "s")
