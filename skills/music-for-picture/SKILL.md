---
name: music-for-picture
description: Compose the music and sound for a video, animation, ad, game moment or presentation the way a film composer and sound designer would, with real sampled instruments (General MIDI SoundFont), procedural synth sounds or both. Use whenever a video needs a score, a beat, a jingle, a sound-alike genre (Afrobeats, amapiano, hip-hop, trap, lo-fi, cinematic, corporate, cartoon), action or comedy sound effects (hits, whooshes, slips, bonks, stingers), or when someone says the music sounds cheap, robotic, toy-like, generic or out of sync. Also use to choose between the playful synth score, real instruments and the user's own track.
---

# Music for picture

You are a film composer and a sound designer. The music serves the picture: it sets the mood before anything
happens, lands its hits on the frames that matter, and gets out of the way of the voice. Compose as notes and
patterns (melody, chords, drums, bass) where your music theory is strong, then play them on the right sound.

## 1. Pick the sound engine by mood (decide first, write it in the brief)
| The video feels… | Engine | Why |
|---|---|---|
| cartoon, toy-like, chiptune, retro game, very playful | **synth** (procedural oscillators and noise) | the "toy" sound is the point; cheapest and lightest |
| warm, emotional, premium, corporate, documentary | **instruments** (SoundFont: piano, strings, guitar, choir) | real timbres read as quality |
| a genre: Afrobeats, amapiano, highlife, hip-hop, trap, lo-fi, R&B, house | **instruments** with the genre recipe (references/genres.md) | the groove sells the genre; the right kit and bass matter |
| cinematic, action, trailer, epic | **instruments** for orchestra, plus **synth** for booms, risers and whooshes | layering beats either alone |
| the user gave a track | **their file**; add your timed effects on top | never fight a song with a second score |
Mixing engines is normal. Real drums and bass with a synth riser, or a real orchestra hit with a noise whoosh, is
how professionals layer. Say which engine you chose and why in one line.

## 2. Plan before notes
1. **Mood words → musical choices:** tempo, key (major is bright; minor and modal are serious or mysterious), the
   lead instrument, the drum feel, and the space (dry and close, or a big reverb).
2. **Map the energy to the picture.** Write the energy of each scene (1–5). Music changes on the cuts and story
   turns: add or drop layers there, and leave **silence or a held note just before the biggest hit**.
3. **The cue sheet is the law.** Every hit that the picture shows (a slam, a stamp, a logo landing, a word
   dropping) has a cue time. Put the sound's attack exactly on it. Put musical changes on the nearest bar line to
   a cut, unless a hit needs the exact frame.
4. **Instruments speak at different speeds** (measured): drums, the 808, piano and an orchestra hit start within
   0–4 ms, so use them for hits on a cue. Plucks such as pizzicato take 15–60 ms. Strings take 80–230 ms to reach
   half level, and pads and choir are similar: start them early
   for a swell that peaks on the cue, and never let them carry a hit alone.
5. **Leave room for the voice.** Under narration, use no busy melody between 300 Hz and 3 kHz. Use pads, bass,
   light drums, and duck the music 6–9 dB.

## 2b. Precision: write the music as a score file, lock it to the picture
Code-to-video wins when every sound lands on the exact frame and a rebuild is identical, which generated audio
and AI video models cannot promise. So:
- **Write the music as data** (references/score-format.md): drum grids, notes and chords at musical positions
  (`"bar:beat:sixteenth"`), never seconds typed by hand. `studio_score` validates it and renders it.
- **Anchor bars to cues.** Choose the bar numbers so the drop, chorus or logo moment starts on a downbeat exactly at
  the picture's cue. Give two anchors and let `studio_score` solve the tempo (within 6% of your choice).
- **Hits are cue-locked recipes** (`impact`, `sting`) at named cues, never retyped times.
- **Use names the tool can check:** drum names, General MIDI program numbers, chord symbols and pitch names. Confirm a
  program exists in the installed font before relying on it (`studio_sounds` lists them).
- **Read the render report** (solved tempo, anchor times, hit times, raw peak). Fix problems in the file, never by
  nudging audio.
