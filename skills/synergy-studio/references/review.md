# The review gate (before showing the user anything as "done")

Two kinds of check. **Guard rails** (marked ⛔) must be TRUE: breaking them gives a broken, unreadable or
misleading video. **Craft checks** (marked ◇) are strong professional defaults: a FALSE is fine only if it
was a deliberate creative choice you can explain in one sentence (write the reason next to it); otherwise fix it.
Judge the **rendered file and its stills**, not your intentions. Each check is TRUE, FALSE or N/A
(N/A needs a reason). No scores. Any unexplained FALSE: fix, re-render, re-check only what the fix touches. After 3 failed rounds on the same video, stop, tell the user exactly what still fails, and write
an AVOID line in feedback.md. If you can start a fresh sub-agent, give it only the MP4 stills
(`stills/final-sheet.jpg`, `stills/sheet.jpg`), brief.md and this list, so it judges without your bias.

## Hook (shot 1) (for ads, explainers and social posts; for a story or film, 1–4 become: the first second is a striking, readable image)
1. ◇ The subject (product, person, problem) is visible in the first second.
2. ◇ The first 2–3 seconds (including anything that animates in during them) state or clearly imply the message.
3. ◇ It works muted: anything spoken in the hook is also on screen as text.
4. ◇ It is not a logo card, a title card or a fade from black.

## The idea
0. ◇ It has an idea a viewer would remember tomorrow: an insight, a visual metaphor or a hero moment
   (creative.md), not just information in order.

## Ambition, tone and reference (every video)
24. ◇ If the user gave a reference: 3 moments of ours side by side with the reference (reference/sheet.jpg)
    look like the same film or better. Name the differences in writing; fix any where ours is weaker.
25. ◇ At least three shot sizes, or a camera that moves, in anything over 20 s (cinema.md §2–3).
26. ◇ The hero moment fills the frame and is the richest image in the video (texture, light, motion).
27. ◇ Characters act: anticipation, squash, eyes that lead, a readable emotion per act (character.md).
28. ◇ The tone card is visible and audible: someone shown the video muted, then with sound, would name the
    same tone words as the brief (tone.md). It does not look like the template or the last video.

## Brief and frame (from brief.md)
5. ◇ The single message appears in the narration or on-screen text.
6. ⛔ If the brief has a call to action, it is concrete, said or shown, and held at least 2 s.
7. ◇ No second slogan or message competes with the first.
8. ◇ The audience's situation is recognisable; the video answers their alternative (or gives a reason to act now).
9. ⛔ Every fact, number, price and date matches brief.md and has a source; nothing invented.
10. ⛔ Brand name, handle and logo are exactly right (spelling, real logo file, colours from brief.md).
11. ⛔ None of the brief's "must never" items appear; none of the brand's avoided words.

## Craft
12. ◇ Every scene shows what is being said while it is said: check the frame at each key word (a number
    said must be on screen with that value; a "DM or WhatsApp" must show both as the words are spoken).
13. ⛔ All text is readable: large enough for a phone (design.md sizes), strong contrast, nothing cut off,
    and on screen long enough to read.
14. ⛔ Nothing important sits in the platform's unsafe areas (the red in `stills/safe-<platform>.jpg`).
15. ◇ Captions exist for speech (footage and social videos) and their words match what is said.
16. ◇ Motion in every scene; no accidental overlaps; text and UI elements (titles, captions, logo) keep their places.
17. ⛔ Voice is clear over music; no clipped words at joins. You cannot listen, so check: the mix ducks music
    under voice (audio.py does), footage joins fall in silences (`studio silences` on `audio/voice.wav` shows a
    pause at each cut in `cuts.json`), and `studio check` shows no clipping or loudness failure.

## Specification (`studio check` measures these)
18. ⛔ Format, size and frame rate match the platform; duration matches the timeline ± 0.15 s and is
    at most the target `length` × 1.05.
19. ⛔ Loudness −14 ±1 LUFS, true peak ≤ −1 dBTP; no black or frozen stretches.

## Honesty and disclosure
20. ⛔ A synthetic voice or AI-generated presenter/image is never presented as a real customer or a real
    person's testimony. First-person claims ("I use it every day") in an AI voice are FALSE unless the user
    confirms a real person said it.
21. ⛔ When an AI voice or AI visuals are used, the delivery message reminds the user to switch on the
    platform's AI label (TikTok and Instagram have one) and, for ads with an AI "customer", the video
    shows: "This voiceover is AI-generated. It is not a real customer speaking."
22. ⛔ Paid or gifted appearances carry a disclosure ("Paid partnership" / "Ad").
23. ⛔ "Illustrative example" is shown on any proof shot that is not a real documented result.

Write each round in feedback.md: `## <date> gate round <n>` and the FALSE conditions with evidence
(the exact frame time, the exact word, the exact measurement).
