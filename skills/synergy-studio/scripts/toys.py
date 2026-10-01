"""Toy sounds for the score file: procedural instruments, a toy drum kit and cartoon effects, made from oscillators and
noise (no samples). They are the playful, cartoon, chiptune engine of the music-for-picture skill; the SoundFont
instruments (instruments.py) are the real one, and a score may use both.

In src/score.json:
  a track   {"synth": "pizz", "notes": [...], "chords": [...]}      voices: see VOICES
  drums     {"kit": "toy", "grids": [{"bars": "1-4", "kick": "x...", "snare": "....x..."}]}   drums: see KIT
  a hit     {"at": "cue:fall", "sound": "boing"}                    sounds: see HITS

Every sound starts on its own sample. Noise comes from a fixed bit generator stream keyed by the score's seed and the
event, so a rebuild gives the same bytes. The voices follow the bundled starter score (template/score.py).
"""
import hashlib
import json

import numpy as np

SR = 48000


# ---------------------------------------------------------------- building blocks
def _t(d):
    return np.arange(int(d * SR)) / SR


def _env(n, a=0.003, d=0.3):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)


def _noise(n, key, smooth=1):
    """Gaussian noise from raw 64 bit words of a PCG64 stream (Box Muller): the same key always gives the same samples."""
    seed = int.from_bytes(hashlib.blake2b(json.dumps(key).encode(), digest_size=8).digest(), "big")
    raw = np.random.PCG64(seed).random_raw(2 * n + 2)
    u1 = (raw[0::2][: n] >> 11).astype(np.float64) / 2.0 ** 53 + 2.0 ** -54
    u2 = (raw[1::2][: n] >> 11).astype(np.float64) / 2.0 ** 53
    x = np.sqrt(-2 * np.log(u1)) * np.cos(2 * np.pi * u2)
    return np.convolve(x, np.ones(smooth) / smooth, "same") if smooth > 1 else x


def _sweep(f):
    """A sine following the frequency curve f (one value per sample)."""
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def _glide(f0, f1, d):
    t = _t(d)
    return _sweep(f0 * (f1 / f0) ** (t / d))


def _saw(f, d):
    return 2 * ((f * _t(d)) % 1) - 1


# ---------------------------------------------------------------- toy instruments: (frequency, seconds) -> samples
def pizz(f, d):
    t = _t(0.35)
    return (np.sin(2 * np.pi * f * t) + 0.45 * np.sin(4 * np.pi * f * t) + 0.2 * np.sin(6 * np.pi * f * t)) * _env(len(t), 0.002, 0.09) * 0.16


def bell(f, d):
    t = _t(1.4)
    tone = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 4) + 0.25 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 8)
    return tone * _env(len(t), 0.001, 0.56) * 0.1


def musicbox(f, d):
    t = _t(1.2)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 3 * t) * np.exp(-t * 6)) * _env(len(t), 0.001, 0.35) * 0.09


def whistle(f, d):
    d = max(d, 0.1)
    t = _t(d)
    return _sweep(f * (1 + 0.012 * np.sin(2 * np.pi * 6 * t))) * np.minimum(1, t / 0.03) * np.minimum(1, (d - t) / 0.05) * 0.07


def pad(f, d):
    d = max(d, 0.4)
    t = _t(d)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.003 * t)) * np.minimum(1, t / 0.6) * np.minimum(1, np.maximum(0, d - t) / 0.8) * 0.03


def bass(f, d):
    d = max(d, 0.08)
    t = _t(d)
    return np.tanh(1.8 * np.sin(2 * np.pi * f * t)) * _env(len(t), 0.004, d * 0.6) * 0.25


def stab(f, d):
    d = max(d, 0.08)
    return _saw(f, d) * _env(int(d * SR), 0.004, d * 0.35) * 0.12


def square(f, d):
    """The chiptune lead: a square wave with a short release."""
    d = max(d, 0.05)
    t = _t(d)
    return np.sign(np.sin(2 * np.pi * f * t)) * np.minimum(1, t / 0.002) * np.minimum(1, (d - t) / 0.01) * 0.06


VOICES = {"pizz": pizz, "bell": bell, "musicbox": musicbox, "whistle": whistle, "pad": pad, "bass": bass, "stab": stab, "square": square}
DRY_VOICES = {"bass"}


# ---------------------------------------------------------------- the toy kit: key -> (seconds, sound)
def _kick(key):
    t = _t(0.3)
    return _sweep(50 + 110 * np.exp(-t * 32)) * _env(len(t), 0.001, 0.12) * 0.7