- **Constant attack offsets are fine:** a kick's sample starts about 2 ms after its note, the same every time.
  Jitter would be a bug.
- **A sketchpad is optional.** Interactive tools that play ABC notation or Strudel patterns in a chat widget (for
  example mcp-music-studio, AGPL-3.0) are handy for trying a groove, but they play live and are not frame-locked.
  Use them to explore, then write the final music as a score file. Never bundle AGPL code into a product.

## 3. Write it like a musician (references/genres.md has ready patterns)
- **Drums first, on a 16-step grid per bar.** Kick, snare or clap, hats or shakers, then percussion. Swing hip-hop
  and lo-fi 55–62% (delay the off-16ths); keep Afrobeats and house straight, with the groove in the percussion.
- **Bass locks to the kick.** Root notes on kick hits, approach notes before chord changes.
- **Chords:** 4-bar loops are fine; voice them close (3–4 notes within an octave), move by small steps.
- **Melody:** short motifs that answer each other (call 2 bars, answer 2 bars). One memorable 3–5-note motif, used
  again at the end, is the "jingle" people remember.
- **Humanise:** velocities vary ±8–15 (deterministic, from a seeded hash, never random), accent the downbeat and the genre's backbeat
  (the snare or clap on 2 and 4 in hip-hop, R&B and house; the half-time 3 in trap), ghost notes at 30–50 velocity.
- **Arrange:** intro (2–4 bars, thinner), main loop, a break or drop before the hero moment, the payoff, an
  ending on the tonic (or a button: one last hit after the final chord).

## 4. Action and comedy sound (references/action-sounds.md)
- Every visible action gets a sound only if it carries meaning: a hit, a reveal, a failure, a joke. Footsteps
  and small moves can stay silent or share one soft texture.
- **Layer three parts** for big moments: a transient (click, snare, rim, orchestra hit), a body (timpani, low tom,
  808 kick, synth sine drop) and a tail (crash, reverb, noise swell).
- **Anticipation is half the hit:** a riser, reverse cymbal or drum roll ending exactly on the cue.
- **Mickey-mousing for comedy:** the music imitates the motion (a xylophone run up the stairs, a trombone
  "wah-wah" bend down on a failure, pizzicato tiptoes, a slide whistle on a jump, a harp glissando for magic).
- **The reaction gets space:** after a gag, hold 0.4–0.8 s of near silence or one sustained note.

## 5. Mix like a finisher
- Headroom: render instruments at −6 to −10 dB synth gain, then normalise; 808 kicks and orchestra hits clip easily.
- Levels (relative): the voice 0 dB, the hits −3 to −6, the drums −8, the bass −10, chords and pads −14 to −18,
  ambience −25.
- One shared reverb for the music (a short room for genres, a large hall for cinematic); keep the kick and bass dry.
- Pan: drums and bass in the centre; keys, guitars and percussion 20–40% left or right; effects follow the action.
- Master: a gentle bus compressor, then loudness to the platform's target (−14 LUFS for social), true peak ≤ −1 dBTP.

## 6. Check before you deliver
- Every sync cue's hit starts within a frame and a half of the picture (`studio_check` measures each cue marked `"sync": true`).
- Name the genre or mood in one sentence; if the rhythm or the instruments don't say it, revise the recipe.
- No two neighbouring scenes have the same energy unless that's on purpose.
- Licences: General MIDI SoundFonts like MuseScore General and FluidR3 (MIT) and GeneralUser GS (free, commercial
  use allowed) are safe for client work. Never use a model or sample pack marked non-commercial for a client.

## References
- `references/genres.md`: tempo, kit, 16-step drum grids, bass and chord habits for 13 styles (each with its `music.style` key).
- `references/action-sounds.md`: recipes for hits, whooshes, slips, bonks, magic, tech, failure and success.
- `references/score-format.md`: the score file (positions, anchors, grids, notes, chords, hits, the report), verified with a prototype.
- `references/gm-map.md`: General MIDI programs (0-based) and drum note numbers, with the kits that exist.
