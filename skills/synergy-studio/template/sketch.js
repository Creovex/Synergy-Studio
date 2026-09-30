// Synergy Studio sketch kit: hand-drawn 2D on a <canvas>, drawn frame by frame from the time t.
// Crayon hatching, line boil, wobbly ink outlines, paper grain, night scratches, glows, a camera.
// Deterministic (hash-based noise, no Math.random), so every render is identical. See references/illustration.md.
// Usage (compose copies this file next to the page; load it after lib.js):
//   a canvas element with id "cv" (width {{W}}, height {{H}}), and a script tag for sketch.js after lib.js
//   const K = SK.create(document.getElementById("cv")), {ink, rr, cam, paperBG, seg, ease} = K;
//   function render(t) { K.frame(t); paperBG(); cam(1.1, 960, 540); ink(rr(800, 600, 240, 150, 10, 1), "#D9774F", "#A4482C"); }
//   const st = {t: 0}; tl.to(st, {t: TOTAL, duration: TOTAL, ease: "none", onUpdate: () => render(st.t)}, 0); render(0);
(function () {
  const hash = (a, b = 0) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  const rng = seed => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));          // 0→1 progress of t between a and b
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = k => k * k * (3 - 2 * k), eOut = k => 1 - Math.pow(1 - k, 3), eIn = k => k * k * k;
  const eBack = k => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
  const strHash = s => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

  function create(canvas, o = {}) {
    const W = canvas.width, H = canvas.height, INK = o.ink || "#2A1D17", BOIL_FPS = o.boilFps ?? 10;
    const S = {ctx: canvas.getContext("2d"), base: new DOMMatrix(), boil: 0};
    const K = {W, H, INK, hash, rng, clamp, seg, lerp, ease, eOut, eIn, eBack, mk};
    Object.defineProperty(K, "ctx", {get: () => S.ctx});
    Object.defineProperty(K, "boil", {get: () => S.boil, set: v => { S.boil = v; }});
    // frame(t): call first in every render; the line boil changes BOIL_FPS times a second, like hand-drawn animation
    K.frame = t => { S.boil = Math.floor(t * BOIL_FPS); const c = S.ctx; c.setTransform(S.base); c.clearRect(0, 0, W, H); c.globalAlpha = 1; };
    // use(ctx, base, boil): draw into another canvas (thumbnails, polaroids); returns a function that restores
    K.use = (ctx, base, boil) => { const prev = [S.ctx, S.base, S.boil]; S.ctx = ctx; S.base = base || new DOMMatrix(); if (boil != null) S.boil = boil;
      return () => { [S.ctx, S.base, S.boil] = prev; }; };

    // textures, made once
    const tiles = {};
    function hatchTile(col, v) {
      const k = col + v; if (tiles[k]) return tiles[k];
      const c = mk(192, 192), g = c.getContext("2d"), r = rng(strHash(k)); g.strokeStyle = col; g.lineCap = "round";
      for (let i = 0; i < 190; i++) { const x = r() * 192, y = r() * 192, L = 12 + r() * 34, a = -1.0 + (r() - .5) * .4;
        g.globalAlpha = .16 + r() * .46; g.lineWidth = .7 + r() * 1.7;
        for (const dx of [-192, 0, 192]) for (const dy of [-192, 0, 192]) { g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.cos(a) * L, y + dy + Math.sin(a) * L); g.stroke(); } }
      return tiles[k] = c;
    }
    K.pat = col => S.ctx.createPattern(hatchTile(col, S.boil % 3), "repeat");     // crayon hatching in this colour
    const paper = mk(W, H); { const g = paper.getContext("2d"), r = rng(11); g.fillStyle = o.paper || "#ECE9E2"; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(60,50,40,${.04 + r() * .12})`; g.fillRect(r() * W, r() * H, 1 + r() * 1.6, 1 + r() * 1.6); }
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(30,25,20,${.25 + r() * .4})`; g.beginPath(); g.arc(r() * W, r() * H, .8 + r() * 1.4, 0, 7); g.fill(); }
      const v = g.createRadialGradient(W / 2, H / 2, W * .26, W / 2, H / 2, W * .62); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(80,60,40,.10)"); g.fillStyle = v; g.fillRect(0, 0, W, H); }
    const scratch = mk(W, H); { const g = scratch.getContext("2d"), r = rng(23); g.strokeStyle = "#fff"; g.lineCap = "round";
      for (let i = 0; i < 2600; i++) { const x = r() * W, y = r() * H, L = 8 + r() * 26; g.globalAlpha = .025 + r() * .06; g.lineWidth = .6 + r();
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + L * .5, y + L); g.stroke(); } }
    K.textures = {paper, scratch};

    // paths (functions that trace a path; pass them to ink/glow). rr = rounded rect with a hand-drawn wobble.
    K.rrPts = (x, y, w, h, r, seed, j = 1.3) => {
      const pts = [], st = 22, add = (px, py) => pts.push([px, py]);
      const arc = (cx, cy, a0) => { for (let i = 0; i <= 4; i++) { const a = a0 + i / 4 * Math.PI / 2; add(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } };
      const line = (x0, y0, x1, y1) => { const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / st)); for (let i = 1; i < n; i++) add(lerp(x0, x1, i / n), lerp(y0, y1, i / n)); };
      arc(x + w - r, y + r, -Math.PI / 2); line(x + w, y + r, x + w, y + h - r); arc(x + w - r, y + h - r, 0); line(x + w - r, y + h, x + r, y + h);
      arc(x + r, y + h - r, Math.PI / 2); line(x, y + h - r, x, y + r); arc(x + r, y + r, Math.PI); line(x + r, y, x + w - r, y);
      return pts.map((p, i) => [p[0] + (hash(seed + S.boil * 7, i) - .5) * 2 * j, p[1] + (hash(seed + S.boil * 7, i + 99) - .5) * 2 * j]);
    };
    K.poly = pts => () => { const c = S.ctx; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); };
    K.rr = (x, y, w, h, r, seed = 1) => K.poly(K.rrPts(x, y, w, h, Math.min(r, w / 2, h / 2), seed));
    K.circ = (x, y, r) => () => { S.ctx.beginPath(); S.ctx.arc(x, y, r, 0, Math.PI * 2); };
    K.ell = (x, y, rx, ry) => () => { S.ctx.beginPath(); S.ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };

    // ink(path, fill, hatchColour, {lw, oc, ha}): fill + crayon hatching + wobbly ink outline (lw 0 = no outline)
    K.ink = (path, base, hcol, op = {}) => {
      const c = S.ctx; c.save(); path(); if (base) { c.fillStyle = base; c.fill(); }
      if (hcol) { c.clip(); c.globalAlpha = op.ha ?? 1; c.fillStyle = K.pat(hcol); c.fillRect(-4000, -4000, 8000, 8000); }
      c.restore();
      const lw = op.lw ?? 5; if (lw) { path(); c.lineWidth = lw; c.lineJoin = "round"; c.strokeStyle = op.oc || INK; c.stroke(); }
    };
    K.glow = (path, col, blur, alpha = 1) => { const c = S.ctx; c.save(); c.globalAlpha = alpha; c.shadowColor = col; c.shadowBlur = blur; c.fillStyle = col; path(); c.fill(); c.restore(); };
    // tube(points, colour, width, hatchColour): a thick crayon line (beams, DNA strands, lightning)
    K.tube = (pts, col, w, hcol) => {
      const c = S.ctx; c.save(); c.lineCap = "round"; c.lineJoin = "round";
      const P = () => { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); };
      P(); c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = w + 4; c.stroke();
      P(); c.strokeStyle = col; c.lineWidth = w; c.stroke();
      if (hcol) { P(); c.strokeStyle = K.pat(hcol); c.lineWidth = w; c.stroke(); }
      c.restore();
    };
    // camera: cam(zoom, focusX, focusY, shake) puts world point (fx, fy) at the centre of the frame
    K.cam = (z, fx, fy, shake = 0) => { const c = S.ctx; c.setTransform(S.base); c.translate(W / 2 + shake * (hash(S.boil, 1) - .5), H / 2 + shake * (hash(S.boil, 2) - .5)); c.scale(z, z); c.translate(-fx, -fy); };
    K.screen = () => S.ctx.setTransform(S.base);
    K.vgrad = stops => { const c = S.ctx, g = c.createLinearGradient(0, 0, 0, H); stops.forEach(([o2, col]) => g.addColorStop(o2, col)); K.screen(); c.fillStyle = g; c.fillRect(0, 0, W, H); };
    K.paperBG = () => { K.screen(); S.ctx.drawImage(paper, 0, 0); };
    K.darkBG = (a = "#0D0B24", b = "#1B1740") => { K.vgrad([[0, a], [1, b]]); S.ctx.drawImage(scratch, 0, 0); };
    K.stars = (n, seed, alpha = 1) => { const c = S.ctx; K.screen(); for (let i = 0; i < n; i++) { const tw = .5 + .5 * Math.sin(i * 3.1 + S.boil * .9);
        c.fillStyle = `rgba(255,250,235,${alpha * (.3 + .7 * hash(i, seed) * tw)})`; c.fillRect(hash(i, seed + 1) * W, hash(i, seed + 2) * H * .8, 1.5 + hash(i, seed + 3) * 2, 1.5 + hash(i, seed + 3) * 2); } };
    // thin concentric guide circles (a sketchbook motif); k 0→1 grows them in
    K.circles = (cx, cy, k, alpha = .35) => { const c = S.ctx; c.save(); c.globalAlpha = alpha * k; c.strokeStyle = "#5B544C"; c.lineWidth = 1.4;
      [170, 300, 470, 700, 980].forEach((r, i) => { c.setLineDash(i % 2 ? [6, 9] : []); c.beginPath(); c.arc(cx, cy, r * (.85 + .15 * k), 0, 7); c.stroke(); }); c.restore(); };
    return K;
  }
  window.SK = {create, hash, rng, seg, lerp, ease, eOut, eIn, eBack};
})();
