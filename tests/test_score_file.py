"""score_file.py: the score file is checked, its tempo solved from anchors and compiled to note events (no audio here).
Thresholds were fixed in BUILD_LOG.md (L12 plan) before the first run."""
import sys
import pathlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "skills" / "synergy-studio" / "scripts"))
from score_file import (ScoreError, compile_score, pitch_number, chord_notes, position_beats, duration_beats,  # noqa: E402
                        swung, time_names, DRUMS)

SR = 48000
TIMING = {"T": {"s1": {"start": 0, "vo": 0, "vo_end": 10, "end": 10}, "s2": {"start": 10, "vo": 10.6, "vo_end": 18, "end": 20}},
          "EV": {"s2": {"drop": 1.4}}, "CUE": {"drop": 19.0, "slam": 12.25}}


ONE_NOTE = {"p": {"program": 0, "notes": [["9:1", "C4", "1/4"]]}}


def score(**over):
    base = {"tempo": {"bpm": 104}, "tracks": ONE_NOTE, "hits": []}
    return {**base, **over}


def problems(s, timing=TIMING):
    with pytest.raises(ScoreError) as e:
        compile_score(s, timing)
    return e.value.problems


# ---------------------------------------------------------------- test 2: anchors
def test_two_anchors_solve_the_tempo_and_land_bar_9_on_its_cue():
    c = compile_score(score(anchors=[{"bar": 1, "at": 0.5}, {"bar": 9, "at": "cue:drop"}]), TIMING)
    assert abs(c["bpm_solved"] - 103.78) <= 0.01
    bar9 = c["anchors"][1]["bar_s"]
    assert abs(bar9 - 19.0) * SR <= 1
    assert c["bar1_s"] == 0.5


def test_a_note_on_the_anchored_bar_starts_on_the_cue():
    s = score(anchors=[{"bar": 1, "at": 0.5}, {"bar": 9, "at": "cue:drop"}],
              tracks={"d": {"kit": "standard", "humanize": 0, "grids": [{"bars": "9", "kick": "x..............."}]}})
    (t, ch, key, vel, length, dry, gain, group), = compile_score(s, TIMING)["notes"]
    assert abs(t - 19.0) * SR <= 1 and key == 36 and dry


def test_anchors_needing_a_50_percent_stretch_are_refused_with_the_tempo_they_need():   # falsifier of test 2
    at = 0.5 + 32 * 60 / (104 * 1.5)                         # bar 9 where 156 BPM would put it
    msg = "\n".join(problems(score(anchors=[{"bar": 1, "at": 0.5}, {"bar": 9, "at": at}])))
    assert "156.00 BPM" in msg and "+50.0%" in msg and "max_stretch" in msg


def test_one_anchor_places_bar_1_at_the_given_tempo():
    c = compile_score(score(anchors=[{"bar": 3, "at": 10.0}]), TIMING)
    assert abs(c["bpm_solved"] - 104) < 1e-9 and abs(c["bar1_s"] - (10.0 - 8 * 60 / 104)) < 1e-9


def test_scene_events_and_scene_edges_are_names_for_times():
    names = time_names(TIMING)
    assert names["s2.drop"] == 12.0                        # counted from the scene's narration start (10.6 + 1.4)
    assert names["s2.start"] == 10 and names["s2.end"] == 20 and names["cue:slam"] == 12.25


# ---------------------------------------------------------------- test 4: validation (each refused with the fix)
def test_an_unknown_drum_is_refused_with_the_list():
    msg = "\n".join(problems(score(tracks={"d": {"kit": "standard", "grids": [{"bars": "1", "kik": "x..............."}]}})))
    assert 'unknown drum "kik"' in msg and "kick" in msg and "shaker" in msg


def test_a_grid_that_is_not_16_steps_is_refused():
    msg = "\n".join(problems(score(tracks={"d": {"kit": "standard", "grids": [{"bars": "1", "kick": "x.....x.x......"}]}})))
    assert "exactly 16 steps" in msg and "has 15 steps" in msg


def test_an_unknown_chord_is_refused_with_the_qualities():
    msg = "\n".join(problems(score(tracks={"k": {"program": 4, "chords": [["1:1", "Am13", "1/1"]]}})))
    assert 'unknown chord "Am13"' in msg and "'maj7'" in msg and "Am9" in msg


def test_an_unknown_anchor_name_is_refused_with_the_names_that_exist():
    msg = "\n".join(problems(score(anchors=[{"bar": 1, "at": "cue:dorp"}])))
    assert '"cue:dorp" is not a time' in msg and "cue:drop" in msg and "s2.drop" in msg


def test_an_unknown_hit_name_and_sound_are_refused():
    msg = "\n".join(problems(score(hits=[{"at": "s9.boom", "sound": "impact"}, {"at": "cue:slam", "sound": "kaboom"}])))
    assert '"s9.boom" is not a time' in msg and 'unknown sound "kaboom"' in msg and "impact, sting, roll" in msg


def test_every_problem_is_listed_at_once_and_unknown_fields_are_named():
    ps = problems(score(tempo={"bpm": 104, "swing": 0.9}, colour="red",
                        tracks={"d": {"kit": "disco"}, "k": {"program": 200}}))
    text = "\n".join(ps)
    assert len(ps) >= 4 and '"swing" must be a number from 0.5 to 0.75' in text and 'unknown field "colour"' in text
    assert 'unknown kit "disco"' in text and '"program" must be a General MIDI program' in text


