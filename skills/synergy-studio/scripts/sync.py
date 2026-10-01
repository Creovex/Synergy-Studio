"""A/V sync of the cues marked "sync": true: where does the sound's hit start, compared with the cue time?

Usage: python sync.py <mono.wav> '<{"name": seconds}>' [fps]   Prints JSON [{name, t, onset, d, sharp}] (d in seconds).
Onsets are sharp rises of the 5 ms energy (at least 6 dB within 10 ms). Of the onsets within +-0.15 s of the
cue, the nearest one counts, so a drum or a lead-in whoosh just before or after the hit does not fool it.
"sharp" says whether a sharp onset was found. With none (the sound only swells there, or sits steady), onset and d are the
first point that reaches half the window's peak, which is a guess at best: the caller must not treat it as a measurement.
With no sound in the window at all, onset and d are null and sharp is false.
"""
import json
import sys

import numpy as np
import soundfile as sf

WINDOW = 0.15          # seconds each side of the cue that are searched
RISE_DB = 6            # an onset: at least this many dB of rise ...
RISE_MS = 10           # ... within this many milliseconds


def onsets(x: np.ndarray, sr: int, cues: dict, window: float = WINDOW) -> list:
    """For each cue the start of the sound nearest to it (seconds) and its offset from the cue."""
    n5, lag = max(1, int(sr * .005)), max(1, int(sr * RISE_MS / 1000))
    e = np.convolve(x ** 2, np.ones(n5) / n5, "same") + 1e-12
    db = 10 * np.log10(e)
    rise = np.zeros_like(db)
    rise[lag:] = db[lag:] - db[:-lag]
    out = []
    for name, t in cues.items():
        t = float(t)
        a, b = max(lag, int((t - window) * sr)), min(len(e), int((t + window) * sr))
        seg = e[a:b]
        if len(seg) == 0 or seg.max() <= 1e-10:
            out.append({"name": name, "t": t, "onset": None, "d": None, "sharp": False})
            continue
        r, win = rise[a:b], max(1, int(sr * .015))
        peaks = [i for i in np.flatnonzero(r >= RISE_DB) if r[i] == r[max(0, i - win):i + win + 1].max()]
        if peaks:
            # the rise peaks about half the lag after the sound starts: step back to where it began
            on = min(((a + i - lag // 2) / sr for i in peaks), key=lambda o: abs(o - t))
        else:
            on = (a + int(np.argmax(seg > seg.max() * .5))) / sr
        out.append({"name": name, "t": t, "onset": round(on, 3), "d": round(on - t, 3), "sharp": bool(peaks)})
    return out


def main(argv: list) -> int:
    if len(argv) < 3:
        print("usage: python sync.py <mono.wav> '<{\"name\": seconds}>' [fps]", file=sys.stderr)
        return 1
    x, sr = sf.read(argv[1], dtype="float64")
    if x.ndim > 1:
        x = x.mean(1)
    print(json.dumps(onsets(x, sr, json.loads(argv[2]))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
