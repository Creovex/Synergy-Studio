"""Starter score for a film mode project: a soft bed and a placeholder hit on every cue.

Two ways to run it:
  studio score <dir>                     runs this bundled file against <dir>/project.json and writes <dir>/src/assets/score.wav
  python scripts/score.py [out.wav]      the copy that `studio new --mode film` puts in the project; it reads the project.json
                                         one folder above itself, so write the real score in that copy
  python score.py [out.wav] --project <dir>   the same, for a project folder given explicitly

The music and every sound effect are placed at the cue times from project.json "cues" (C["name"]), so the picture
(CUE.name in the page) and the sound share one cue sheet. Deterministic: fixed seed, no clock, so two runs give the same file.
The master bus at the end (leveler and bus compressor) keeps an effects heavy score near -14 LUFS; keep it.
"""
import sys, json, pathlib, numpy as np, soundfile as sf
ARGS = sys.argv[1:]
if "--project" in ARGS:
    i = ARGS.index("--project"); HERE = pathlib.Path(ARGS[i + 1]).resolve() if i + 1 < len(ARGS) else sys.exit("--project needs the project folder"); del ARGS[i:i + 2]
else:
    HERE = pathlib.Path(__file__).resolve().parent.parent
if not (HERE / "project.json").is_file(): sys.exit(f"ERROR: {HERE} has no project.json (give the project folder with --project)")
PROJ = json.loads((HERE / "project.json").read_text())
C = {k: float(v["t"] if isinstance(v, dict) else v) for k, v in (PROJ.get("cues") or {}).items()}   # cue name -> seconds
SR = 48000; DUR = max([float(s.get("end", 0)) for s in PROJ.get("scenes", [])] + [0]) or float(PROJ.get("length", 30)); N = int(SR * DUR); L = np.zeros(N); R = np.zeros(N); rng = np.random.default_rng(21)
def put(sig, t, pan=0.0, g=1.0):
    i = int(t * SR); j = min(N, i + len(sig))
    if j <= i: return
    s = sig[: j - i] * g; L[i:j] += s * (1 - max(0, pan)); R[i:j] += s * (1 + min(0, pan))