def _snare(key):
    n = int(0.2 * SR)
    return (_noise(n, key) * 0.7 + np.sin(2 * np.pi * 200 * _t(0.2)) * 0.3) * _env(n, 0.001, 0.06) * 0.3


def _clap(key):
    n = int(0.15 * SR)
    burst = sum(np.roll(_env(n, 0.0005, 0.008), int(k * 0.011 * SR)) for k in range(3)) + _env(n, 0.0005, 0.05) * 0.6
    return _noise(n, key, 3) * burst * 0.35


def _hat(key, d=0.015):
    n = int(max(0.05, d * 4) * SR)
    return np.diff(np.concatenate([[0], _noise(n, key)])) * _env(n, 0.001, d) * 0.08


def _tom(f):
    def make(key):
        t = _t(0.5)
        return _sweep(f * (1 + 0.8 * np.exp(-t * 20))) * _env(len(t), 0.001, 0.16) * 0.6
    return make


def _knock(f, g=0.45):
    def make(key):
        t = _t(0.18)
        return (np.sin(2 * np.pi * f * t) + 0.6 * np.sin(2 * np.pi * f * 2.16 * t)) * _env(len(t), 0.0005, 0.03) * g
    return make


def _shaker(key):
    n = int(0.08 * SR)
    return _noise(n, key, 2) * np.sin(np.pi * np.arange(n) / n) ** 2 * 0.12


def _crash(key):
    n = int(1.6 * SR)
    return np.diff(np.concatenate([[0], _noise(n, key)])) * _env(n, 0.001, 0.5) * 0.12


KIT = {36: _kick, 35: _kick, 38: _snare, 40: _snare, 39: _clap, 37: _knock(410, 0.35), 42: _hat, 44: _hat,
       46: lambda key: _hat(key, 0.12), 45: _tom(90), 41: _tom(80), 48: _tom(130), 50: _tom(180),
       76: _knock(800, 0.4), 77: _knock(560, 0.4), 70: _shaker, 49: _crash, 57: _crash, 55: _crash}
DRY_KIT = {35, 36}
KIT_LEVEL = 0.4          # -8 dB: the starter score's drums stand alone; in a score they sit with the instruments (measured: 0 dBFS against -10 to -14)


# ---------------------------------------------------------------- cartoon hits: name -> (samples, where the moment is)
def _boing(key, f):
    t = _t(0.4)
    return _sweep(f * (1 + 0.5 * np.sin(2 * np.pi * 16 * t) * np.exp(-t * 7))) * _env(len(t), 0.002, 0.14) * 0.25


def _pop(key, f):
    t = _t(0.12)
    return _sweep(f * 2.7 * (1 + 1.5 * np.exp(-t * 60))) * _env(len(t), 0.001, 0.04) * 0.3


def _bonk(key, f):
    """action-sounds.md: a pitch falling pop, a wood block and a short boing."""
    out = np.zeros(int(0.45 * SR))
    for part in (_pop(key, f * 0.8), _knock(800, 0.4)(key), _boing(key, f * 1.2) * 0.6):
        out[: len(part)] += part
    return out


def _squeak(key, f):
    t = _t(0.22)
    return _sweep(900 + 700 * np.sin(np.pi * t / 0.22)) * _env(len(t), 0.005, 0.08) * 0.12


def _splat(key, f):
    t = _t(0.35)
    return (_noise(len(t), key, 12) * 1.5 + _sweep(300 * np.exp(-t * 9))) * _env(len(t), 0.001, 0.09) * 0.35


def _puff(key, f):
    t = _t(0.35)
    return _noise(len(t), key, 40) * np.sin(np.pi * t / 0.35) * 0.36


def _slide(up):
    def make(key, f):
        d = 0.6
        t = _t(d)
        a, b = (f, f * 4) if up else (f * 4, f)
        return _glide(a, b, d) * np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.03) * 0.1
    return make


def _whoosh(key, f):
    d = 0.6
    t = _t(d)
    return _noise(len(t), key, 28) * np.exp(-((t - d * 0.5) / (d * 0.25)) ** 2) * 0.7


def _riser(key, f):
    d = 1.5
    t = _t(d)
    return _noise(len(t), key, 6) * (t / d) ** 2 * 0.25 + _glide(f / 2, f * 2, d) * (t / d) ** 2 * 0.05


