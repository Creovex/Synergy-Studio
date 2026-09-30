"""Find the beat grid of a song (numpy only; good enough to cut pictures on the beat).

Run through the CLI:  node scripts/studio.mjs beats <project> <song file> [--start 47.3]
Writes <project>/beats.json: {"bpm", "beats": [t...], "downbeats": [t...]} in seconds from --start.
Method: spectral-flux onset envelope -> every tempo 70-180 BPM (0.25 steps) and 48 phases scored by the
mean onset strength on its beat grid (sub-frame period), with a double-tempo check -> downbeats = every 4th beat starting on the strongest of the first four.
Run it on the SONG (not on a mix with narration: the voice confuses it). Check by ear or by the video:
a beat detector can pick half or double tempo; set the times by hand if so.
"""
import json, sys, subprocess, tempfile, pathlib
import numpy as np, soundfile as sf

ffmpeg, proj, song = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
start = float(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else 0.0
SR, HOP, N = 22050, 256, 2048
if not pathlib.Path(song).is_file(): sys.exit(f"song not found: {song}")
tmp = proj / "_beats.wav"
subprocess.run([ffmpeg, "-loglevel", "error", "-y", "-ss", str(start), "-i", song, "-ac", "1", "-ar", str(SR), str(tmp)], check=True)
x, _ = sf.read(tmp, dtype="float32"); tmp.unlink()
frames = np.lib.stride_tricks.sliding_window_view(np.pad(x, (0, N)), N)[::HOP] * np.hanning(N)
mag = np.log1p(np.abs(np.fft.rfft(frames, axis=1)))
flux = np.maximum(0, np.diff(mag, axis=0)).sum(1)
env = flux - np.convolve(flux, np.ones(16) / 16, "same"); env = np.maximum(env, 0)
fps = SR / HOP
env = env / (env.max() or 1)

def comb(bpm):
    """best (score, phase) of a beat grid at this tempo: mean onset strength on the grid (sub-frame period)"""
    per = fps * 60 / bpm; best = (-1, 0.0)
    for ph in np.linspace(0, per, 48, endpoint=False):
        idx = np.round(np.arange(ph, len(env) - 1, per)).astype(int)
        sc = env[idx].mean()
        if sc > best[0]: best = (sc, ph)
    return best

grid = np.arange(70, 180.01, 0.25)
scores = np.array([comb(b)[0] for b in grid])
bpm = float(grid[np.argmax(scores)])
# octave check: a grid at double tempo that is nearly as strong means the true beat is the faster one
b2 = bpm * 2
if b2 <= 180 and comb(b2)[0] > 0.85 * comb(bpm)[0]:
    bpm = b2
sc, ph = comb(bpm)
per = fps * 60 / bpm
LAG = 0.074   # onset frames report each hit early (window centre + flux diff); measured on a synthetic 118 BPM track
per_s = per / fps
first = ph / fps + LAG
first -= per_s * np.floor(first / per_s)          # earliest beat at or after 0
if first - per_s > -0.06:                          # a hit right at the start is measured a few ms early: keep it (at 0)
    first -= per_s
beats = np.maximum(0, np.arange(first, len(x) / SR, per_s))
strength = [env[min(len(env) - 1, int(round((b - LAG) * fps)))] for b in beats[:4]]
d0 = int(np.argmax(strength)) if strength else 0
out = {"song": song, "start": start, "bpm": round(float(bpm), 2),
       "beats": [round(float(b), 3) for b in beats], "downbeats": [round(float(b), 3) for b in beats[d0::4]]}
(proj / "beats.json").write_text(json.dumps(out, indent=1))
print(f"{out['bpm']} BPM, {len(out['beats'])} beats, first downbeat at {out['downbeats'][0] if out['downbeats'] else '-'} s -> beats.json")