def env(n, a=.003, d=.3): t = np.arange(n) / SR; return np.minimum(1, t / a) * np.exp(-t / d)
def T(d): return np.arange(int(d * SR)) / SR
def noise(d, smooth=1): x = rng.standard_normal(int(d * SR)); return np.convolve(x, np.ones(smooth) / smooth, "same") if smooth > 1 else x
def sine(f, d): return np.sin(2 * np.pi * f * T(d))
def glide(f0, f1, d): t = T(d); f = f0 * (f1 / f0) ** (t / d); return np.sin(2 * np.pi * np.cumsum(f) / SR)
# instruments
def pizz(f, g=.16): t = T(.35); return (np.sin(2*np.pi*f*t) + .45*np.sin(4*np.pi*f*t) + .2*np.sin(6*np.pi*f*t)) * env(len(t), .002, .09) * g
def bell(f, g=.1, d=1.4): t = T(d); return (np.sin(2*np.pi*f*t) + .5*np.sin(2*np.pi*f*2.76*t)*np.exp(-t*4) + .25*np.sin(2*np.pi*f*5.4*t)*np.exp(-t*8)) * env(len(t), .001, d*.4) * g
def mbox(f, g=.09): t = T(1.2); return (np.sin(2*np.pi*f*t) + .3*np.sin(2*np.pi*f*3*t)*np.exp(-t*6)) * env(len(t), .001, .35) * g
def whistle(f, d, g=.07): t = T(d); vib = 1 + .012 * np.sin(2*np.pi*6*t); return np.sin(2*np.pi*np.cumsum(f*vib)/SR) * np.minimum(1, t/.03) * np.minimum(1, (d-t)/.05) * g
def pad(fs, d, g=.02): t = T(d); s = sum(np.sin(2*np.pi*f*t + k) + .3*np.sin(2*np.pi*f*2.003*t) for k, f in enumerate(fs)); return s * np.minimum(1, t/.6) * np.minimum(1, np.maximum(0, d-t)/.8) * g
def tom(f=90, g=.6): t = T(.5); fr = f * (1 + .8*np.exp(-t*20)); return np.sin(2*np.pi*np.cumsum(fr)/SR) * env(len(t), .001, .16) * g
def kick(g=.7): t = T(.3); f = 50 + 110*np.exp(-t*32); return np.sin(2*np.pi*np.cumsum(f)/SR) * env(len(t), .001, .12) * g
def snare(g=.3): n = int(.2*SR); return (rng.standard_normal(n)*.7 + sine(200, .2)*.3) * env(n, .001, .06) * g
def hat(g=.08): n = int(.05*SR); x = np.diff(np.concatenate([[0], rng.standard_normal(n)])); return x * env(n, .001, .015) * g
def saw(f, d): t = T(d); return 2 * ((f * t) % 1) - 1
def stab(fs, d=.5, g=.12): return sum(saw(f, d) for f in fs) * env(int(d*SR), .004, d*.35) * g / len(fs)
def ost(f, g=.07): d = .12; return saw(f, d) * env(int(d*SR), .002, .05) * g
def bass(f, d, g=.25): t = T(d); return np.tanh(1.8*np.sin(2*np.pi*f*t)) * env(len(t), .004, d*.6) * g
# effects
def rumble(d, g=.5): x = noise(d, 400); t = T(d); return x * np.minimum(1, t/(d*.6)) * g * 3
def roar(d=1.4, g=.9): t = T(d); x = noise(d, 60) * (1 + .6*np.sin(2*np.pi*23*t)); return (x * 2.5 + glide(110, 70, d) * .5) * np.sin(np.pi * t / d) ** .6 * g
def thunder(g=.8): d = 2.2; t = T(d); return noise(d, 150) * 4 * (np.exp(-t*2.5) + .4*np.exp(-t*.8)) * g
def whoosh(d=.6, g=.7): t = T(d); return noise(d, 28) * np.exp(-((t-d*.55)/(d*.25))**2) * g
def flutter(d=.4, g=.25): t = T(d); return noise(d, 6) * (np.sin(2*np.pi*40*t) > 0) * np.sin(np.pi*t/d) * g
def ring(g=.05): t = T(.9); return (np.sin(2*np.pi*1300*t) + np.sin(2*np.pi*1650*t)) * (np.sin(2*np.pi*22*t) > 0) * (t % .45 < .3) * g
def step(g=.2): t = T(.04); return sine(160, .04) * env(len(t), .001, .01) * g
def boing(f=260, g=.25): t = T(.4); fr = f * (1 + .5*np.sin(2*np.pi*16*t)*np.exp(-t*7)); return np.sin(2*np.pi*np.cumsum(fr)/SR) * env(len(t), .002, .14) * g
def thud(g=1.0): t = T(.6); f = 38 + 70*np.exp(-t*18); return (np.sin(2*np.pi*np.cumsum(f)/SR) * env(len(t), .001, .22) + noise(.6, 20) * env(len(t), .001, .05) * 1.5) * .7 * g
def squeak(g=.12): t = T(.22); f = 900 + 700*np.sin(np.pi*t/.22); return np.sin(2*np.pi*np.cumsum(f)/SR) * env(len(t), .005, .08) * g
def screech(g=.1): t = T(.5); return noise(.5, 3) * np.sin(2*np.pi*2400*t) * np.sin(np.pi*t/.5) * g
def shimmer(d=1.4, g=.1): t = T(d); s = sum(np.sin(2*np.pi*f*t + k) for k, f in enumerate([1568, 2093, 2637, 3136])); return s * np.sin(np.pi*t/d)**2 * (1 + .5*np.sin(2*np.pi*9*t)) * g * .25
def clank(g=.25): t = T(.5); return sum(np.sin(2*np.pi*f*t)*np.exp(-t*k) for f, k in [(620, 9), (1340, 14), (2210, 20)]) * env(len(t), .0005, .4) * g
def tink(g=.08): t = T(.3); return np.sin(2*np.pi*4200*t) * env(len(t), .0005, .06) * g
def nope(g=.06): t = T(.35); return np.sign(np.sin(2*np.pi*110*t)) * env(len(t), .005, .12) * g
def knock(g=.45): t = T(.18); return (np.sin(2*np.pi*190*t) + .6*np.sin(2*np.pi*410*t)) * env(len(t), .0005, .03) * g
def click(g=.35): n = int(.06*SR); return rng.standard_normal(n) * env(n, .0005, .008) * g
def creak(g=.05): t = T(.6); f = 170 + 60*np.sin(2*np.pi*3*t) + rng.standard_normal(len(t)).cumsum()*.02; return np.sin(2*np.pi*np.cumsum(f)/SR) * np.sin(np.pi*t/.6) * g * (1 + np.sign(np.sin(2*np.pi*31*t)))
def splat(g=.35): t = T(.35); return (noise(.35, 12)*1.5 + np.sin(2*np.pi*np.cumsum(300*np.exp(-t*9))/SR)) * env(len(t), .001, .09) * g
def puff(g=.12): t = T(.35); return noise(.35, 40) * np.sin(np.pi*t/.35) * g * 3
def tweet(f=2600): t = T(.12); fr = f*(1 + .25*np.sin(2*np.pi*28*t)); return np.sin(2*np.pi*np.cumsum(fr)/SR) * np.sin(np.pi*t/.12) * .05
def pop(f=700, g=.3): t = T(.12); fr = f*(1 + 1.5*np.exp(-t*60)); return np.sin(2*np.pi*np.cumsum(fr)/SR) * env(len(t), .001, .04) * g
def slide(f0, f1, d, g=.1): t = T(d); return glide(f0, f1, d) * np.minimum(1, t/.02) * np.minimum(1, (d-t)/.03) * g
def breath(g=.08): t = T(.45); return noise(.45, 30) * np.sin(np.pi*t/.45)**2 * g * 3
# ---------------- the score: replace this example ----------------
put(pad([261.6, 329.6, 392.0], min(DUR, 8.0), .018), 0.0)                  # a warm bed
for name, t in C.items():                                                 # a placeholder hit on every cue
    put(pop(700, .25), t)
