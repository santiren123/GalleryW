/* ==========================================================
   行记 — 3D Particle Fluid Exhibition
   Three.js + GLSL GPGPU  ·  no build step, no ES modules

   Six photographs are pre-baked into GPU-resident position and
   colour textures at load. From then on every album change is a
   pure uniform swap: the field bursts apart on curl noise, then
   falls back under gravity into the next photograph. Nothing is
   sampled, decoded or allocated mid-flight, so switching costs
   the same whether it is the first change or the fiftieth.

   Requires (in order):
     libs/three.min.js
     libs/gsap.min.js
     js/particle-manifest.js

   Usage:
     ParticleGallery.mount('#stage').then(g => g.show(2));

   ========================================================== */

(function (global) {
  'use strict';

  /* ======================================================
     0 · Capability probe and quality tiers
     ====================================================== */

  /** Cloud half-height in world units. Camera framing keys off this. */
  const SPREAD = 1.25;

  /* Resting physics. Gravity is the spring stiffness k; damping supplies the
     drag c through c = -60*ln(DAMP_HOLD). Near-critical (c ≈ 2*sqrt(k)) is
     what makes the photograph snap into focus and hold still rather than
     oozing toward it — an overdamped field never looks sharp. */
  const GRAVITY_HOLD = 24.0;   // k
  const DAMP_HOLD = 0.845;     // c ≈ 10.0, critical at k=24 is 9.8
  const CURL_HOLD = 0.045;     // residual breath, near zero so points settle
  const GLOW_HOLD = 0.18;      // resting halo; higher smears the reconstruction

  /* Point diameter as a multiple of the spacing between neighbours. Below
     ~1.2 the reconstruction stipples; above ~1.5 neighbouring points smear
     into each other and fine detail dissolves. */
  const OVERLAP = 1.35;

  const TIERS = {
    /* sim is the side of the square data texture; particles = sim².
       grain nudges point size per tier: coarser fields want slightly fatter
       points so the photograph still reads as continuous tone. */
    ultra: { sim: 384, grain: 1.00, dpr: 2.0 },   // 147,456
    high: { sim: 320, grain: 1.02, dpr: 2.0 },   // 102,400
    mid: { sim: 224, grain: 1.06, dpr: 1.75 },  //  50,176
    low: { sim: 192, grain: 1.10, dpr: 1.5 },   //  36,864
    floor: { sim: 160, grain: 1.14, dpr: 1.25 },  //  25,600
  };

  function isMobile() {
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPod|Windows Phone/i.test(ua)) return true;
    // iPadOS 13+ reports as Macintosh; touch points give it away.
    if (/iPad/.test(ua)) return true;
    return /Macintosh/.test(ua) && navigator.maxTouchPoints > 2;
  }

  /**
   * Pick a tier from device signals. Deliberately conservative: an
   * over-ambitious particle count on a mid phone costs far more in
   * dropped frames than it buys in density.
   */
  function detectTier(renderer) {
    const mobile = isMobile();
    const cores = navigator.hardwareConcurrency || (mobile ? 4 : 8);
    const mem = navigator.deviceMemory || (mobile ? 4 : 8);
    const maxTex = renderer.capabilities.maxTextureSize;

    let tier;
    if (mobile) {
      tier = cores >= 6 && mem >= 4 ? 'mid' : cores >= 4 ? 'low' : 'floor';
    } else {
      tier = cores >= 8 && mem >= 8 ? 'ultra' : cores >= 4 ? 'high' : 'mid';
    }

    // A software / heavily throttled context reports few cores and no
    // float rendering; both paths land here and get the floor tier.
    if (!renderer.capabilities.isWebGL2 && !renderer.extensions.has('OES_texture_float')) {
      tier = 'floor';
    }

    const conf = Object.assign({ name: tier }, TIERS[tier]);
    while (conf.sim > maxTex && conf.sim > 64) conf.sim >>= 1;
    conf.count = conf.sim * conf.sim;
    conf.dpr = Math.min(conf.dpr, global.devicePixelRatio || 1);
    return conf;
  }

  /**
   * Float render targets are required for position feedback; half-float
   * is a usable fallback but drifts, so it is only taken if it must be.
   */
  function pickFloatType(renderer) {
    const gl2 = renderer.capabilities.isWebGL2;
    const ext = renderer.extensions;
    if (gl2 && ext.has('EXT_color_buffer_float')) return THREE.FloatType;
    if (!gl2 && ext.has('OES_texture_float') && ext.has('WEBGL_color_buffer_float')) {
      return THREE.FloatType;
    }
    // Half-float is only offered on WebGL2, where float *data* textures are
    // core. On WebGL1 without OES_texture_float the baked position textures
    // could not be uploaded at all, so fall through to the poster instead of
    // half-working.
    if (gl2) return THREE.HalfFloatType;
    return null; // caller falls back to a static poster
  }

  /* ======================================================
     1 · Offscreen bake — photograph to point cloud
     ====================================================== */

  const BAKE_EDGE = 640; // analysis resolution, long edge

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image failed: ' + src)); };
      img.src = src;
    });
  }

  /** sRGB -> linear. Colours are baked linear so additive glow sums correctly. */
  function toLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /**
   * Downsample a photograph and read its pixels back once.
   * Returns luminance, per-pixel Sobel energy and linear RGB.
   */
  function sampleImage(img) {
    const ratio = img.naturalWidth / img.naturalHeight;
    const w = Math.max(2, Math.round(ratio >= 1 ? BAKE_EDGE : BAKE_EDGE * ratio));
    const h = Math.max(2, Math.round(ratio >= 1 ? BAKE_EDGE / ratio : BAKE_EDGE));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;

    const n = w * h;
    const lum = new Float32Array(n);
    const lin = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lin[i * 3] = toLinear(r);
      lin[i * 3 + 1] = toLinear(g);
      lin[i * 3 + 2] = toLinear(b);
    }

    // Sobel energy: where the photograph has structure worth spending points on.
    const edge = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const tl = lum[i - w - 1], t = lum[i - w], tr = lum[i - w + 1];
        const l = lum[i - 1], r = lum[i + 1];
        const bl = lum[i + w - 1], b = lum[i + w], br = lum[i + w + 1];
        const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
        const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
        edge[i] = Math.min(1, Math.hypot(gx, gy) * 0.25);
      }
    }

    return { w: w, h: h, lum: lum, edge: edge, lin: lin };
  }

  /* Deterministic hash so a given album always bakes identically. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Bake one photograph into a pair of SIM×SIM RGBA float textures.
   *
   *   position.xyz — world coordinate of the point
   *   position.w   — per-particle random seed (drives dispersal direction)
   *   colour.rgb   — linear colour
   *   colour.a     — draw weight, doubles as point size multiplier
   *
   * Points are placed by stratified inverse-CDF sampling over an
   * importance field, not on a regular grid. Dark, empty sky costs
   * almost no points; a carved eave or a lit ridge gets a dense,
   * sharp-edged crowd. That concentration is what makes the
   * reassembled frame read as a photograph rather than a haze.
   */
  function bakeAlbum(img, sim, seed) {
    const s = sampleImage(img);
    const w = s.w, h = s.h, n = w * h;
    const count = sim * sim;

    // Importance = tonal presence + structural detail. The floor keeps a
    // thin scatter of points in the shadows so the frame has a ground.
    const weight = new Float32Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      // Structure dominates. Weighting by brightness alone hands most of the
      // budget to flat sky, which renders as a solid white slab and starves
      // the carved detail that actually reads as a photograph.
      const wgt = 0.05 + s.edge[i] * 1.15 + Math.pow(s.lum[i], 1.6) * 0.30;
      weight[i] = wgt;
      total += wgt;
    }

    // Cumulative distribution for inverse-transform sampling.
    const cdf = new Float32Array(n);
    let acc = 0;
    const inv = 1 / total;
    for (let i = 0; i < n; i++) {
      acc += weight[i] * inv;
      cdf[i] = acc;
    }
    cdf[n - 1] = 1;

    const posData = new Float32Array(count * 4);
    const colData = new Float32Array(count * 4);
    const rnd = mulberry32(seed * 2654435761);
    const meanWeight = total / n;

    // Fit the photograph inside the cloud without distorting it.
    const ratio = w / h;
    const halfH = SPREAD;
    const halfW = SPREAD * ratio;

    for (let p = 0; p < count; p++) {
      // Stratified: one sample per equal slice of probability mass.
      // Far lower clumping than count independent uniform draws.
      const u = (p + rnd()) / count;

      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const midIdx = (lo + hi) >> 1;
        if (cdf[midIdx] < u) lo = midIdx + 1; else hi = midIdx;
      }
      const idx = lo;
      const ix = idx % w;
      const iy = (idx / w) | 0;

      // Jitter inside the source texel so points do not lattice up.
      const jx = (ix + rnd()) / w;
      const jy = (iy + rnd()) / h;

      const lumv = s.lum[idx];

      // Relief: luminance drives depth, so lit faces stand proud of the
      // shadows and the cloud has real parallax instead of a flat card.
      const depth = (Math.pow(lumv, 1.2) - 0.42) * 0.58 + (rnd() - 0.5) * 0.05;

      const o = p * 4;
      posData[o] = (jx - 0.5) * 2 * halfW;
      posData[o + 1] = (0.5 - jy) * 2 * halfH;
      posData[o + 2] = depth;
      posData[o + 3] = rnd();

      // Density compensation. Importance sampling deliberately starves flat
      // regions of points, so each surviving point there has to cover more
      // ground: area per point goes as 1/weight, radius as 1/sqrt(weight).
      // Without this, thinly-sampled areas render as grainy haze instead of
      // smooth tone — and detailed areas stay crisp because their points are
      // many and small. Mean lands near 1.0 by construction.
      const wgt = Math.min(2.4, Math.max(0.6, Math.sqrt(meanWeight / weight[idx])));

      colData[o] = s.lin[idx * 3];
      colData[o + 1] = s.lin[idx * 3 + 1];
      colData[o + 2] = s.lin[idx * 3 + 2];
      colData[o + 3] = wgt;
    }

    const posTex = new THREE.DataTexture(posData, sim, sim, THREE.RGBAFormat, THREE.FloatType);
    const colTex = new THREE.DataTexture(colData, sim, sim, THREE.RGBAFormat, THREE.FloatType);
    for (const t of [posTex, colTex]) {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
    }

    return { position: posTex, color: colTex, aspect: ratio };
  }

  /* ======================================================
     2 · GLSL
     ====================================================== */

  /* Ashima / Gustavson simplex noise, curl-differentiated below. */
  const NOISE_GLSL = `
    vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
    vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
    vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v){
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);

      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);

      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;

      i = mod289(i);
      vec4 p = permute(permute(permute(
                 i.z + vec4(0.0, i1.z, i2.z, 1.0))
               + i.y + vec4(0.0, i1.y, i2.y, 1.0))
               + i.x + vec4(0.0, i1.x, i2.x, 1.0));

      float nn = 0.142857142857;
      vec3 ns = nn * D.wyz - D.xzx;

      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);

      vec4 x = x_ * ns.x + ns.yyyy;
      vec4 y = y_ * ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);

      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);

      vec4 s0 = floor(b0) * 2.0 + 1.0;
      vec4 s1 = floor(b1) * 2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));

      vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);

      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    vec3 snoiseVec3(vec3 x){
      return vec3(
        snoise(x),
        snoise(x + vec3(123.46, 45.67, 78.91)),
        snoise(x + vec3(-9.21, 31.77, 54.13))
      );
    }

    // Curl of a noise potential field: divergence-free, so the flow
    // swirls and folds like smoke instead of pumping points outward.
    vec3 curlNoise(vec3 p){
      const float e = 0.12;
      vec3 dx = vec3(e, 0.0, 0.0);
      vec3 dy = vec3(0.0, e, 0.0);
      vec3 dz = vec3(0.0, 0.0, e);

      vec3 px0 = snoiseVec3(p - dx), px1 = snoiseVec3(p + dx);
      vec3 py0 = snoiseVec3(p - dy), py1 = snoiseVec3(p + dy);
      vec3 pz0 = snoiseVec3(p - dz), pz1 = snoiseVec3(p + dz);

      float x = (py1.z - py0.z) - (pz1.y - pz0.y);
      float y = (pz1.x - pz0.x) - (px1.z - px0.z);
      float z = (px1.y - px0.y) - (py1.x - py0.x);

      return vec3(x, y, z) / (2.0 * e);
    }
  `;

  const QUAD_VERT = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  /* --- velocity integration ------------------------------------------ */
  const SIM_VELOCITY = `
    precision highp float;
    varying vec2 vUv;

    uniform sampler2D uPosition;
    uniform sampler2D uVelocity;
    uniform sampler2D uTargetA;
    uniform sampler2D uTargetB;

    uniform float uTargetMix;
    uniform float uTime;
    uniform float uDelta;
    uniform float uGravity;
    uniform float uCurl;
    uniform float uCurlScale;
    uniform float uDamping;
    uniform float uDispersal;
    uniform vec3  uPointer;
    uniform float uPointerForce;

    ${NOISE_GLSL}

    void main(){
      vec4 posSample = texture2D(uPosition, vUv);
      vec4 velSample = texture2D(uVelocity, vUv);
      vec3 pos = posSample.xyz;
      vec3 vel = velSample.xyz;

      float seed = posSample.w;

      // Cross-fade between the outgoing and incoming photograph. Both
      // textures are already resident, so this costs one extra fetch.
      vec3 target = mix(
        texture2D(uTargetA, vUv).xyz,
        texture2D(uTargetB, vUv).xyz,
        uTargetMix
      );

      vec3 force = vec3(0.0);

      // --- gravity toward the photograph -----------------------------
      // A spring tuned near critical damping: uGravity is the stiffness k
      // and uDamping supplies c, with c = -60*ln(uDamping). At the resting
      // values (k=24, damping=0.845) the ratio c/2*sqrt(k) sits just under
      // 1, so points arrive fast and stop dead instead of drifting in.
      // Staggering k by seed makes the frame resolve in a sweep.
      float stagger = 0.78 + seed * 0.44;
      force += (target - pos) * uGravity * stagger;

      // --- curl drift -------------------------------------------------
      // Sampled around the target, not the live position, so points keep
      // a memory of where they belong even while scattered.
      vec3 field = curlNoise(target * uCurlScale + vec3(0.0, 0.0, uTime * 0.12));
      force += field * uCurl;

      // --- dispersal burst --------------------------------------------
      // A per-particle direction blended with the outward radial, so the
      // burst reads as an explosion rather than a uniform balloon.
      if (uDispersal > 0.0001) {
        vec3 jitter = normalize(snoiseVec3(target * 1.9 + seed * 41.3) + 0.0001);
        vec3 radial = normalize(pos + vec3(0.0001, 0.0, 0.0));
        vec3 dir = normalize(mix(radial, jitter, 0.68));
        force += dir * uDispersal * (3.2 + seed * 4.0);
      }

      // --- pointer repulsion -------------------------------------------
      vec3 toPointer = pos - uPointer;
      float d = length(toPointer);
      if (d < 0.85 && uPointerForce > 0.0001) {
        float fall = 1.0 - d / 0.85;
        force += normalize(toPointer + vec3(0.0001)) * fall * fall * uPointerForce * 5.0;
      }

      vel += force * uDelta;
      vel *= pow(uDamping, uDelta * 60.0);

      // Clamp so a tab-restore spike cannot fling the field off screen.
      float sp = length(vel);
      if (sp > 12.0) vel *= 12.0 / sp;

      gl_FragColor = vec4(vel, velSample.w);
    }
  `;

  /* --- position integration ------------------------------------------- */
  const SIM_POSITION = `
    precision highp float;
    varying vec2 vUv;

    uniform sampler2D uPosition;
    uniform sampler2D uVelocity;
    uniform float uDelta;

    void main(){
      vec4 posSample = texture2D(uPosition, vUv);
      vec3 vel = texture2D(uVelocity, vUv).xyz;
      // Semi-implicit Euler: velocity for this step is already updated.
      gl_FragColor = vec4(posSample.xyz + vel * uDelta, posSample.w);
    }
  `;

  /* --- point rendering -------------------------------------------------- */
  const RENDER_VERT = `
    precision highp float;

    attribute vec2 aRef;

    uniform sampler2D uPosition;
    uniform sampler2D uVelocity;
    uniform sampler2D uColorA;
    uniform sampler2D uColorB;
    uniform float uColorMix;
    uniform float uSize;
    uniform float uDispersed;

    varying vec3 vColor;
    varying float vHeat;

    void main(){
      vec4 P = texture2D(uPosition, aRef);
      vec4 cA = texture2D(uColorA, aRef);
      vec4 cB = texture2D(uColorB, aRef);
      vec4 c = mix(cA, cB, uColorMix);

      vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
      gl_Position = projectionMatrix * mv;

      float dist = max(-mv.z, 0.001);

      // Scattered points swell slightly and burn brighter, which is what
      // sells the nebula state; assembled points tighten to stay sharp.
      float swell = 1.0 + uDispersed * 0.55;

      // uSize already carries the pixel ratio and the projected scale (see
      // _updatePointSize); 2.4/dist is left in purely for depth cueing, so
      // near points read larger than far ones.
      gl_PointSize = uSize * c.a * swell * (2.4 / dist);

      float speed = length(texture2D(uVelocity, aRef).xyz);

      vColor = c.rgb;
      vHeat = clamp(speed * 0.30, 0.0, 1.4) * uDispersed;
    }
  `;

  const RENDER_FRAG = `
    precision highp float;

    uniform float uOpacity;
    uniform float uGlow;
    uniform float uExposure;

    varying vec3 vColor;
    varying float vHeat;

    void main(){
      vec2 uv = gl_PointCoord - 0.5;
      float d = dot(uv, uv) * 4.0;   // 0 at centre, 1 at the inscribed edge
      if (d > 1.0) discard;

      // Tight core plus a wide exponential skirt. The skirt is what gives
      // the soft halo; the core is what keeps the photograph legible. The
      // core has to stay narrow — widen it and overlapping points smear
      // the reconstruction into a blob.
      float core = smoothstep(0.72, 0.04, d);
      float halo = exp(-d * 3.2);
      // Opacity is independent of the size multiplier: that multiplier exists
      // to equalise screen coverage, and folding it into alpha as well would
      // re-introduce the density bias it was there to cancel.
      float alpha = clamp(core + halo * uGlow, 0.0, 1.0) * uOpacity;
      if (alpha < 0.004) discard;

      // Moving points bias warm, so the burst has heat in it.
      vec3 rgb = vColor * uExposure + vec3(0.9, 0.62, 0.34) * vHeat * 0.55;
      rgb += rgb * halo * uGlow * 1.35;

      // Highlight shoulder driven by the brightest channel, so it compresses
      // without shifting hue. Exposure alone would clip a lit sky to a flat
      // white slab and throw away every gradient inside it.
      rgb = rgb / (1.0 + max(rgb.r, max(rgb.g, rgb.b)) * 0.42);

      // Premultiplied output. Raising rgb above alpha buys additive-style
      // bloom while alpha still occludes, so colour stays faithful when
      // the field is assembled and blooms when it is scattered.
      gl_FragColor = vec4(rgb * alpha, alpha);
    }
  `;

  /* ======================================================
     3 · Ping-pong buffer
     ====================================================== */

  function makeTarget(sim, type) {
    return new THREE.WebGLRenderTarget(sim, sim, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: type,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
  }

  function PingPong(sim, type) {
    this.targets = [makeTarget(sim, type), makeTarget(sim, type)];
    this.i = 0;
  }
  PingPong.prototype = {
    get read() { return this.targets[this.i]; },
    get write() { return this.targets[1 - this.i]; },
    swap: function () { this.i = 1 - this.i; },
    dispose: function () { this.targets.forEach(function (t) { t.dispose(); }); },
  };

  /* ======================================================
     4 · Gallery
     ====================================================== */

  function Gallery(host, albums, options) {
    this.host = host;
    this.albums = albums;
    this.options = options || {};
    this.index = 0;
    this.baked = new Array(albums.length).fill(null);
    this.disposed = false;
    this._listeners = {};
  }

  Gallery.prototype._emit = function (name, payload) {
    (this._listeners[name] || []).forEach(function (fn) { fn(payload); });
  };

  Gallery.prototype.on = function (name, fn) {
    (this._listeners[name] = this._listeners[name] || []).push(fn);
    return this;
  };

  Gallery.prototype.init = async function () {
    const host = this.host;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,          // points are round; MSAA buys nothing here
      alpha: true,
      powerPreference: 'high-performance',
      premultipliedAlpha: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer = renderer;

    const floatType = pickFloatType(renderer);
    if (!floatType) {
      renderer.dispose();
      throw new Error('float render targets unsupported');
    }
    this.floatType = floatType;

    const tier = detectTier(renderer);
    this.tier = tier;
    renderer.setPixelRatio(tier.dpr);

    host.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      display: 'block', width: '100%', height: '100%',
    });

    /* --- scenes ------------------------------------------------------ */
    this.simScene = new THREE.Scene();
    this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 60);

    /* --- bake the first album so the stage can paint immediately ----- */
    const first = await this._bake(0);
    this.baked[0] = first;

    const sim = tier.sim;

    /* --- simulation materials ---------------------------------------- */
    const shared = {
      uPosition: { value: null },
      uVelocity: { value: null },
      uTargetA: { value: first.position },
      uTargetB: { value: first.position },
      uTargetMix: { value: 0 },
      uTime: { value: 0 },
      uDelta: { value: 1 / 60 },
      uGravity: { value: 0 },
      uCurl: { value: 1.35 },
      uCurlScale: { value: 0.78 },
      uDamping: { value: 0.90 },
      uDispersal: { value: 0 },
      uPointer: { value: new THREE.Vector3(999, 999, 999) },
      uPointerForce: { value: 0 },
    };
    this.sim = shared;

    this.velocityMat = new THREE.ShaderMaterial({
      uniforms: shared,
      vertexShader: QUAD_VERT,
      fragmentShader: SIM_VELOCITY,
      depthTest: false,
      depthWrite: false,
    });

    this.positionMat = new THREE.ShaderMaterial({
      uniforms: {
        uPosition: shared.uPosition,
        uVelocity: shared.uVelocity,
        uDelta: shared.uDelta,
      },
      vertexShader: QUAD_VERT,
      fragmentShader: SIM_POSITION,
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.velocityMat);
    this.quad.frustumCulled = false;
    this.simScene.add(this.quad);

    this.posBuf = new PingPong(sim, floatType);
    this.velBuf = new PingPong(sim, floatType);

    /* Convergence probe. Reduces the whole velocity field to one byte of
       mean speed in a single draw, so the loop can tell "the photograph has
       stopped moving" from "the photograph is still flying in" without
       guessing from timeline duration. Read only while settling. */
    this.probeTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.probeMat = new THREE.ShaderMaterial({
      uniforms: { uVelocity: { value: null } },
      vertexShader: QUAD_VERT,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uVelocity;
        void main(){
          float s = 0.0;
          // 16x16 evenly spaced taps across the field: enough of a sample to
          // call a standstill, cheap enough to run a few times a second.
          for (int y = 0; y < 16; y++) {
            for (int x = 0; x < 16; x++) {
              vec2 uv = (vec2(float(x), float(y)) + 0.5) / 16.0;
              s += length(texture2D(uVelocity, uv).xyz);
            }
          }
          gl_FragColor = vec4(clamp(s / 256.0 * 4.0, 0.0, 1.0), 0.0, 0.0, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.probePixel = new Uint8Array(4);
    this.probeTick = 0;

    /* Seed both position buffers with the first album, scattered wide so
       the exhibition opens by condensing out of noise. */
    this._seed(first.position);

    /* --- point cloud ------------------------------------------------- */
    const count = tier.count;
    const refs = new Float32Array(count * 2);
    const dummy = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      refs[i * 2] = ((i % sim) + 0.5) / sim;
      refs[i * 2 + 1] = (Math.floor(i / sim) + 0.5) / sim;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(dummy, 3));
    geo.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);

    this.renderUniforms = {
      uPosition: { value: null },
      uVelocity: { value: null },
      uColorA: { value: first.color },
      uColorB: { value: first.color },
      uColorMix: { value: 0 },
      uSize: { value: 4 },   // replaced by _updatePointSize() on first resize
      uOpacity: { value: 0 },
      uGlow: { value: 0.85 },
      // Just above 1 to pay back the black showing through partial coverage.
      // Pushing it higher blooms overlapping points together and costs more
      // detail than the extra brightness is worth.
      uExposure: { value: 1.15 },
      uDispersed: { value: 1 },
    };

    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.renderUniforms,
      vertexShader: RENDER_VERT,
      fragmentShader: RENDER_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,               // premultiplied source
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    /* --- camera rig -------------------------------------------------- */
    // z is derived by resize() from the album aspect; zBase/zOffset keep the
    // fitted distance and the per-album vantage separable.
    this.rig = { x: 0, y: 0, z: 3.45, zBase: 3.45, zOffset: 0, tx: 0, ty: 0, roll: 0 };
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0, active: 0 };
    this.pointerWorld = new THREE.Vector3(999, 999, 999);
    this.lastPointerMove = 0;

    this._bindEvents();
    this.resize();

    /* --- opening: condense out of the noise -------------------------- */
    this.running = false;
    this.lastFrame = performance.now();
    this.idleSince = 0;
    this.settled = false;
    this.wake();

    const u = this.sim;
    const tl = gsap.timeline();
    tl.to(this.renderUniforms.uOpacity, { value: 1, duration: 1.1, ease: 'power2.out' }, 0);
    tl.to(u.uGravity, { value: GRAVITY_HOLD, duration: 2.0, ease: 'power2.inOut' }, 0.15);
    tl.to(u.uCurl, { value: CURL_HOLD, duration: 2.2, ease: 'power2.inOut' }, 0.15);
    tl.to(u.uDamping, { value: DAMP_HOLD, duration: 2.0, ease: 'power2.inOut' }, 0.15);
    tl.to(this.renderUniforms.uDispersed, { value: 0, duration: 2.1, ease: 'power2.inOut' }, 0.2);
    tl.to(this.renderUniforms.uGlow, { value: GLOW_HOLD, duration: 2.1, ease: 'power2.inOut' }, 0.2);
    tl.eventCallback('onUpdate', this.wake.bind(this));
    tl.eventCallback('onComplete', this._markSettling.bind(this));
    this.openTl = tl;

    /* --- bake the remaining five while the opening plays -------------- */
    this._bakeRest();

    this._emit('ready', { tier: tier.name, count: tier.count });
    return this;
  };

  /** Load and bake album i. */
  Gallery.prototype._bake = async function (i) {
    const img = await loadImage(this.albums[i].src);
    return bakeAlbum(img, this.tier ? this.tier.sim : TIERS.high.sim, i + 1);
  };

  /**
   * Bake albums 1..5 one per idle slot. Spreading the work keeps the
   * opening animation smooth; by the time anyone reaches for the nav,
   * every album is already resident and switching is a uniform swap.
   */
  Gallery.prototype._bakeRest = function () {
    const self = this;
    let i = 1;

    const schedule = global.requestIdleCallback
      ? function (fn) { global.requestIdleCallback(fn, { timeout: 900 }); }
      : function (fn) { setTimeout(fn, 120); };

    function step() {
      if (self.disposed || i >= self.albums.length) {
        if (!self.disposed) self._emit('baked', { count: self.albums.length });
        return;
      }
      const at = i++;
      self._bake(at).then(function (data) {
        if (self.disposed) return;
        self.baked[at] = data;
        schedule(step);
      }).catch(function (err) {
        console.warn('[particle-gallery] bake failed for', self.albums[at].src, err);
        schedule(step);
      });
    }

    schedule(step);
  };

  /**
   * Prime the position buffers. Points start on a wide shell of curl-ish
   * noise around their destination so the first assembly has somewhere
   * to fall from.
   */
  Gallery.prototype._seed = function (targetTex) {
    const sim = this.tier.sim;
    const data = targetTex.image.data;
    const seeded = new Float32Array(data.length);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i + 3];
      const theta = r * Math.PI * 2;
      const phi = Math.acos(2 * ((i / 4) % 997) / 997 - 1);
      const rad = 2.4 + r * 2.2;
      seeded[i] = data[i] * 0.25 + Math.sin(phi) * Math.cos(theta) * rad;
      seeded[i + 1] = data[i + 1] * 0.25 + Math.sin(phi) * Math.sin(theta) * rad;
      seeded[i + 2] = data[i + 2] * 0.25 + Math.cos(phi) * rad * 0.55;
      seeded[i + 3] = r;
    }

    const tex = new THREE.DataTexture(seeded, sim, sim, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    const blit = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: tex } },
      vertexShader: QUAD_VERT,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uSrc;
        void main(){ gl_FragColor = texture2D(uSrc, vUv); }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.quad.material = blit;
    for (const rt of this.posBuf.targets) {
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.simScene, this.simCamera);
    }
    // Velocity starts at rest.
    blit.uniforms.uSrc.value = null;
    this.renderer.setRenderTarget(this.velBuf.targets[0]);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(this.velBuf.targets[1]);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(null);

    blit.dispose();
    tex.dispose();
    this.quad.material = this.velocityMat;
  };

  /* ------------------ album switching ------------------ */

  /**
   * Burst apart, swap targets at the peak, then fall into the new
   * photograph. Every texture involved is already on the GPU.
   */
  Gallery.prototype.show = function (index, opts) {
    index = ((index % this.albums.length) + this.albums.length) % this.albums.length;
    if (index === this.index && !(opts && opts.force)) return null;
    if (this.switchTl && this.switchTl.isActive()) this.switchTl.kill();

    const next = this.baked[index];
    if (!next) {
      // Not baked yet (very early click). Bake on demand, then run.
      const self = this;
      this._bake(index).then(function (data) {
        self.baked[index] = data;
        self.show(index, { force: true });
      });
      return null;
    }

    const prev = this.index;
    this.index = index;
    this.settled = false;
    this.wake();

    const u = this.sim;
    const r = this.renderUniforms;
    const self = this;

    // Give each album its own vantage so the exhibition moves through space.
    // The offsets ride on top of the fitted distance rather than replacing
    // it, so no album can drift out of frame on an odd viewport.
    const golden = index * 2.399963;
    const zOffset = Math.sin(golden * 0.7) * 0.22;
    this._updatePointSize(next.aspect);
    this.rig.zBase = this._fitDistance(next.aspect);
    this.rig.zOffset = zOffset;
    const camTarget = {
      x: Math.cos(golden) * 0.30,
      y: Math.sin(golden * 1.3) * 0.18,
      z: this.rig.zBase + zOffset,
      roll: Math.sin(golden * 0.9) * 0.045,
    };

    const tl = gsap.timeline({
      onUpdate: function () { self.wake(); },
      onComplete: function () {
        // Collapse the cross-fade: B becomes the resting state.
        u.uTargetA.value = next.position;
        u.uTargetB.value = next.position;
        u.uTargetMix.value = 0;
        r.uColorA.value = next.color;
        r.uColorB.value = next.color;
        r.uColorMix.value = 0;
        self._markSettling();
        self._emit('shown', { index: index, album: self.albums[index] });
      },
    });

    // --- phase 1 · dispersal -------------------------------------------
    tl.to(u.uDispersal, { value: 1, duration: 0.50, ease: 'power2.out' }, 0);
    tl.to(u.uGravity, { value: 0.9, duration: 0.42, ease: 'power2.out' }, 0);
    // Curl carries most of the scatter, the radial burst only kicks it off:
    // the field should fold and swirl like smoke, not detonate.
    tl.to(u.uCurl, { value: 3.4, duration: 0.55, ease: 'power2.out' }, 0);
    tl.to(u.uDamping, { value: 0.93, duration: 0.5, ease: 'power2.out' }, 0);
    tl.to(r.uDispersed, { value: 1, duration: 0.5, ease: 'power2.out' }, 0);
    tl.to(r.uGlow, { value: 0.95, duration: 0.5, ease: 'power2.out' }, 0);

    // --- swap at the peak of the burst ----------------------------------
    tl.add(function () {
      u.uTargetB.value = next.position;
      r.uColorB.value = next.color;
      u.uTargetMix.value = 0;
      r.uColorMix.value = 0;
    }, 0.46);

    tl.to(u.uTargetMix, { value: 1, duration: 0.62, ease: 'power1.inOut' }, 0.50);
    tl.to(r.uColorMix, { value: 1, duration: 0.72, ease: 'power1.inOut' }, 0.52);

    // --- phase 2 · gravity reassembles the frame -------------------------
    tl.to(u.uDispersal, { value: 0, duration: 0.72, ease: 'power2.inOut' }, 0.52);
    tl.to(u.uGravity, { value: GRAVITY_HOLD, duration: 1.30, ease: 'power2.inOut' }, 0.60);
    tl.to(u.uCurl, { value: CURL_HOLD, duration: 1.45, ease: 'power2.inOut' }, 0.62);
    tl.to(u.uDamping, { value: DAMP_HOLD, duration: 1.30, ease: 'power2.inOut' }, 0.62);
    tl.to(r.uDispersed, { value: 0, duration: 1.35, ease: 'power2.inOut' }, 0.65);
    tl.to(r.uGlow, { value: GLOW_HOLD, duration: 1.35, ease: 'power2.inOut' }, 0.65);

    // --- camera ----------------------------------------------------------
    tl.to(this.rig, {
      x: camTarget.x, y: camTarget.y, z: camTarget.z, roll: camTarget.roll,
      duration: 1.85, ease: 'power2.inOut',
    }, 0);

    this.switchTl = tl;
    this._emit('switch', { from: prev, to: index, album: this.albums[index] });
    return tl;
  };

  Gallery.prototype.next = function () { return this.show(this.index + 1); };
  Gallery.prototype.prev = function () { return this.show(this.index - 1); };

  /* ------------------ events ------------------ */

  Gallery.prototype._bindEvents = function () {
    const self = this;

    this._onResize = function () { self.resize(); self.wake(); };
    global.addEventListener('resize', this._onResize, { passive: true });

    this._onPointer = function (e) {
      const rect = self.renderer.domElement.getBoundingClientRect();
      const t = e.touches && e.touches[0] ? e.touches[0] : e;
      self.pointer.tx = ((t.clientX - rect.left) / rect.width) * 2 - 1;
      self.pointer.ty = -(((t.clientY - rect.top) / rect.height) * 2 - 1);
      self.pointer.active = 1;
      self.lastPointerMove = performance.now();
      // `settled` tracks the morph, not the pointer — the busy gate already
      // keeps the loop awake while the cursor moves. Clearing it here would
      // mean the field could never sleep again after a single mouse move.
      self.wake();
    };
    global.addEventListener('pointermove', this._onPointer, { passive: true });
    global.addEventListener('touchmove', this._onPointer, { passive: true });

    this._onLeave = function () { self.pointer.active = 0; self.wake(); };
    global.addEventListener('pointerleave', this._onLeave, { passive: true });

    this._onVisibility = function () {
      if (!document.hidden) { self.lastFrame = performance.now(); self.wake(); }
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  };

  /**
   * Distance at which a cloud of the given aspect fits the viewport on both
   * axes. Solved rather than guessed, so a landscape photograph in a portrait
   * viewport pulls back instead of bleeding off the sides.
   */
  Gallery.prototype._fitDistance = function (aspect) {
    const halfFov = (this.camera.fov * Math.PI) / 360;
    const tan = Math.tan(halfFov);
    const zForHeight = SPREAD / tan;
    const zForWidth = (SPREAD * aspect) / (tan * this.camera.aspect);
    // Containing the width outright would strand a landscape frame as a thin
    // band in a tall phone viewport. Allow the width to pull back only so far;
    // past that, let the edges crop rather than shrink the whole exhibit.
    const z = Math.max(zForHeight, Math.min(zForWidth, zForHeight * 1.55));
    return z * 1.06; // a little air around the frame
  };

  Gallery.prototype._currentAspect = function () {
    const b = this.baked[this.index];
    return b ? b.aspect : 1;
  };

  /**
   * Size points so they tile the projected cloud regardless of viewport or
   * fit distance. Spacing between neighbours is cloudPx*sqrt(aspect/count);
   * a point wants to be a bit wider than that to close the gaps. Solving for
   * uSize cancels z entirely, so a far-away fit no longer starves the frame
   * of coverage — which is exactly what turned the tall-viewport render black.
   */
  Gallery.prototype._updatePointSize = function (aspect) {
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const heightDev = this.renderer.domElement.height; // drawing buffer px
    const cloudPxPerZ = (heightDev * SPREAD) / tan;    // cloud height * z
    const spacing = cloudPxPerZ * Math.sqrt(aspect / this.tier.count);
    this.renderUniforms.uSize.value = (spacing * OVERLAP * this.tier.grain) / 2.4;
  };

  Gallery.prototype.resize = function () {
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    // Re-fit for whatever is on screen; a rotated phone changes both terms.
    if (this.rig && this.baked[this.index]) {
      const aspect = this._currentAspect();
      this._updatePointSize(aspect);
      this.rig.zBase = this._fitDistance(aspect);
      // Don't fight an in-flight camera tween — it will land on the new base.
      if (!(this.switchTl && this.switchTl.isActive())) {
        this.rig.z = this.rig.zBase + this.rig.zOffset;
      }
    }
  };

  /* ------------------ smart render loop ------------------ */

  /** Restart the loop. Cheap and idempotent — safe to call per event. */
  Gallery.prototype.wake = function () {
    this.idleSince = 0;
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastFrame = performance.now();
    const self = this;
    this._raf = requestAnimationFrame(function tick(now) {
      if (!self.running || self.disposed) return;
      self._frame(now);
      self._raf = requestAnimationFrame(tick);
    });
  };

  Gallery.prototype.sleep = function () {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._emit('sleep', {});
  };

  /** Called when a timeline finishes; starts the countdown to standstill. */
  Gallery.prototype._markSettling = function () {
    this.settled = true;
    this.idleSince = 0;
  };

  /** ms of quiet after the morph completes before the loop halts. */
  const SETTLE_MS = 1500;

  Gallery.prototype._frame = function (now) {
    const rawDelta = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    // Clamp so a backgrounded tab does not integrate one huge step.
    const dt = Math.min(rawDelta, 1 / 30) || 1 / 60;

    const u = this.sim;
    u.uTime.value += dt;
    u.uDelta.value = dt;

    /* --- damped parallax ------------------------------------------- */
    const p = this.pointer;
    const ease = 1 - Math.pow(0.0016, dt); // frame-rate independent damping
    p.x += (p.tx - p.x) * ease;
    p.y += (p.ty - p.y) * ease;

    const moving = Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) > 0.0006;

    // A pointer that has stopped stops pushing. Without this the repulsion
    // uniform stays live wherever the cursor was last seen, the field never
    // reaches standstill, and the loop can never sleep.
    if (p.active && now - this.lastPointerMove > 600) p.active = 0;

    // Pointer in world space on the z=0 plane, for repulsion.
    if (p.active) {
      const halfH = Math.tan((this.camera.fov * Math.PI) / 360) * this.rig.z;
      this.pointerWorld.set(p.x * halfH * this.camera.aspect, p.y * halfH, 0);
      u.uPointer.value.copy(this.pointerWorld);
      u.uPointerForce.value += (0.55 - u.uPointerForce.value) * ease;
    } else {
      u.uPointerForce.value += (0 - u.uPointerForce.value) * ease;
    }

    /* --- camera ------------------------------------------------------ */
    const rig = this.rig;
    this.camera.position.set(
      rig.x + p.x * 0.34,
      rig.y + p.y * 0.22,
      rig.z
    );
    this.camera.up.set(Math.sin(rig.roll), Math.cos(rig.roll), 0);
    this.camera.lookAt(rig.tx + p.x * 0.06, rig.ty + p.y * 0.04, 0);

    /* --- GPGPU: velocity, then position ------------------------------ */
    const renderer = this.renderer;

    this.quad.material = this.velocityMat;
    u.uPosition.value = this.posBuf.read.texture;
    u.uVelocity.value = this.velBuf.read.texture;
    renderer.setRenderTarget(this.velBuf.write);
    renderer.render(this.simScene, this.simCamera);
    this.velBuf.swap();

    this.quad.material = this.positionMat;
    this.positionMat.uniforms.uPosition.value = this.posBuf.read.texture;
    this.positionMat.uniforms.uVelocity.value = this.velBuf.read.texture;
    renderer.setRenderTarget(this.posBuf.write);
    renderer.render(this.simScene, this.simCamera);
    this.posBuf.swap();

    /* --- draw --------------------------------------------------------- */
    renderer.setRenderTarget(null);
    this.renderUniforms.uPosition.value = this.posBuf.read.texture;
    this.renderUniforms.uVelocity.value = this.velBuf.read.texture;
    renderer.render(this.scene, this.camera);

    /* --- standstill detection ------------------------------------------
       Sleep only when the timelines are done, the pointer is quiet, AND the
       field itself has actually stopped. The probe is the part that matters:
       timeline completion means the uniforms arrived, not that the points
       did, and sleeping on the timeline alone freezes a half-formed frame. */
    const animating = (this.switchTl && this.switchTl.isActive()) ||
                      (this.openTl && this.openTl.isActive());
    const busy = moving || p.active === 1 || animating;

    if (this.settled && !busy) {
      // ~6 Hz is plenty; the probe costs a draw and a 4-byte readback.
      if (++this.probeTick % 10 === 0) {
        this.quad.material = this.probeMat;
        this.probeMat.uniforms.uVelocity.value = this.velBuf.read.texture;
        renderer.setRenderTarget(this.probeTarget);
        renderer.render(this.simScene, this.simCamera);
        renderer.readRenderTargetPixels(this.probeTarget, 0, 0, 1, 1, this.probePixel);
        renderer.setRenderTarget(null);

        // Byte 8 of 255 over the x4 scale is ~0.008 world units/sec: below
        // the point where any further movement is visible on screen.
        if (this.probePixel[0] < 8) {
          if (!this.idleSince) this.idleSince = now;
          else if (now - this.idleSince > SETTLE_MS) this.sleep();
        } else {
          this.idleSince = 0;
        }
      }
    } else {
      this.idleSince = 0;
    }
  };

  /* ------------------ teardown ------------------ */

  Gallery.prototype.dispose = function () {
    this.disposed = true;
    this.sleep();
    if (this.switchTl) this.switchTl.kill();
    if (this.openTl) this.openTl.kill();

    global.removeEventListener('resize', this._onResize);
    global.removeEventListener('pointermove', this._onPointer);
    global.removeEventListener('touchmove', this._onPointer);
    global.removeEventListener('pointerleave', this._onLeave);
    document.removeEventListener('visibilitychange', this._onVisibility);

    this.posBuf.dispose();
    this.velBuf.dispose();
    this.probeTarget.dispose();
    this.probeMat.dispose();
    this.baked.forEach(function (b) {
      if (!b) return;
      b.position.dispose();
      b.color.dispose();
    });
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.velocityMat.dispose();
    this.positionMat.dispose();
    this.quad.geometry.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  };

  /* ======================================================
     5 · Entry point
     ====================================================== */

  const ParticleGallery = {
    TIERS: TIERS,

    /**
     * @param {string|Element} target  host element for the canvas
     * @param {object} [options]
     * @param {Array}  [options.albums] defaults to window.PARTICLE_ALBUMS
     * @returns {Promise<Gallery>}
     */
    mount: function (target, options) {
      options = options || {};
      const host = typeof target === 'string' ? document.querySelector(target) : target;
      if (!host) return Promise.reject(new Error('particle-gallery: host not found'));
      if (typeof THREE === 'undefined') {
        return Promise.reject(new Error('particle-gallery: three.js not loaded'));
      }
      if (typeof gsap === 'undefined') {
        return Promise.reject(new Error('particle-gallery: gsap not loaded'));
      }

      const albums = options.albums || global.PARTICLE_ALBUMS;
      if (!albums || !albums.length) {
        return Promise.reject(new Error('particle-gallery: no albums'));
      }

      const gallery = new Gallery(host, albums, options);
      return gallery.init();
    },
  };

  global.ParticleGallery = ParticleGallery;
})(window);