def _shimmer(key, f):
    d = 1.4
    t = _t(d)
    s = sum(np.sin(2 * np.pi * x * t + k) for k, x in enumerate([1568, 2093, 2637, 3136]))
    return s * np.sin(np.pi * t / d) ** 2 * (1 + 0.5 * np.sin(2 * np.pi * 9 * t)) * 0.025


def _tink(key, f):
    t = _t(0.3)
    return np.sin(2 * np.pi * 4200 * t) * _env(len(t), 0.0005, 0.06) * 0.08


def _thud(key, f):
    t = _t(0.6)
    return (_sweep(38 + 70 * np.exp(-t * 18)) * _env(len(t), 0.001, 0.22) + _noise(len(t), key, 20) * _env(len(t), 0.001, 0.05) * 1.5) * 0.7


def _nope(key, f):
    t = _t(0.35)
    return np.sign(np.sin(2 * np.pi * 110 * t)) * _env(len(t), 0.005, 0.12) * 0.06


def _tweet(key, f):
    t = _t(0.12)
    return _sweep(2600 * (1 + 0.25 * np.sin(2 * np.pi * 28 * t))) * np.sin(np.pi * t / 0.12) * 0.05


def _ring(key, f):
    t = _t(0.9)
    return (np.sin(2 * np.pi * 1300 * t) + np.sin(2 * np.pi * 1650 * t)) * (np.sin(2 * np.pi * 22 * t) > 0) * (t % 0.45 < 0.3) * 0.05


def _thunder(key, f):
    d = 2.2
    t = _t(d)
    return _noise(len(t), key, 150) * 4 * (np.exp(-t * 2.5) + 0.4 * np.exp(-t * 0.8)) * 0.8


# where the named moment sits in the sound: its start (a transient on the cue), its middle, or its end (a riser)
HITS = {"boing": (_boing, "start"), "bonk": (_bonk, "start"), "pop": (_pop, "start"), "squeak": (_squeak, "start"),
        "splat": (_splat, "start"), "puff": (_puff, "start"), "slide_up": (_slide(True), "start"),
        "slide_down": (_slide(False), "start"), "whoosh": (_whoosh, "middle"), "riser": (_riser, "end"),
        "shimmer": (_shimmer, "middle"), "tink": (_tink, "start"), "thud": (_thud, "start"), "nope": (_nope, "start"),
        "tweet": (_tweet, "start"), "ring": (_ring, "start"), "thunder": (_thunder, "start")}
HIT_LENGTH = {name: len(make(["probe"], 260.0)) / SR for name, (make, _) in HITS.items()}


def hit_start(name, at):
    """The time the hit's sound begins so that its moment lands on `at`."""
    where = HITS[name][1]
    return at - (HIT_LENGTH[name] / 2 if where == "middle" else HIT_LENGTH[name] if where == "end" else 0.0)


# ---------------------------------------------------------------- rendering
def sound_of(event, seed):
    """Samples of one toy event: ("voice", name, key, velocity, length) or ("kit", key, velocity) or ("hit", name, key)."""
    kind = event["kind"]
    if kind == "voice":
        f = 440.0 * 2 ** ((event["key"] - 69) / 12)
        return VOICES[event["name"]](f, event["length"]) * event["vel"] / 100
    if kind == "kit":
        return KIT[event["key"]]([seed, event["t"], event["key"]]) * event["vel"] / 100 * KIT_LEVEL
    f = 440.0 * 2 ** ((event["key"] - 69) / 12) / 2         # a hit's pitch sets its tone (C4 gives about 130 Hz)
    return HITS[event["name"]][0]([seed, event["t"], event["name"]], f)


def render(events, n, seed):
    """{group: (dry, wet)} stereo arrays of n samples. Each sound starts on its own sample and is panned by its event."""
    out = {}
    for e in events:
        x = sound_of(e, seed) * e["gain"]
        i = int(round(e["start"] * SR))
        j = min(n, i + len(x))
        if j <= i:
            continue
        dry, wet = out.setdefault(e["group"], (np.zeros((n, 2)), np.zeros((n, 2))))
        target = dry if e["dry"] else wet
        angle = (e["pan"] + 1) * np.pi / 4                   # constant power pan
        target[i:j, 0] += x[: j - i] * np.cos(angle) * np.sqrt(2)
        target[i:j, 1] += x[: j - i] * np.sin(angle) * np.sqrt(2)
    return out
