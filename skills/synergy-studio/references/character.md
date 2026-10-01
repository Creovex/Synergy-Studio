# Character animation: make them feel alive

A mascot that only slides across the screen is a sticker. Give it acting.

## Principles (the ones that matter most in code)
- **Anticipation**: a small move the opposite way before the action. Squash down before a jump; lean back
  before a push (0.1–0.2 s).
- **Squash and stretch**: squash on landing, stretch on take-off (`scale(1 + s·0.14, 1 − s·0.14)` from the
  feet). Keep the volume.
- **Overshoot and settle**: pops end past the target and settle back (`eBack`, `back.out`).
- **Holds**: after a big action, hold still 0.3–0.6 s so the audience reads it; add a blink to keep it alive.
- **Secondary motion**: arms lag the body, ears or antennae wobble, and the shadow squashes with the jump.
- **Walk cycle**: legs swing in opposite pairs, `sin(phase + π)`. The body bobs twice per cycle
  (`|sin(phase)|`). Faster phase means running; add a forward tilt of 0.1–0.2 rad.
- **Eyes lead**: the eyes look at something about 0.2 s before the body turns to it. Eye direction is the
  cheapest acting there is.
- **Blinks**: every 2.5–4 s, 0.1 s long, and never on two characters at the same time.

## Mood → pose (combine with shot size, cinema.md §2)
| Mood | Eyes | Body | Motion | Frame |
|---|---|---|---|---|
| Curious | normal, looking at the thing, slightly up | leaning toward it | small hops, head tilts | medium |
| Determined | narrowed | leaning forward | slow push, strain shake | wide |
| Scared | wide, small pupils, highlights up | squashed down | trembling (5 px at 60–70 Hz), then running away | close-up |
| Lonely | small, brows sad (inner ends up) | sitting, low | slow breathing, long holds, slow blinks | extreme wide, or a slow pull-back |
| Wonder | wide, reflecting the light source's colour | upright, still | a held breath, then a small hop | close-up |
| Happy | `^ ^` arcs | stretched up | bouncing on the beat, waving | any |
| Proud / warm | `^ ^`, soft | side by side with a friend | slow sway | wide, two-shot |

## Comedy (setups, threes, timing)
- **Setup and payoff.** List each setup in shots.md with the shot that pays it off. No setup without a payoff.
- **Rule of three.** Two tries set a pattern; the third breaks it (the rock, the tree, then the door).
- **Escalate.** Each try costs more than the last ("nope", then "nope" and a leaf in the face).
- **Timing.** Anticipation 0.2–0.4 s, action 0.1–0.2 s, reaction hold 0.4–0.8 s. The laugh is in the reaction.
- **One gag at a time.** Clear the frame before a gag lands; nothing else moves at the moment of impact.
- **Button.** After the payoff, end on one small beat: the villain's last try, a wink at the camera.

## Two characters together
- Put them close; overlap them a little in depth; make them bounce slightly out of phase (half a beat) so they read as two individuals.
- Give them moments where they look at each other.
- Contrast the silhouettes (square and warm next to round and cool). Each should read in a black-filled shape.

## Drawing the user's mascot
Use the user's own art when they give it. When you draw it in code, match the reference exactly:
- proportions (body width : height, leg count and spacing);
- eye shape and highlight;
- outline weight and colours.
Build a turnaround still (front, side, happy, scared) and compare it with the reference before animating.
