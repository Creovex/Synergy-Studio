# Storytelling: make it make sense

## The one-sentence test
Before any scene, write the message in one sentence ("One scan keeps every package safe"). If a scene
doesn't serve that sentence, cut it.

## Structures (pick one; the first five are for ads and explainers)
| Structure | Order | Good for |
|---|---|---|
| Problem → solution | hook, problem, reveal (the product), proof, benefit, CTA | ads, product explainers (LSPedia OneScan) |
| Tips / list | hook, tip 1, tip 2, tip 3, CTA ("save this") | social value posts (hydration tips, AllSpace Listing Translator) |
| How it works | hook, step 1…n, result, CTA | tools, services (the Synergy Studio explainer) |
| Story | hook, before, turning point, after, CTA | brands, founders (Haura intro reel) |
| Sale / offer | hook (product), desire (products), offer, how to buy | promotions (Haura 5% sale ad) |
| Wordless short | setup, try and fail, low point, turn, flourish, echo of the opening | stories, mascots, films (Claude × Syn) |
| Mascot chase | calm, threat arrives, chase, three tries, the brand is the escape, relief, gag payoff, button | mascots, brand shorts (AllSpace "The Chase") |
| Visual journey | a chain of images linked by match cuts or zooms through objects | music pieces, "the world inside" ideas |
| Mood piece | one feeling built and released with music, no plot | art, brand films, loops |
Stories and films don't need a hook line, a CTA or narration: see cinema.md §6 and character.md.

**The hero wants something, and something blocks it.** A mascot story with no want and no threat becomes a
montage (an early AllSpace cut was a rush of doors, and the brand owner asked for "a story"). Make the audience's
pain a physical villain (an agent's chaos became a paperwork tornado). The brand is how the hero wins: put it
inside the story as the payoff (the door with the logo, the words falling on its head), never only on an end card.

## Hooks (first 2 seconds, on screen AND spoken)
A question the viewer feels ("Tired by 3 p.m.?"), a surprising fact with a source, a bold promise
("Meet the face behind HAURA SCENT"), or a "secret language" reveal ("Listings speak their own secret language").

## Script rules
- Short spoken sentences (under 15 words). Numbers written as they are said: "ninety percent".
- About 2.5–3.3 words per second with Kokoro at speed 0.95–1.05; `studio_voice` prints it per line.
  Over 3.5 feels rushed: cut words rather than raising speed; for a premium feel lower the speed (0.85–0.9) and
  write fewer words. `studio_budget` gives the word count per scene for the target length.
- Budget (narration only; pauses between scenes take the rest, see SKILL.md step 3): 9:16 social with the
  default pauses: 15 s ≈ 30 words · 30 s ≈ 65 · 60 s ≈ 140. 16:9 explainers (slower pauses): 60 s ≈ 120 · 90 s ≈ 190.
- One idea per scene. Scene length 3–8 s; social videos change something on screen every 1–2 s.
- Ads and explainers end with one clear action (follow, shop, DM, save, visit) shown as a button or handle.
  A story ends on an image: an echo of the opening, changed.

## Show what you say
Each noun or claim in the narration appears on screen within about a third of a second of being said:
use `events` in project.json at the word's offset (estimate: character position ÷ total characters ×
line duration, or `studio_words` then read `transcript.json` with `studio_file_read`). Numbers count up; lists stagger in;
comparisons split the screen.

## Truth
Only facts the user gave you or that you checked (keep the source). No invented rankings, statistics
or testimonials. If unsure, say less.
