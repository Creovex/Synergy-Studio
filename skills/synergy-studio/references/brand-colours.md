# Brand colour roles

Turn a brand colour into a full, good-looking palette instead of painting everything in it. Read this whenever the
user gives brand colours, a hex code, a colour sheet, a logo or mascot colour, or says "use our colours", "match our
brand", "make it blue like our logo"; for any visual work (video, animation, illustration, poster, social graphic). Read it
too when a draft looks monotone or "all one colour", or the user says the colour is ruining the design. The brand
colour is an accent with a job, not a paint bucket.

## The mistake this prevents
The brand owner gave the AllSpace colours (blue `#2A67B7`, soft blue `#E8EFF8`, cream `#FDFAF4`, espresso `#271D15`)
and a blue mascot. The first video painted the sky, walls, ground and props in blues. The mascot vanished into
its own background, the scene looked flat and cold, and the owner said: "don't only use blue, just the mascot has
to be blue, making it all blue ruins the colour." The fixed version kept blue for the mascot and the logo
only and built a warm world around them (terracotta, mustard, sage, coral, peach, lilac on cream). The owner
liked that direction.

**Rule of thumb:** a brand colour is a signature, not a wallpaper. The less of it there is, the more it means.

## Steps (do these before choosing any other colour)
1. **List what the user gave** and sort each colour into a role:
   - **Signature:** the saturated brand hue (the logo blue). It marks the brand: the logo, the mascot or hero, the one
     call-to-action.
   - **Neutrals:** light and dark background and text colours from the sheet (cream, espresso). These can be large.
   - **Tints:** very light versions of the signature (soft blue). Use them for small panels and highlights, never as the
     world's main colour.
   If the user says which things must carry the brand colour ("only the mascot and the logo"), that list is law.
2. **Reserve the signature hue.** Write down the 1–3 things that may use it, and nothing else may use that hue
   (±20° on the colour wheel). A blue sky next to a blue mascot is a clash, not a match.
3. **Build the world palette from the brand, not from the signature hue.** Pick 4–6 supporting colours that
   make the signature pop:
   - Lean **warm** against a cool signature (blue → terracotta, mustard, peach, coral, sage), and cool or neutral
     against a warm one (orange → teal, slate, sand, olive).
   - Keep them **softer** (lower saturation) than the signature, so the signature stays the loudest colour.
   - Give real things their real colours: grass green, wood brown, skin tones, sky cream or peach, not brand-tinted.
   - Pull the mood from the brand's personality (friendly → warm and sunny; premium → deep and muted; techy → cool
     neutrals with one electric accent).
4. **Split the frame roughly 60 / 30 / 10:** 60% neutrals and background, 30% supporting colours, and at most
   about 10% signature (up to 25% on an end card or logo moment). `studio_brand_check` measures it.
5. **Check contrast of the hero.** The brand-coloured hero or logo must stand out from what is behind it: a
   different hue and a clearly lighter or darker value. If the hero and its background would look the same in
   greyscale, change the background, never the brand colour.
6. **Write the palette down** in `brief.md` with each colour's role ("terracotta: doors and roofs"), so every later
   scene follows it (`studio_file_write`, after reading the file).

## Rules
- Never recolour the logo or the mascot to match a scene; change the scene.
- Never tint the whole frame with the brand colour (overlays, gradients, colour grading) unless the user asks.
- Brand text colours (like espresso) are for text and outlines; keep body text on the neutral background.
- When the sheet has only one colour, still build the neutrals and supporting colours yourself and say so.
- Ask one question only when it changes everything: "Should the brand colour be the accent (recommended) or the
  whole look?" Otherwise take the accent route and say that you did.
- A deliberate monochrome look is allowed when the user asks for it or the idea needs it; say why in one sentence.

## Check before showing anything
Call `studio_stills` (add `times` for 3 to 5 key frames), then `studio_brand_check` with `name` and `brand`, the
hex codes of the signature colours, for example `["#2A67B7"]`. Without `files` it measures every
`stills/frame-*.png`; `files` names other pictures inside the project. It prints, for each picture, the share of the
image in each brand hue (within 20° of the hue), the share of near neutral pixels, the main hues, and a verdict:
- **ACCENT:** at most 15%.
- **HEAVY:** 15–35%. Fine for an end card or a logo moment, too much for a scene.
- **FLOODED:** over 35%.

FLOODED on anything but an end card means redo the palette. Very pale tints (like `#E8EFF8`) have too little
colour to count as a hue, so give the tool the saturated signature. Fully transparent pixels count for nothing (the
result says how much of the picture is transparent). Then look at the frames yourself:
- the signature appears only on its reserved things;
- the hero reads in greyscale;
- the frame has at least three distinct hues (the tool prints how many hues pass 3% of the image).

## Examples

### AllSpace (the case behind this page)
**Given** (the owner's sheet "Our signature colours"):
- cream `#FDFAF4`;
- espresso `#271D15`;
- AllSpace blue `#2A67B7`;
- soft blue `#E8EFF8`;
- Orbit, the pale-blue mascot.

**Before (rejected):** blue sky, blue-tinted walls and ground, blue props, and soft-blue panels everywhere.
- The mascot sat on a blue background and lost its outline.
- The scene felt cold and flat, like a single colour pushed through a filter.
- The owner: "don't only use blue, just the mascot has to be blue".

**After (liked):**
| Role | Colours | Used for |
|---|---|---|
| Signature (reserved) | Orbit `#B9D1E6`, logo blue `#2A67B7` | the mascot and the logo, nothing else |
| Neutrals (60%) | cream `#FDFAF4`, sand `#F3E6D0`, espresso `#271D15` | walls, sky, paper, text and outlines |
| Supporting (30%) | terracotta `#E07A5F`, mustard `#F2C14E`, sage `#8FC0A9`, coral `#F4A6A0`, peach `#F6BD9C`, lilac `#C9B6E4` | doors, roofs, props, the key, flowers |
| Real things | leaf `#7FB77E`, wood `#A0613D`, stone `#BDB3A6` | trees, logs, rocks |

The warm world makes the one cool colour, the mascot, the first thing the eye finds. The two films are filed in the
storage repository as `media/allspace-welcome-the-key/` and `media/allspace-welcome-the-chase/`.

### Ready-made directions (starting points, adjust to the brand's mood)
**Cool signature (blue, teal, purple):** warm the world.
- neutrals: cream `#FDFAF4`, sand `#F3E6D0`, charcoal `#2A2320`;
- supporting: terracotta `#E07A5F`, mustard `#F2C14E`, peach `#F6BD9C`, sage `#8FC0A9`.

**Warm signature (orange, red, yellow):** cool and calm the world.
- neutrals: off-white `#FBF8F2`, stone `#E4E0D8`, ink `#22262B`;
- supporting: teal `#2F7F86`, slate `#4A5A6A`, olive `#8A9A5B`, dusty blue `#9DB4C8`.

**Green signature:** earthy with one contrast.
- neutrals: linen `#F7F3EA`, bark `#3B2F26`;
- supporting: clay `#C9724B`, ochre `#D9A441`, blush `#EBB7A6`, sky `#BFD7E6`, the only cool support.

**Black, white or gold luxury brand:** restraint.
- neutrals: ivory `#F6F1E7`, taupe `#CBBFAE`, near-black `#161412`;
- signature: gold only on the product and the name;
- supporting: one deep colour at most (oxblood `#5E2129` or forest `#23372C`).

Supporting colours are always softer than the signature. If a supporting colour ends up within about 20° of the
signature's hue, swap it for another colour.
