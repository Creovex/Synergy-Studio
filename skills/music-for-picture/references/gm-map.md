# General MIDI map (0-based program numbers, drum notes)

Pitch bend: the default range is ±2 semitones. For slides, set the track's range to 12–24 semitones first
(`"bend_range"` in the score file).

Names differ slightly between SoundFonts. Check a preset before using it (`studio_sounds` lists the installed font's
programs and kits); `studio_score` refuses a preset the font does not have.

## Programs (bank 0)
| # | Instrument | # | Instrument | # | Instrument |
|---|---|---|---|---|---|
| 0 | Grand Piano | 33 | Fingered Bass | 61 | Brass Section |
| 4 | Electric Piano (Rhodes/tine) | 34 | Picked Bass | 65 | Alto Sax |
| 5 | Electric Piano 2 (FM) | 35 | Fretless Bass | 66 | Tenor Sax |
| 8 | Celesta | 36 | Slap Bass | 68 | Oboe |
| 9 | Glockenspiel | 38 | Synth Bass 1 | 70 | Bassoon |
| 10 | Music Box | 39 | Synth Bass 2 | 71 | Clarinet |
| 11 | Vibraphone | 40 | Violin | 73 | Flute |
| 12 | Marimba | 42 | Cello | 75 | Pan Flute |
| 13 | Xylophone | 45 | Pizzicato Strings | 79 | Ocarina |
| 19 | Church Organ | 46 | Harp | 80 | Square Lead |
| 24 | Nylon Guitar | 47 | Timpani | 81 | Saw Lead |
| 25 | Steel Guitar | 48 | String Ensemble 1 | 88 | New Age Pad |
| 26 | Jazz Guitar | 49 | String Ensemble 2 (slow) | 89 | Warm Pad |
| 27 | Clean Electric Guitar | 50 | Synth Strings | 95 | Sweep Pad |
| 29 | Overdriven Guitar | 52 | Choir Aahs | 108 | Kalimba |
| 30 | Distortion Guitar | 55 | Orchestra Hit | 114 | Steel Drums |
| 32 | Acoustic Bass | 56 | Trumpet | 116 | Taiko Drum |
| | | 57 | Trombone | 119 | Reverse Cymbal |
| | | 58 | Tuba | 123 | Bird Tweet |
| | | 59 | Muted Trumpet | | |
| | | 60 | French Horn | 124 | Telephone Ring |
Also: 120 guitar fret noise, 121 breath noise, 122 seashore, 125 helicopter, 126 applause, 127 gunshot.

## Drum kits (bank 128, channel 10, the 0-based channel 9)
Present in MuseScore General Lite and FluidR3 (checked 2026-10-01):
- 0 Standard
- 8 Room
- 16 Power
- 24 Electronic
- 25 TR-808
- 32 Jazz
- 40 Brush
- 48 Orchestra

## Drum notes
| Note | Sound | Note | Sound | Note | Sound |
|---|---|---|---|---|---|
| 35 | Acoustic Bass Drum | 46 | Open Hi-hat | 60 | Hi Bongo |
| 36 | Bass Drum (kick) | 47 | Low-Mid Tom | 61 | Low Bongo |
| 37 | Side Stick (rim) | 48 | Hi-Mid Tom | 62 | Mute Hi Conga |
| 38 | Acoustic Snare | 49 | Crash 1 | 63 | Open Hi Conga |
| 39 | Hand Clap | 50 | High Tom | 64 | Low Conga |
| 40 | Electric Snare | 51 | Ride | 67 | High Agogo |
| 41 | Low Floor Tom | 52 | Chinese Cymbal | 69 | Cabasa |
| 42 | Closed Hi-hat | 53 | Ride Bell | 70 | Maracas (shaker) |
| 43 | High Floor Tom | 54 | Tambourine | 71/72 | Short / Long Whistle |
| 44 | Pedal Hi-hat | 55 | Splash | 75 | Claves |
| 45 | Low Tom | 56 | Cowbell | 76/77 | Hi / Low Wood Block |
| | | 57 | Crash 2 | 80/81 | Mute / Open Triangle |
