# Light 3D with three.js (bundled; no Blender needed)

Good for: product turntables, a logo or title in 3D, simple objects moving, camera orbits, a `.glb`
model (made in Blender, a CC0 file the user saves on the Mac, or the user's own) with its animations. Not for photoreal scenes.
Cost: about 0.3–0.6 s per 1080p frame on a laptop CPU (a 7 s scene rendered in about 1 minute). A `.glb` model the user gives goes into the project with `studio_file_add` (it lands in `src/assets/`).

## Page setup
1. In `<head>`, after the other scripts:
   `<script type="importmap">{"imports":{"three":"./three/three.module.js","three/addons/":"./three/addons/"}}</script>`
   (`studio_compose` copies three.js and these add-ons when the page mentions three: `loaders/GLTFLoader.js`,
   `utils/BufferGeometryUtils.js`, `utils/SkeletonUtils.js`, `environments/RoomEnvironment.js`,
   `geometries/TextGeometry.js`, `loaders/FontLoader.js`, `geometries/RoundedBoxGeometry.js`).
2. A `<canvas id="c3d" width="{{W}}" height="{{H}}">` inside the scene div.
3. The code in `<script type="module">` (full working example: `studio_example` with `path: "examples/three-product/src/index.html"`):
```js
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
const {tl, T, S, finish} = SS.start();
const r = new THREE.WebGLRenderer({canvas: document.getElementById("c3d"), antialias: true, preserveDrawingBuffer: true, alpha: true});
r.setPixelRatio(1); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap was removed in the pinned three.js
r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
// … scene, lights, camera, meshes …
const st = {t: 0}, dur = T.s1.dur;
function draw() { /* set everything from st.t only */ r.render(scene, cam); }
tl.to(st, {t: dur, duration: dur, ease: "none", onUpdate: draw}, T.s1.start);
draw(); finish();
window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;
```

## Rules
- **Time only from the tween:** positions, rotations, camera and animation clips are computed from `st.t`.
  Never `THREE.Clock`, `getDelta()`, `setAnimationLoop` or `requestAnimationFrame`.
- **Models:** `const g = await new GLTFLoader().loadAsync("assets/model.glb")` **before** the `__timelines`
  line, so rendering waits for the model. Clips: `const mixer = new THREE.AnimationMixer(g.scene);
  g.animations.forEach(a => mixer.clipAction(a).play());` then in `draw()`: `mixer.setTime(st.t)`.
  Use `.glb` without Draco/meshopt compression; keep it under about 30 MB.
- Colours from the look: `getComputedStyle(document.getElementById("root")).getPropertyValue("--accent")`.
- Transparent canvas (`alpha: true`) lets the look's background and HTML text sit around the 3D.
- A `ShadowMaterial` floor gives a soft contact shadow without a visible floor.
- HTML labels on top of 3D: position them in CSS; to follow an object, project its position in `draw()`.
