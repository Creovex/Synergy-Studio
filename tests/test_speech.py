"""speech.py: the spoken form, text the voice may misread, pauses inside a line, and the balance of the layers."""
import sys
import pathlib

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "skills" / "synergy-studio" / "scripts"))
from speech import normalise, risky, internal_pauses, balance, PAUSE_LIMIT_S  # noqa: E402

SR = 24000


@pytest.mark.parametrize("text, spoken", [
    ("Still house hunting at 2 a.m.?", "Still house hunting at 2 AM?"),
    ("Still house hunting at 2am?", "Still house hunting at 2 AM?"),
    ("Doors open at 10:30 p.m. sharp.", "Doors open at 10:30 PM sharp."),
    ("Fruit, e.g. melon & berries.", "Fruit, for example melon and berries."),
    ("Save 20% vs. last year.", "Save 20 percent versus last year."),
    ("Ask Dr. Lee.", "Ask Doctor Lee."),
    ("Good morning! We open at 7 a.m. and close at 3 p.m.", "Good morning! We open at 7 AM and close at 3 PM."),
    ("Open at 7 a.m. Then coffee.", "Open at 7 AM. Then coffee."),
    ("Open at 7 a.m. and close at 3 p.m.!", "Open at 7 AM and close at 3 PM!"),
    ("Is it 2 a.m.?", "Is it 2 AM?"),
    ("Pastries etc.", "Pastries and so on."),
    ("Meet Dr. Lee at St. Mary Street.", "Meet Doctor Lee at Saint Mary Street."),
    ("Call Mr. Smith. He knows.", "Call Mister Smith. He knows."),
])
def test_normalise_gives_the_spoken_form(text, spoken):
    out, changes = normalise(text)
    assert out == spoken
    assert changes


@pytest.mark.parametrize("text", ["Here I am.", "2 amazing homes.", "Twenty tabs. Blurry photos.", "I am 30 years old."])
def test_normalise_leaves_ordinary_text_alone(text):
    assert normalise(text) == (text, [])


def test_changes_quote_the_whole_number():
    assert normalise("20% off, 100% organic")[1] == ["'20%' -> '20 percent'", "'100%' -> '100 percent'"]
    assert risky("Only $20 today") == ["'$20' is an amount of money: write it out (\"twenty five dollars\")"]


def test_risky_names_what_the_voice_may_misread_and_respects_the_lexicon():
    warnings = risky("Visit allspace.com for $25 #deals")
    assert any("allspace.com" in w for w in warnings)
    assert any("$2" in w for w in warnings)
    assert any("#" in w for w in warnings)
    assert risky("Visit allspace.com", {"allspace.com": "allspace dot com"}) == []
    assert risky("Twenty tabs. Blurry photos.") == []


def _speech(seconds):
    t = np.arange(int(seconds * SR)) / SR
    return (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def test_internal_pauses_finds_a_long_pause_but_not_sentence_breaks():
    gap = lambda s: np.zeros(int(s * SR), np.float32)
    natural = np.concatenate([_speech(0.8), gap(0.5), _speech(0.8), gap(0.3), _speech(0.6)])
    assert internal_pauses(natural, SR) == []
    long = np.concatenate([_speech(0.8), gap(1.2), _speech(0.8)])
    found = internal_pauses(long, SR)
    assert len(found) == 1
    at, length = found[0]
    assert abs(at - 0.8) <= 0.04 and abs(length - 1.2) <= 0.04 and length > PAUSE_LIMIT_S


def test_balance_flags_loud_music_and_an_effect_louder_than_the_voice():
    n = 4 * SR
    vo = np.zeros(n, np.float32); vo[: 3 * SR] = _speech(3)
    quiet_music = 0.2 * vo / 3                        # about 9.5 dB under
    fx = np.zeros(n, np.float32); fx[SR: SR + 2400] = 0.6   # a burst at 1 s, well over the voice
    b = balance(vo, quiet_music, fx, SR, [(1.0, "pop")])
    assert b["music_ok"] and b["music_under_db"] > 6
    assert b["effects"][0]["ok"] is False and b["effects"][0]["over_voice_db"] > 3
    loud = balance(vo, 0.8 * vo, np.zeros(n, np.float32), SR, [])
    assert loud["music_ok"] is False and loud["music_under_db"] < 6


def test_balance_without_a_voice_reports_nothing():
    b = balance(np.zeros(SR, np.float32), np.zeros(SR, np.float32), np.zeros(SR, np.float32), SR, [(0.5, "pop")])
    assert b["voice_db"] is None and b["effects"] == []
