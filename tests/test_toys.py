"""toys.py in the score file: toy instruments, the toy kit and cartoon hits land on their times, render the same bytes,
need no SoundFont, mix with real instruments, and unknown names are refused with the list. Thresholds as for the
instrument engine (L12 plan): never early, within 5 ms for a hit; the moment of a whoosh or riser on its time."""
import pathlib
import sys

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "skills" / "synergy-studio" / "scripts"))
import toys  # noqa: E402
from score_file import ScoreError, compile_score  # noqa: E402
from instruments import SR, render  # noqa: E402

TIMING = {"T": {"s1": {"start": 0, "vo": 0, "vo_end": 8, "end": 8}}, "EV": {"s1": {"fall": 3.0}}, "CUE": {"jump": 5.0}}


def alone(sound, at=2.0, reverb="none"):
    return render(compile_score({"tempo": {"bpm": 120}, "reverb": reverb, "hits": [{"at": at, "sound": sound}]}, TIMING), None, at + 3.0)


@pytest.mark.parametrize("sound", [s for s, (_, where) in toys.HITS.items() if where == "start"])
def test_a_toy_hit_starts_on_its_time_never_early_within_5_ms(sound):
    x = alone(sound)
    first = int(np.flatnonzero(np.abs(x).max(axis=1) > 10 ** (-60 / 20))[0])
    print(f"{sound}: {((first - 2 * SR) / SR * 1000):+.2f} ms")
    assert 2 * SR <= first <= 2 * SR + 0.005 * SR


def moment_error(sound, at, start):
    """How far the sound's own moment (its middle, or its end for a riser) is from `at`, when it begins at `start`."""
    where = toys.HITS[sound][1]
    moment = start + (toys.HIT_LENGTH[sound] / 2 if where == "middle" else toys.HIT_LENGTH[sound])
    return abs(moment - at)


@pytest.mark.parametrize("sound", ["whoosh", "shimmer", "riser"])
def test_a_whoosh_is_centred_and_a_riser_ends_on_its_time(sound):
    x = alone(sound).mean(axis=1)
    last = np.flatnonzero(np.abs(x) > 1e-4)[-1] / SR
    begin = np.flatnonzero(np.abs(x) > 1e-4)[0] / SR
    print(f"{sound}: heard from {begin:.3f} to {last:.3f} s (moment at 2.000)")
    assert moment_error(sound, 2.0, toys.hit_start(sound, 2.0)) < 1e-9
    if sound == "riser":
        assert abs(last - 2.0) < 0.01                                # ends on the cue (dry render)
    else:
        assert abs((begin + last) / 2 - 2.0) < 0.02                  # centred on the cue (a swell peaks in its middle)
    # falsifier: placed like a transient (start on the cue), the moment misses by the sound's length or half of it
    assert moment_error(sound, 2.0, 2.0) > 0.25


def test_the_toy_kit_has_no_jitter():
    s = {"tempo": {"bpm": 104}, "reverb": "none", "tracks": {"d": {"kit": "toy", "humanize": 0, "grids": [{"bars": "2", "kick": "xxxxxxxxxxxxxxxx"}]}}}
    lone = {"tempo": {"bpm": 104}, "reverb": "none", "tracks": {"d": {"kit": "toy", "humanize": 0, "grids": [{"bars": "2", "kick": "x..............."}]}}}
    x = render(compile_score(s, TIMING), None, 6.0).mean(axis=1)
    tmpl = render(compile_score(lone, TIMING), None, 6.0).mean(axis=1)
    spb = 60 / 104
    t0 = round(4 * spb * SR)
    tmpl = tmpl[t0: t0 + SR // 100]
    offs = []
    for k in range(16):
        s0 = round((4 + k / 4) * spb * SR)
        score = [np.dot(x[s0 + lag: s0 + lag + len(tmpl)], tmpl) for lag in range(-300, 301)]
        offs.append(int(np.argmax(score)) - 300)
    print("toy kick offsets:", offs)
    assert (max(offs) - min(offs)) / SR * 1000 <= 0.1                  # the plan's threshold; each kick's tail overlaps the next match


CARTOON = {"tempo": {"bpm": 120}, "seed": 2, "tracks": {
    "drums": {"kit": "toy", "grids": [{"bars": "1-4", "kick": "x.......x.......", "snare": "....x.......x...", "chh": "x.x.x.x.x.x.x.x."}]},
    "tiptoe": {"synth": "pizz", "notes": [["1:1", "C5", "1/8"], ["1:2", "E5", "1/8"], ["1:3", "G5", "1/8"]]},
    "tune": {"synth": "musicbox", "chords": [["2:1", "C", "1/1"]], "rhythm": "x...x...x...x..."}},
    "hits": [{"at": "s1.fall", "sound": "bonk"}, {"at": "cue:jump", "sound": "slide_up"}, {"at": 6.5, "sound": "whoosh"}]}


def test_a_cartoon_score_needs_no_font_renders_the_same_bytes_and_follows_its_seed():
    c = compile_score(CARTOON, TIMING)
    assert not c["notes"] and len(c["toys"]) > 50
    a, b = render(c, None, 8.0), render(c, None, 8.0)
    other = render(compile_score({**CARTOON, "seed": 3}, TIMING), None, 8.0)
    assert np.array_equal(a, b) and not np.array_equal(a, other)


def test_toy_and_real_instruments_mix_in_one_score_with_levels_for_each():
    import os
    from instruments import find_font
    home = pathlib.Path(os.environ.get("SYNERGY_STUDIO_HOME") or pathlib.Path.home() / "Library" / "Application Support" / "SynergyStudioLite")
    mixed = {**CARTOON, "tracks": {**CARTOON["tracks"], "tuba": {"program": 58, "notes": [["1:1", "C2", "1/4"], ["2:1", "G1", "1/4"]]}}}
    levels = {}
    render(compile_score(mixed, TIMING), find_font(os.environ.get("SYNERGY_STUDIO_SOUNDFONTS") or home / "soundfonts")[1], 8.0, levels=levels)
    print(levels)
    assert set(levels) == {"drums", "tiptoe", "tune", "tuba", "hits"}
    assert max(levels.values()) - min(levels.values()) < 20             # nothing buried, nothing towering


@pytest.mark.parametrize("track, words", [
    ({"synth": "kazoo", "notes": [["1:1", "C4", "1/4"]]}, 'unknown synth "kazoo" (toy instruments: pizz'),
    ({"kit": "toy", "grids": [{"bars": "1", "cowbell": "x..............."}]}, 'the toy kit has no "cowbell"'),
    ({"synth": "pizz", "program": 4, "notes": [["1:1", "C4", "1/4"]]}, 'unknown field "program"'),
])
def test_unknown_toy_names_are_refused_with_the_list(track, words):
    with pytest.raises(ScoreError) as e:
        compile_score({"tempo": {"bpm": 120}, "tracks": {"t": track}}, TIMING)
    assert words in str(e.value)


def test_an_unknown_hit_lists_real_and_toy_sounds():
    with pytest.raises(ScoreError) as e:
        compile_score({"tempo": {"bpm": 120}, "hits": [{"at": 1, "sound": "kaboom"}]}, TIMING)
    assert "real instruments: impact, sting, roll; toy: boing, bonk" in str(e.value)


def test_a_riser_that_would_start_before_the_video_is_refused():
    with pytest.raises(ScoreError) as e:
        compile_score({"tempo": {"bpm": 120}, "hits": [{"at": 0.5, "sound": "riser"}]}, TIMING)
    assert "move a hit or roll later" in str(e.value)