def test_notes_before_the_video_starts_are_refused():
    s = score(anchors=[{"bar": 2, "at": 0.5}], tracks={"d": {"kit": "standard", "grids": [{"bars": "1", "kick": "x..............."}]}})
    assert any("start before 0 s" in p for p in problems(s))


def test_a_bend_wider_than_its_range_is_refused():
    s = score(tracks={"f": {"program": 73, "bend_range": 2, "notes": [["1:1", "C5", "1/2"]], "bends": [["1:1", -12, "1/2"]]}})
    assert any('needs "bend_range" of at least 12' in p for p in problems(s))


# ---------------------------------------------------------------- the readers
@pytest.mark.parametrize("name, number", [("C4", 60), ("A1", 33), ("Bb3", 58), ("C#4", 61), ("A0", 21), ("G9", 127)])
def test_pitch_names(name, number):
    assert pitch_number(name) == number


@pytest.mark.parametrize("bad", ["H2", "C", "Cb#4", "60", "C10"])
def test_bad_pitch_names(bad):
    assert pitch_number(bad) is None


def test_chords_positions_and_durations():
    assert chord_notes("Am9", 4) == [69, 72, 76, 79, 83] and chord_notes("G", 3) == [55, 59, 62]
    assert position_beats("9:2:3", 4) == 8 * 4 + 1 + 0.5 and position_beats("1", 4) == 0 and position_beats("1:5", 4) is None
    assert duration_beats("1/8") == 0.5 and duration_beats("3b") == 3 and duration_beats("1/1") == 4 and duration_beats("1/5") is None


def test_swing_delays_only_the_off_sixteenths():
    assert swung(1.0, 0.6) == 1.0 and swung(1.5, 0.6) == 1.5
    assert abs(swung(1.25, 0.6) - 1.30) < 1e-9 and abs(swung(1.75, 0.6) - 1.80) < 1e-9


def test_humanising_is_the_same_every_time_and_follows_the_seed():
    s = score(tracks={"d": {"kit": "standard", "grids": [{"bars": "1-4", "chh": "xxxxxxxxxxxxxxxx"}]}})
    a, b = compile_score(s, TIMING)["notes"], compile_score(s, TIMING)["notes"]
    c = compile_score({**s, "seed": 2}, TIMING)["notes"]
    assert a == b and [n[3] for n in a] != [n[3] for n in c]
    assert [n[0] for n in a] == [n[0] for n in c]           # the seed moves velocities, never times
    vels = [n[3] for n in a]
    assert min(vels) >= 92 and max(vels) <= 108 and len(set(vels)) > 5


def test_a_hit_lands_on_its_name_with_layers_that_speak_fast():
    c = compile_score(score(tracks={}, hits=[{"at": "cue:slam", "sound": "impact"}]), TIMING)
    assert c["hits"] == [{"sound": "impact", "at": "cue:slam", "t": 12.25}]
    assert {n[0] for n in c["notes"]} == {12.25}
    progs = {(bank, preset) for _, bank, preset, _, _ in c["programs"]}
    assert (0, 55) in progs and (0, 47) in progs and (128, 0) in progs


def test_drum_names_are_general_midi_notes():
    assert DRUMS["kick"] == 36 and DRUMS["snare"] == 38 and DRUMS["shaker"] == 70 and DRUMS["crash"] == 49


# ---------------------------------------------------------------- refused cleanly, never a traceback (code review, L12)
@pytest.mark.parametrize("over, words", [
    ({"anchors": [{"bar": 1, "at": 0}, {"bar": 5, "at": 9}, {"bar": 9, "at": 18}]}, "give one or two anchors"),
    ({"tempo": {"bpm": 104, "swing": "x"}}, '"swing" must be a number'),
    ({"tempo": {"bpm": 104, "max_stretch": None}}, '"max_stretch" must be a number'),
    ({"seed": -3}, '"seed" must be a whole number from 0'),
    ({"tracks": {}}, "the score has no notes"),
    ({"tracks": {}, "hits": [{"at": 1.0, "sound": "impact", "pitch": "B0"}]}, '"pitch" must be a pitch name from C1 to G7'),
])
def test_bad_values_are_problems_with_the_fix_not_crashes(over, words):
    assert any(words in p for p in problems(score(**over)))


def test_a_roll_past_the_channel_limit_reports_once():
    tracks = {f"t{i}": {"program": i, "notes": [["1:1", "C4", "1/4"]]} for i in range(15)}   # the hits' kit fits, the timpani does not
    ps = problems(score(tracks=tracks, hits=[{"at": 5.0, "sound": "roll"}]))
    assert 1 <= sum("more than 16 instruments" in p for p in ps) <= 2    # once for the roll, once for its final stroke; never 24 times


# ---------------------------------------------------------------- found by the verifier (L12): messages that say the real fix
def test_messages_name_the_real_problem():
    ps = "\n".join(problems(score(tracks={"d": {"kit": "disco", "grids": [{"bars": "1", "kik": "x...", "kick": "x...z..........."}]},
                                          "k": {"program": 4, "bank": 200, "notes": [["1:1", "C4", "1/4"]]}},
                                  anchors=[{"bar": 3, "at": 1.0}, {"bar": 3, "at": 2.0}])))
    assert 'unknown kit "disco"' in ps and 'unknown drum "kik"' in ps          # the kit no longer hides the grid's problems
    assert "has 'z'; a step is x (hit)" in ps                                  # the bad character is named
    assert '"bank" must be a whole number from 0 to 127' in ps
    assert "two anchors name bar 3" in ps
