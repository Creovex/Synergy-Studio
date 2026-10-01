"""Speech helpers for the voice step: text the voice reads badly, pauses inside a spoken line.

normalise(text)        -> (spoken text, [changes])   abbreviations and symbols the voice misreads, in their spoken form
risky(text)            -> [warnings]                 what is left that the voice may still misread (a lexicon entry fixes it)
internal_pauses(a, sr) -> [(at_s, length_s)]         silences inside a line, longer than the voice's own sentence breaks
balance(vo, music, fx, sr, events) -> report          music under the voice and effects against the voice, in dB

Measured on Kokoro af_heart (2026-09-30): "2 a.m." is heard back as "2A, M." (read as spelled letters with a break),
"2am" and "2 AM" as "2 a.m."; sentence breaks inside a line are 0.22 to 0.52 s long.
"""
import re

import numpy as np

# (pattern, spoken form); applied in order, whole words only, case-insensitive
_RULES = [
    (r"\b(\d{1,2})(?::(\d{2}))?\s*a\.?\s?m\.?(?=[\s,;:!?)]|$)", lambda m: f"{m.group(1)}{':' + m.group(2) if m.group(2) else ''} AM"),
    (r"\b(\d{1,2})(?::(\d{2}))?\s*p\.?\s?m\.?(?=[\s,;:!?)]|$)", lambda m: f"{m.group(1)}{':' + m.group(2) if m.group(2) else ''} PM"),
    (r"\ba\.m\.", "AM"),
    (r"\bp\.m\.", "PM"),
    (r"\be\.g\.,?", "for example"),
    (r"\bi\.e\.,?", "that is"),
    (r"\betc\.", "and so on"),
    (r"\bvs\.?(?=\s)", "versus"),
    (r"\bapprox\.(?=\s)", "about"),
    (r"\bDr\.(?=\s)", "Doctor"),
    (r"\bMr\.(?=\s)", "Mister"),
    (r"\bMrs\.(?=\s)", "Missus"),
    (r"\bMs\.(?=\s)", "Miz"),
    (r"\bSt\.(?=\s[A-Z])", "Saint"),
    (r"\bno\.\s?(?=\d)", "number "),
    (r"\s&\s", " and "),
    (r"(\d[\d.,]*)\s?%", r"\1 percent"),
    (r"\+(?=\s|$)", " plus"),
]


_TITLE = re.compile(r"(?i)(dr|mr|mrs|ms|st|no)\.")


def normalise(text):
    """The text in the form the voice reads well, and a list of "before -> after" changes."""
    changes = []
    out = text
    for pattern, repl in _RULES:
        def sub(m, repl=repl):
            new = repl(m) if callable(repl) else m.expand(repl)
            rest = m.string[m.end():]
            # the abbreviation's last dot also ended the sentence ("close at 3 p.m." / "7 a.m. Then"): keep a full stop
            # (titles like Dr. and St. come before a name, so a capital after them never starts a new sentence)
            ends = not rest.strip() or (re.match(r"\s+[A-Z]", rest) and not _TITLE.match(m.group(0)))
            if m.group(0).rstrip().endswith(".") and not new.rstrip().endswith(".") and ends:
                new = new.rstrip() + "."
            if new != m.group(0):
                changes.append(f"{m.group(0).strip()!r} -> {new.strip()!r}")
            return new
        out = re.sub(pattern, sub, out, flags=re.IGNORECASE)
    return re.sub(r"\s{2,}", " ", out).strip(), changes


_RISKY = [
    (r"https?://\S+|www\.\S+|\b\w+\.(?:com|org|net|io|ai|co|app)\b", "a web address: write how it should be said (\"allspace dot com\") or add a lexicon entry"),
    (r"[$€£]\s?\d[\d,.]*", "an amount of money: write it out (\"twenty five dollars\")"),
    (r"[#@/*_~^<>|\\{}\[\]=]", "a symbol the voice reads aloud or skips: write the words instead"),
    (r"\b[A-Za-z]{1,4}\.(?:[A-Za-z]{1,4}\.)+", "an abbreviation with dots: write how it should be said"),
    (r"[\U0001F300-\U0001FAFF☀-➿]", "an emoji: remove it"),
]


