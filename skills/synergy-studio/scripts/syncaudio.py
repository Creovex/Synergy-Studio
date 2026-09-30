"""Audio in a finished MP4 against the mix it was made from (LITE 7.9 A).

Run through `check`:  python syncaudio.py <video.mp4> <mix.wav> <fps> [ffmpeg] [video_seconds]
Both audio tracks are decoded to mono 8 kHz, reduced to RMS envelopes in 10 ms windows and cross correlated over
+-0.5 s. The mix is compared over the video's duration only (it runs about a second longer: trailing silence).
Prints one JSON object:
  lag_ms, lag_frames   where the video's sound sits against the mix (positive = the video's sound is late)
  correlation          Pearson correlation of the two envelopes at that lag
  tail                 the last 2 s on their own: correlation at the same lag, level difference in dB
  short_s              seconds the MP4's sound ends before its picture (when video_seconds is given)
  silent               stretches of 0.5 s or more that are silent in the MP4 but not in the mix: [{start, end}]
  pass, problems       the verdict and one plain sentence per failed test
The MP4's sound is padded with silence up to the video's duration and cut at it, so sound that stops early shows as silence.
Exit 0 whenever the two tracks could be compared (pass or not), 1 with a message on stderr otherwise.
"""
import json
import subprocess
import sys

import numpy as np

SR = 8000                     # decode rate
WIN = SR // 100               # 10 ms window
MAX_LAG_S = 0.5
MIN_CORRELATION = 0.9    # minimum correlation
TAIL_S = 2.0
SILENT_MIN_S = 0.5
MIX_SOUND_DB = -50.0          # the mix is "not silent" above this envelope level
VIDEO_SILENT_DB = -65.0       # the MP4 is "silent" below this level, and at least 30 dB under the mix
TAIL_LEVEL_TOLERANCE_DB = 3.0
END_TOLERANCE_S = 0.05        # AAC priming can make the decoded sound a few ms shorter than the picture
STEADY_DB = 2.0               # a tail whose envelope varies less than this (dB, standard deviation) has no shape to correlate


class SyncError(Exception):
    pass


