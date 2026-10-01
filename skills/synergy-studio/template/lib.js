// Synergy Studio runtime helpers (browser, classic script; needs gsap.min.js and timing.js first).
// Everything is deterministic: only gsap.set + tl.to, absolute times, no clocks or random numbers.
// Usage in index.html:
//   const {tl, T, EV, V, rise, pop, press, pick, count, drawIn, stagger, finish} = SS.start();
//   rise("#title", V("s1", 0.2));  ...  finish();
(function () {
  const SS = {};
  SS.start = function (opts) {
    opts = opts || {};
    const TIMING = window.TIMING;
    if (!TIMING) throw new Error("timing.js missing: run `studio audio` then `studio compose`");
    const T = TIMING.T, EV = TIMING.EV, TOTAL = TIMING.TOTAL;
    const tl = gsap.timeline({paused: true});
    const E = opts.ease || "power3.out";
    // V(scene, offset): absolute time = the scene's narration start + offset (seconds)
    const V = (s, o) => { if (!T[s]) throw new Error("unknown scene " + s); return T[s].vo + (o || 0); };
    // S(scene, offset): absolute time from the scene's start (before the narration)
    const S = (s, o) => T[s].start + (o || 0);
    // CUE.name: absolute seconds from project.json "cues" (one cue sheet for the page, the score and the checks);
    // a misspelt cue name throws instead of silently giving undefined
    const CUE = new Proxy(TIMING.CUE || {}, {get: (o, k) => { if (typeof k !== "string" || k === "toJSON" || Object.prototype.hasOwnProperty.call(o, k)) return o[k]; throw new Error("unknown cue " + k + " (add it to project.json cues, then studio audio)"); }});
    const at = (s, name) => { const e = (EV[s] || {})[name]; if (e === undefined) throw new Error("unknown event " + s + "." + name); return V(s, e); };

    // By default scenes fade in at their start and out at their end (the last one stays). The first scene is
    // fully visible from frame 1 (the hook must not fade in from black) unless SS.start({fadeFirst: true}).
    // SS.start({cuts: "hard"}) turns the automatic fades off (match cuts, continuous camera, canvas films).
    const ids = Object.keys(T);
    ids.forEach((s, i) => {
      const el = document.getElementById(s); if (!el) return;
      if (opts.cuts === "hard") { gsap.set(el, {opacity: 1}); return; }
      if (i === 0 && !opts.fadeFirst) gsap.set(el, {opacity: 1});
      else { gsap.set(el, {opacity: 0}); tl.to(el, {opacity: 1, duration: 0.45, ease: "power2.out"}, T[s].start + 0.001); }
      if (i < ids.length - 1) tl.to(el, {opacity: 0, duration: 0.35, ease: "power2.in"}, T[s].end - 0.35);
    });

    const rise = (sel, t, d = 0.6, y = 40) => { gsap.set(sel, {opacity: 0, y}); tl.to(sel, {opacity: 1, y: 0, duration: d, ease: E}, t); };
    const fadeIn = (sel, t, d = 0.5) => { gsap.set(sel, {opacity: 0}); tl.to(sel, {opacity: 1, duration: d, ease: "power2.out"}, t); };
    const fadeOut = (sel, t, d = 0.4) => tl.to(sel, {opacity: 0, duration: d, ease: "power2.in"}, t);
    const pop = (sel, t) => { gsap.set(sel, {opacity: 0, scale: 0.85}); tl.to(sel, {opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.8)"}, t); };
    const press = (sel, t) => { tl.to(sel, {scale: 0.9, duration: 0.08, ease: "power1.in"}, t); tl.to(sel, {scale: 1, duration: 0.25, ease: "back.out(3)"}, t + 0.08); };
    const pick = (sel, t, color) => { press(sel, t); tl.to(sel, {backgroundColor: color || "var(--accent)", borderColor: color || "var(--accent)", color: "#fff", duration: 0.2}, t + 0.05); };
    // count a number up inside an element: count("#n", 0, 37, t, 1.4, v => Math.round(v))
    const count = (sel, from, to, t, d = 1.2, fmt = v => Math.round(v)) => {
      const el = typeof sel === "string" ? document.querySelector(sel) : sel; const o = {v: from};
      el.textContent = fmt(from);
      tl.to(o, {v: to, duration: d, ease: "power2.out", onUpdate: () => { el.textContent = fmt(o.v); }}, t);
    };
    // bar or line that grows from the left (set transform-origin in CSS if needed)
    const drawIn = (sel, t, d = 0.8) => { gsap.set(sel, {scaleX: 0, transformOrigin: "left center"}); tl.to(sel, {scaleX: 1, duration: d, ease: "power2.inOut"}, t); };
    // stagger(list, t, gap, fn): calls fn(el, time) for each element, gap seconds apart
    const stagger = (list, t, gap, fn) => { (typeof list === "string" ? document.querySelectorAll(list) : list).forEach((el, i) => fn(el, t + i * gap)); };
    // finish(): pads the timeline to exactly TOTAL seconds and returns it. The page itself must then register it
    // with the literal line  window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;
    // (HyperFrames' lint looks for that line in the HTML).
    const finish = () => {
      tl.to({}, {duration: 0.01}, TOTAL - 0.01);
      window.__SS = Object.assign(window.__SS || {}, {seek: t => { tl.seek(t, false); }, duration: TOTAL});   // captions() may have added its record first
      return tl;
    };
    // kenburns(sel, t0, t1, {from, to, x, y}): slow push-in on a photo or video (Haura sale-ad style)
    const kenburns = (sel, t0, t1, o = {}) => { gsap.set(sel, {scale: o.from || 1.0, x: 0, y: 0});
      tl.to(sel, {scale: o.to || 1.08, x: o.x || 0, y: o.y || 0, duration: t1 - t0, ease: "none"}, t0); };
    // punch(sel, t, amount): quick zoom punch on a cut or a key word (talking-head style)
    const punch = (sel, t, amount = 1.08) => { tl.to(sel, {scale: amount, duration: 0.12, ease: "power2.out"}, t); tl.to(sel, {scale: 1, duration: 0.5, ease: "power2.inOut"}, t + 0.12); };
    // captions({...}): word-by-word captions from window.WORDS (transcript.json via `studio transcribe` or `studio words`)
    //   the active word turns `highlight`; groups of up to maxWords / maxChars, breaking at pauses and punctuation
    //   options: top (default: just above the platform's bottom band, else 72%), left/right (px; default clears the platform's side buttons), size, font, color,
    //   highlight, box (false = no dark pill), boxColor, maxWords, maxChars, from, to (seconds),
    //   style: "color" (default: the active word turns `highlight`), "pop" (the active word also scales to 1.15) or
    //   "box" (the active word gets a `highlight` coloured box behind it, its text turns `boxText`, default #111)
    //   Every group is recorded with its words and times in window.__SS.captions; `studio render` saves it as out/captions.json.
    const captions = (o = {}) => {
      const style = o.style || "color"; if (!["color", "pop", "box"].includes(style)) throw new Error('captions style must be "color", "pop" or "box"');
      window.__SS = window.__SS || {}; const record = window.__SS.captions = [];
      const r3 = x => Math.round(x * 1000) / 1000;
      const words = []; (window.WORDS || []).forEach(w => {                 // split phrase entries into words
        const parts = String(w.text).trim().split(/\s+/).filter(Boolean); const tot = parts.reduce((a, p) => a + p.length + 1, 0); let t = w.start;
        parts.forEach(p => { const d = (w.end - w.start) * (p.length + 1) / tot; words.push({text: p, start: t, end: t + d}); t += d; }); });
      if (!words.length) return;
      const maxW = o.maxWords || 3, maxC = o.maxChars || (style === "color" ? 22 : 18), from = o.from ?? 0, to = o.to ?? TOTAL;
      const box = document.createElement("div"); box.id = "captions"; box.className = "abs";
      const sf = TIMING.safe || [0, 0, 0, 0];                               // keep clear of the app's side buttons
      const L = o.left ?? Math.max(60, sf[2] + 20), R = o.right ?? Math.max(60, sf[3] + 20);
      const H = document.getElementById("root").offsetHeight || 1080;
      const top = o.top || (TIMING.safe ? `${H - sf[1] - 230}px` : "72%");   // default: just above the app's bottom band
      box.style.cssText = `left:${L}px;right:${R}px;top:${top};text-align:center;font-family:${o.font || "var(--cap-font)"};font-weight:${o.weight || "var(--cap-weight)"};font-size:${o.size || 72}px;line-height:1.1;color:${o.color || "#fff"};text-shadow:0 4px 18px rgba(0,0,0,.55);z-index:50`;
      document.getElementById("root").appendChild(box);
      const groups = []; let g = [];
      words.filter(w => w.start >= from && w.start < to).forEach((w, i, arr) => {
        const chars = g.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
        const gap = g.length ? w.start - g[g.length - 1].end : 0;
        if (g.length && (g.length >= maxW || chars > maxC || gap > 0.35 || /[.!?,;:]$/.test(g[g.length - 1].text))) { groups.push(g); g = []; }
        g.push(w); });
      if (g.length) groups.push(g);
      groups.forEach((grp, gi) => {
        const el = document.createElement("div"); el.className = "abs"; el.style.cssText = "left:0;right:0;opacity:0";
        const pill = (o.box === false ? "" : `display:inline-block;padding:10px 26px;border-radius:22px;background:${o.boxColor || "rgba(0,0,0,.55)"}`) + (style === "pop" ? ";white-space:nowrap" : "");
        const wordStyle = style === "box" ? ' style="display:inline-block;line-height:1.1;border-radius:14px;padding:0 .12em;margin:0 .03em;background-color:rgba(0,0,0,0)"' : "";
        el.innerHTML = `<span style="${pill}">` + grp.map(w => `<span${style === "pop" ? ` style="display:inline-block;margin:0 ${(0.03 * w.text.length).toFixed(2)}em"` : wordStyle}>${w.text.replace(/</g, "&lt;")}</span>`).join(" ") + `</span>`; box.appendChild(el);
        const end = gi < groups.length - 1 ? Math.min(groups[gi + 1][0].start, grp[grp.length - 1].end + 0.6) : grp[grp.length - 1].end + 0.6;
        tl.to(el, {opacity: 1, duration: 0.08}, grp[0].start); tl.to(el, {opacity: 0, duration: 0.08}, end - 0.08);
        record.push({start: r3(grp[0].start), end: r3(end), words: grp.map(w => ({text: w.text, start: r3(w.start), end: r3(w.end)}))});
        [...el.firstChild.children].forEach((sp, wi) => {
          const on = grp[wi].start, off = wi < grp.length - 1 ? grp[wi + 1].start : null;      // the active word: from its start to the next word's start
          if (style === "box") { tl.to(sp, {backgroundColor: o.highlight || "var(--accent)", color: o.boxText || "#111", duration: 0.05}, on); if (off !== null) tl.to(sp, {backgroundColor: "rgba(0,0,0,0)", color: o.color || "#fff", duration: 0.05}, off); return; }
          tl.to(sp, {color: o.highlight || "var(--accent)", duration: 0.05}, on);
          if (style === "pop") tl.to(sp, {scale: 1.15, duration: 0.12, ease: "back.out(2)"}, on);
          if (off !== null) { tl.to(sp, {color: o.color || "#fff", duration: 0.05}, off); if (style === "pop") tl.to(sp, {scale: 1, duration: 0.08}, off); } });
      });
    };
    return {tl, T, EV, CUE, TOTAL, V, S, at, E, rise, fadeIn, fadeOut, pop, press, pick, count, drawIn, stagger, kenburns, punch, captions, finish};
  };
  window.SS = SS;
})();
