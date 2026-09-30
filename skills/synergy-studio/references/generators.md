# Using AI image/video generators (only if one is connected, e.g. the Higgsfield MCP)

Synergy Studio builds videos from code; generators are **ingredients**, never the whole video.
Use one only for shots that cannot be made otherwise (a lifestyle shot, a scene, a B-roll clip, a product
in a setting) and only when the user agrees to spend their credits. Never generate to test or demonstrate.

- **Read the tool's own instructions first.** For Higgsfield: call `get_workflow_instructions` (no
  argument) before any multi-step video job, and use `models_explore` to pick a model. Upload local files
  with its upload tool, alone in that turn; import web images with `media_import_url`.
- **Stills first, then animate.** Generate and approve a still, then turn it into motion; keep the exact
  prompt, parameters and media id next to each result (in `src/assets/generated.md`) so a revision edits
  the prompt instead of starting over.
- **Prompt order for video:** shot and camera ("static" if static) → one main motion → setting, style,
  light → sound. Duration and aspect ratio go in the parameters, not the prompt. Multi-shot models: label
  "Shot 1:", "Shot 2:" and the cut type.
- **Consistency:** repeat the same identity/style/lighting/palette words every time and reuse the same
  reference media; there are no seeds to lock a look.
- **Never let a model draw text, prices, logos or labels.** Composite the real logo and all text in HTML.
- Bring each clip into the video as footage (`<video muted>` in the page, or through `edit.clips`), check
  its aspect ratio and crop, and log any crop in feedback.md.
- Generated people and voices are AI content: apply review.md conditions 20–23.
- Jobs: submit independent jobs together, wait with the tool's wait function, stop after about 10 polls
  and tell the user which job is stuck; retry a rejected prompt once, reworded.