# ---------------- master bus (keep) ----------------
mix = np.stack([L, R], 1); mix /= np.max(np.abs(mix))
# leveler: lift the quiet stretches (inside the room, the music box) toward the chase level, max +8 dB
W2 = int(SR * .4); nw = N // W2 + 1; rms = np.array([np.sqrt(np.mean(mix[i * W2:(i + 1) * W2] ** 2)) if i * W2 < N else 0 for i in range(nw)])
tgt = np.percentile(rms[rms > 1e-4], 85); lg = np.clip((tgt / np.maximum(rms, 1e-6)) ** .6, .7, 2.5)
for i in range(1, nw): lg[i] = lg[i - 1] + (lg[i] - lg[i - 1]) * .35              # ~1 s smoothing
for i in range(nw - 2, -1, -1): lg[i] = lg[i + 1] + (lg[i] - lg[i + 1]) * .5
mix *= np.interp(np.arange(N), np.arange(nw) * W2 + W2 / 2, lg)[:, None]; mix /= np.max(np.abs(mix))
# bus compressor (10:1 above -16.5 dBFS, block-wise with a smoothed gain) so the thuds don't set the loudness
B = 256; nb = N // B + 1; pk = np.array([np.max(np.abs(mix[i * B:(i + 1) * B])) if i * B < N else 0 for i in range(nb)])
thr = .15; g = np.where(pk > thr, (thr / np.maximum(pk, 1e-9)) ** .9, 1.0)
for i in range(1, nb): g[i] = min(g[i], g[i - 1] + .04)          # quick attack, ~0.15 s release
for i in range(nb - 2, -1, -1): g[i] = min(g[i], g[i + 1] + .25)  # a little look-ahead
mix *= np.interp(np.arange(N), np.arange(nb) * B + B / 2, g)[:, None]; mix /= np.max(np.abs(mix)) * 1.05
mix *= np.minimum(1, (DUR - np.arange(N) / SR) / 1.4)[:, None]
out = ARGS[0] if ARGS else "score.wav"; pathlib.Path(out).resolve().parent.mkdir(parents=True, exist_ok=True); sf.write(out, mix.astype("float32"), SR); print(out, DUR, "s")