def risky(text, lexicon=None):
    """Warnings for what the voice may still misread after normalise(); lexicon words are fine."""
    lexicon = lexicon or {}
    warnings = []
    for pattern, why in _RISKY:
        for m in re.finditer(pattern, text):
            if m.group(0).strip() not in lexicon:
                warnings.append(f"{m.group(0).strip()!r} is {why}")
    return warnings


PAUSE_LIMIT_S = 0.75     # longest natural break measured inside a line is 0.52 s
_FRAME_S = 0.02
_QUIET = 0.006           # frame RMS below this is silence (the voice's own peaks are about 0.3)


def internal_pauses(a, sr, limit=PAUSE_LIMIT_S):
    """(start in s, length in s) of every silence longer than limit between the first and the last sound of a line."""
    a = np.asarray(a, dtype=np.float64)
    if a.ndim > 1:
        a = a.mean(1)
    w = max(1, int(_FRAME_S * sr))
    n = len(a) // w
    if n < 3:
        return []
    rms = np.sqrt((a[: n * w].reshape(n, w) ** 2).mean(1))
    loud = np.where(rms >= _QUIET)[0]
    if len(loud) < 2:
        return []
    out, start = [], None
    for i in range(loud[0], loud[-1] + 1):
        if rms[i] < _QUIET:
            start = i if start is None else start
        elif start is not None:
            length = (i - start) * _FRAME_S
            if length > limit:
                out.append((round(start * _FRAME_S, 2), round(length, 2)))
            start = None
    return out


_WIN_S = 0.05
MUSIC_UNDER_DB = 6.0     # music at least this far under the voice while it speaks (ARCHITECTURE.md Q20 asked 6 to 9 dB)
EFFECT_OVER_DB = 3.0     # an effect louder than this above the voice's usual level is louder than the voice


def _rms_db(x, sr):
    w = max(1, int(_WIN_S * sr))
    n = len(x) // w
    if n == 0:
        return np.array([])
    r = np.sqrt((np.asarray(x[: n * w], dtype=np.float64).reshape(n, w) ** 2).mean(1))
    return 20 * np.log10(np.maximum(r, 1e-6))


def layer_levels(vo, music, fx, sr):
    """Levels in dB every 50 ms of each layer as it goes into the mix (for studio inspect)."""
    return {"step": _WIN_S, **{k: [round(float(x), 1) for x in _rms_db(a, sr)] for k, a in (("voice", vo), ("music", music), ("effects", fx))}}


def balance(vo, music, fx, sr, events):
    """Levels of the three layers as they go into the mix. events: [(time_s, name)] of the sound effects.
    Returns {voice_db, music_under_db, music_ok, effects: [{at, name, over_voice_db, ok}]}; None values when a layer is absent."""
    v, m, f = _rms_db(vo, sr), _rms_db(music, sr), _rms_db(fx, sr)
    speech = v > -40
    out = {"voice_db": None, "music_under_db": None, "music_ok": True, "effects": []}
    if speech.sum() < 4:
        return out
    voice = float(np.median(v[speech]))
    out["voice_db"] = round(voice, 1)
    if m.size and (m[speech] > -60).any():
        under = voice - float(np.median(m[speech]))
        out["music_under_db"] = round(under, 1)
        out["music_ok"] = under >= MUSIC_UNDER_DB
    for t, name in events:
        i0, i1 = max(0, int((t - 0.4) / _WIN_S)), min(len(f), int((t + 0.4) / _WIN_S) + 1)
        if i1 <= i0:
            continue
        over = float(f[i0:i1].max()) - voice
        out["effects"].append({"at": round(t, 2), "name": name, "over_voice_db": round(over, 1), "ok": over <= EFFECT_OVER_DB})
    return out
