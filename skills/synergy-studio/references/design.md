# Design and motion

## Looks (`data-look` on #root; colours only through the CSS variables in looks.css)
| Look | Feel | Use for |
|---|---|---|
| `paper` | warm cream, ink, coral/blue/teal accents | explainers, B2B, calm brands (the Synergy Studio explainer) |
| `midnight` | navy, cyan/blue accents | tech, health tech, SaaS (LSPedia style) |
| `bold` | yellow, black, hot pink | loud social clips, sales |
| `luxe` | near-black, champagne gold, ivory; Cormorant Garamond serif + tracked Jost | premium, beauty, fragrance, fashion (HAURA) |
These four are UI/motion-graphics looks. For drawn, textured, cinematic work (stories, films, music pieces,
mascots) use the sketch kit on a canvas instead (illustration.md), or design a look from the reference's style card.
Helper classes: `.serif` (Cormorant Garamond), `.tracked` (spaced capitals in Jost). A look is a starting
point: override variables for the brand (`#root{--accent:#1B6FE0}`) and keep `data-look` on the closest one.
**Brand colours are an accent, not the whole look:** give each colour a role and reserve the signature hue for
the logo and hero (brand-colours.md, `studio_reference` with `name: "brand-colours"`; the AllSpace "all blue" lesson);
`studio_brand_check` measures how much of a still is in the brand hue.
Brand colours: override variables in a `<style>` block (`#root{--accent:#1B6FE0}`) and use the brand's logo
file (never redraw a logo). Two font families at most (Manrope for headlines, Inter for text are bundled;
other fonts: the user gives `.woff2` files, you add them with `studio_file_add` into `src/assets/fonts/` and declare them with `@font-face`, open-licence fonts only; the tools download no fonts; styles.md shows how).
Variables: `--bg --bg2 --glow --ink --muted --line --card --accent --accent2 --accent3 --accent4 --soft --soft2 --soft3 --ok --bad`.
Classes: `.h1 .card .chip .lbl .step .bubble.user .bubble.bot .win .muted .accent .abs .scene`.

## Sizes (at 1080 px short side)
Headlines 64–150 px (Manrope 800), body 28–44 px, labels 22–26 px, never smaller. Captions 64–80 px.
16:9 = 1920×1080, 9:16 = 1080×1920, 1:1 = 1080×1080, 4:5 = 1080×1350.

## Safe areas (9:16 at 1080×1920; px covered by the app: top, bottom, left, right)
| Platform (`"platform"` in project.json) | top | bottom | left | right | source |
|---|---|---|---|---|---|
| `tiktok` | 200 | 400 | 60 | 180 | working default (app overlays) |
| `reels` / `meta` | 269 | 672 | 65 | 65 | published by Meta (14% / 35% / 6%) |
| `shorts` | 288 | 672 | 60 | 201 | working default |
`studio_stills` with `platform: "tiktok"` (or set `"platform"` in project.json) draws these areas in red on
`stills/safe-<platform>.jpg`: keep headlines, CTAs, logos and faces out of the red. `captions()` sits just
above the bottom band and clears the side band by default. When one video goes to several platforms, stay inside the strictest (reels/shorts
bottom 672 px). Margins everywhere: at least 80 px.

## Layout
One focal point per moment. Big type, few words (≤ 12 words on screen at once). For text and UI (titles,
captions, logos, labels): align to a grid and keep their positions across scenes. For pictures and
characters, do the opposite: vary shot size and placement between beats (cinema.md §2), put subjects on
thirds or dead centre on purpose, and let hero images fill the frame. Leave space.

## Motion
- Text and UI: enter with `rise` (0.6 s, power3.out) or `pop` (back.out); exit by the scene fade; stagger
  lists 0.08–0.2 s. Characters and objects deserve acting instead (character.md).
- Hold every readable text at least 0.25 s per word + 0.6 s.
- Something moves in every scene (a slow push-in `kenburns`, a counter, a drifting element); nothing
  frozen for 4 s or more (`studio_check` flags it).
- For luxury and calm brands, restraint beats gimmicks: the first HAURA sale ad (whip pans, flashes, spinning
  seal) was rejected as "rushed and unprofessional"; the approved one used dissolves, one hard cut and slow push-ins. That is brand feedback, not a ban: in a story or music piece a motivated move (a zoom
  through an eye, a flash at a magic moment, shake on thunder) is the craft (cinema.md §3–4).
- Sound follows motion: put `sfx` on events that pop or click; no more than one effect per second.