def decode(ffmpeg: str, path: str) -> np.ndarray:
    """Mono 8 kHz float samples of the first audio stream. A late start is padded with silence (first_pts=0), so a delayed track shows as a lag."""
    r = subprocess.run([ffmpeg, "-v", "error", "-i", path, "-vn", "-af", "aresample=async=1:first_pts=0",
                        "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                       capture_output=True)
    if r.returncode != 0:
        raise SyncError(f"could not read the audio of {path}: {r.stderr.decode(errors='replace').strip()[-300:]}")
    x = np.frombuffer(r.stdout, dtype="<f4").astype(np.float64)
    if x.size < WIN * 10:
        raise SyncError(f"{path} has no audio to compare (under 0.1 s of sound data)")
    return x


def envelope(x: np.ndarray) -> np.ndarray:
    """RMS in consecutive 10 ms windows."""
    n = x.size // WIN
    return np.sqrt(np.mean(x[: n * WIN].reshape(n, WIN) ** 2, axis=1))


def to_db(env: np.ndarray) -> np.ndarray:
    return 20 * np.log10(np.maximum(env, 1e-7))


def pearson(a: np.ndarray, b: np.ndarray) -> float:
    if a.size < 3 or a.std() < 1e-12 or b.std() < 1e-12:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def overlap(video: np.ndarray, mix: np.ndarray, lag: int) -> tuple[np.ndarray, np.ndarray]:
    """The parts of both envelopes that line up when the video's sound sits `lag` windows after the mix's."""
    lo, hi = max(0, lag), min(video.size, mix.size + lag)
    if hi - lo < 3:
        return video[:0], mix[:0]
    return video[lo:hi], mix[lo - lag:hi - lag]


def correlate(video: np.ndarray, mix: np.ndarray, max_lag: int) -> tuple[int, float]:
    """The lag (in windows) with the best Pearson correlation, and that correlation."""
    best_lag, best = 0, -2.0
    for lag in range(-max_lag, max_lag + 1):
        v, m = overlap(video, mix, lag)
        c = pearson(v, m)
        if c > best:
            best_lag, best = lag, c
    return best_lag, best


def silent_stretches(video_db: np.ndarray, mix_db: np.ndarray, lag: int) -> list[dict]:
    """Runs of at least 0.5 s where the MP4 is silent and the mix is not (mix positions shifted by the lag)."""
    n = video_db.size
    silent = np.zeros(n, dtype=bool)
    for i in range(n):
        j = i - lag
        if 0 <= j < mix_db.size:
            silent[i] = mix_db[j] > MIX_SOUND_DB and video_db[i] < VIDEO_SILENT_DB and video_db[i] < mix_db[j] - 30
    runs, start = [], None
    for i in range(n + 1):
        on = i < n and silent[i]
        if on and start is None:
            start = i
        elif not on and start is not None:
            if (i - start) * 0.01 >= SILENT_MIN_S:
                runs.append({"start": round(start * 0.01, 2), "end": round(i * 0.01, 2)})
            start = None
    return runs


def tail_report(video: np.ndarray, mix: np.ndarray, video_db: np.ndarray, mix_db: np.ndarray, lag: int, gain_db: float) -> dict:
    """The last 2 s of the video: envelope correlation at the overall lag and the level gap beyond the overall gain."""
    n = int(TAIL_S * 100)
    lo = max(0, video.size - n)
    v = video[lo:]
    m_idx = np.arange(lo, video.size) - lag
    ok = (m_idx >= 0) & (m_idx < mix.size)
    if ok.sum() < 20:
        return {"correlation": 0.0, "level_diff_db": None, "pass": False, "note": "the mix does not reach the end of the video"}
    v, m = v[ok], mix[m_idx[ok]]
    vd, md = video_db[lo:][ok], mix_db[m_idx[ok]]
    corr = pearson(v, m)
    level = float(np.mean(vd) - np.mean(md) - gain_db)          # how far the tail's level is from the overall level difference
    steady = float(np.std(md)) < STEADY_DB and float(np.std(vd)) < STEADY_DB
    ok_level = abs(level) <= TAIL_LEVEL_TOLERANCE_DB
    passed = ok_level and (corr >= MIN_CORRELATION or steady)
    return {"correlation": round(corr, 3), "level_diff_db": round(level, 1), "pass": bool(passed),
            "note": "steady tail: level compared instead of shape" if steady and corr < MIN_CORRELATION else ""}


def fit_to_video(x: np.ndarray, seconds: float | None) -> tuple[np.ndarray, float]:
    """The samples cut or zero padded to the video's duration, and how many seconds short they were (0 when not short)."""
    if seconds is None:
        return x, 0.0
    n = int(round(seconds * SR))
    short = max(0.0, (n - x.size) / SR)
    return (x[:n] if x.size >= n else np.concatenate([x, np.zeros(n - x.size)])), short


def analyse(video_path: str, mix_path: str, fps: float, ffmpeg: str = "ffmpeg", video_seconds: float | None = None) -> dict:
    samples, short = fit_to_video(decode(ffmpeg, video_path), video_seconds)
    video = envelope(samples)
    mix = envelope(decode(ffmpeg, mix_path))
    mix = mix[: video.size + int(MAX_LAG_S * 100) + 1]                # the video's duration (plus room for the lag)
    lag, corr = correlate(video, mix, int(MAX_LAG_S * 100))
    lag_ms = lag * 10
    frame_ms = 1000.0 / fps
    video_db, mix_db = to_db(video), to_db(mix)
    v, m = overlap(video_db, mix_db, lag)
    loud = m > MIX_SOUND_DB
    gain_db = float(np.median(v[loud] - m[loud])) if loud.any() else 0.0
    tail = tail_report(video, mix, video_db, mix_db, lag, gain_db)
    silent = silent_stretches(video_db, mix_db, lag)
    problems = []
    if short > max(1.0 / fps, END_TOLERANCE_S):
        problems.append(f"the sound in the video ends {short:.2f} s before the picture does")
    if abs(lag_ms) > frame_ms + 1e-6:
        problems.append(f"the sound in the video is {abs(lag_ms)} ms {'late' if lag_ms > 0 else 'early'} against audio/mix.wav "
                        f"(more than one frame, {frame_ms:.0f} ms)")
    if corr < MIN_CORRELATION:
        problems.append(f"the sound in the video does not follow audio/mix.wav (correlation {corr:.2f}, needs {MIN_CORRELATION})")
    if not tail["pass"]:
        problems.append("the last 2 s of the video do not match the end of the mix (cut off or changed)")
    for s in silent:
        problems.append(f"silent from {s['start']} s to {s['end']} s in the video where the mix has sound")
    return {"lag_ms": lag_ms, "lag_frames": round(lag_ms / frame_ms, 2), "short_s": round(short, 2), "correlation": round(corr, 3), "gain_db": round(gain_db, 1),
            "tail": tail, "silent": silent, "pass": not problems, "problems": problems}


def main(argv: list[str]) -> None:
    if len(argv) < 4:
        sys.exit("usage: syncaudio.py <video.mp4> <mix.wav> <fps> [ffmpeg] [video_seconds]")
    try:
        fps = float(argv[3])
        if fps <= 0:
            raise ValueError
    except ValueError:
        sys.exit(f"fps must be a positive number, got {argv[3]!r}")
    try:
        seconds = float(argv[5]) if len(argv) > 5 else None
    except ValueError:
        sys.exit(f"video_seconds must be a number, got {argv[5]!r}")
    try:
        result = analyse(argv[1], argv[2], fps, argv[4] if len(argv) > 4 else "ffmpeg", seconds)
    except SyncError as err:
        sys.exit(str(err))
    print(json.dumps(result))


if __name__ == "__main__":
    main(sys.argv)
