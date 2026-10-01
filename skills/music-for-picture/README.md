---
title: Music for picture
kind: skill
status: active
created: 2026-10-01
updated: 2026-10-01
tags: [skill, music, score, sound-design, soundfont, general-midi, afrobeats, hip-hop, cinematic, video]
summary: A composer and sound-designer skill that tells Claude when to use synth sounds, real SoundFont instruments or the user's track, and how to write genre grooves, scores and action or comedy sounds that land on the picture.
---

# Music for picture

## What it is
The owner wanted Claude to be creative with the new real-instrument engine (SoundFont) planned for Synergy
Studio, and to know when to use it instead of the playful synth sound. The skill is engine-agnostic: it works with
any renderer that plays General MIDI notes (tinysoundfont, FluidSynth) plus procedural sounds. It covers:
- choosing the engine by mood;
- planning music against the picture and the cue sheet;
- writing grooves like a musician;
- action and comedy sound layering;
- mixing and checks.

Existing public skills compose MIDI and render it through a SoundFont, for example
[sirruf/music-gen-skill](https://github.com/sirruf/music-gen-skill) and
[tubone24/midi-agent-skill](https://github.com/tubone24/midi-agent-skill). None of them is about scoring to
picture, so this one was written new (their code was not read or used).

## How to use or rebuild it
- Copy the folder into `~/.claude/skills/` (Claude Code), or into the skills folder of a plugin for Claude Desktop.
  It fires on requests for a score, a beat, a genre sound, action or comedy sounds, or "the music sounds cheap".
- **Verified on 2026-10-01:**
  - every program number and drum kit in `references/gm-map.md` against MuseScore General Lite and FluidR3_GM, with tinysoundfont 0.3.7;
  - Afrobeats, boom-bap and cinematic test renders built from these recipes (the timing and level results are in `code/synergy-studio/LITE.md` §10).

## Files
- `SKILL.md`: the engine choice, planning, writing, action sound, mix and checks.
- `references/genres.md`: 13 styles (each with a `music.style` key) with tempo, kit, 16-step drum grids and harmony habits, plus a mood-to-progression table.
- `references/action-sounds.md`: 18 recipes for hits, whooshes, slips, failure, success, tech and ambience.
- `references/score-format.md`: the precise score file format, verified with a prototype renderer (tempo solved to land bar 9 exactly on a cue; 60 kicks with zero jitter; byte-identical renders; bad files refused).
- `references/gm-map.md`: General MIDI programs (0-based), drum notes and the kits present.

## Open items
- Listen-tests of each genre recipe by the owner; adjust the grids to taste.
- When Synergy Studio's instrument engine is built, link its helper API from SKILL.md §1.
