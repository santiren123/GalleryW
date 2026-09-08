/* ==========================================================
   行记 — Xinjiang (新疆) · flagship chapter
   Two things no other album does:
     1. a WebGL god-ray panorama, pinned and scroll-scrubbed
        (volumetric light scattering sampled toward the sun,
         plus a pointer-nudged light source)
     2. a continuous ground-colour shift — the site background
        lerps night-blue → glacier-teal across the chapter,
        instead of the binary dark toggle the other chapters use
   Only four frames live on the homepage; the album page holds
   the full set, so opening it still shows you something new.
   The GL loop only runs while the scene is on screen, and the
   whole file no-ops under prefers-reduced-motion.
   ========================================================== */

(function () {
  'use strict';

  if (!window.gsap || !document.getElementById('xinjiang')) return;

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOBILE = window.innerWidth < 821;

  /* ============================================================
     1 — GROUND COLOUR: high-altitude daylight, scrubbed
     These photographs are almost all bright clear-sky frames, so the chapter
     sits on a LIGHT ground — but a cool one, the mirror of the site's warm
     paper (#f3efe7 is red-led; this is blue-led at the same lightness). That
     keeps the flagship distinct from every other album without clashing.
     body paints `var(--bg)`, so driving that one property re-tints the page.
     ============================================================ */
  const GROUND_FROM = [238, 243, 247];  // #eef3f7 — pale daylight
  const GROUND_TO   = [227, 236, 243];  // #e3ecf3 — glacier tint, mid-chapter

  const section = document.getElementById('xinjiang');

  /* The chapter drives the ground itself rather than using the generic
     [data-theme-dark] handler in main.js. Its pinned scene adds scroll that
     the section's own box does not report, so `bottom 42%` resolved early and
     left the tail of the chapter stranded on the wrong ground. Anchoring the
     end to the next chapter is pin-proof. */
  ScrollTrigger.create({
    trigger: section, start: 'top 58%',
    endTrigger: '#japan', end: 'top 12%',
    // Refresh LAST. This trigger starts before the pinned scene, so it has to
    // be measured after that pin has re-applied its spacing — otherwise its
    // end lands short of #japan. Only THIS trigger gets a custom priority:
    // the pin must stay at the default so it keeps refreshing in document
    // order and picks up the spacing of the pins above it (panoPin, zoomPin).
    // Giving the pin a higher priority once moved it 4690px up the page,
    // landing this scene on top of Lijiang.
    refreshPriority: -1,
    invalidateOnRefresh: true,
    onUpdate: (self) => {
      // ease out and back so the tint peaks mid-chapter
      const t = Math.sin(Math.min(Math.max(self.progress, 0), 1) * Math.PI);
      const c = GROUND_FROM.map((f, i) => Math.round(f + (GROUND_TO[i] - f) * t));
      document.body.style.setProperty('--bg', `rgb(${c[0]},${c[1]},${c[2]})`);
    },
    onLeave: () => document.body.style.removeProperty('--bg'),
    onLeaveBack: () => document.body.style.removeProperty('--bg'),
  });

  /* ============================================================
     2 — WEBGL GOD-RAY PANORAMA
     ============================================================ */
  const pin = document.getElementById('xjPin');
  const canvas = document.getElementById('xjCanvas');

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  // Volumetric light scattering: march from the fragment toward the sun,
  // accumulating only the bright parts of the plate. Cheap, and it makes
  // the existing crepuscular rays in the photograph actually move.
  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uImage;
    uniform float uTime;
    uniform float uProgress;    // 0..1 scroll through the pinned scene
    uniform float uCanvasAsp;
    uniform float uImgAsp;
    uniform vec2  uPointer;     // -1..1, eased
    uniform float uReveal;      // 0..1 fade-in once the texture is up

    const int SAMPLES = 18;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // pan window across the panorama
    vec2 plate(vec2 uv) {
      float visible = clamp(uCanvasAsp / uImgAsp, 0.05, 1.0);
      float panMax = 1.0 - visible;
      float x0 = panMax * uProgress;
      return vec2(x0 + uv.x * visible, uv.y);
    }

    void main() {
      vec2 uv = vUv;

      // a slow breath so the frame is never completely static
      uv.y += sin(uv.x * 3.0 + uTime * 0.18) * 0.0022;

      vec2 p = plate(uv);
      vec3 col = texture2D(uImage, p).rgb;

      // sun sits just above the ridge in this frame; pointer nudges it
      vec2 sun = vec2(0.5 + uPointer.x * 0.045, 0.615 + uPointer.y * 0.03);
      vec2 sunPlate = plate(sun);

      // --- march toward the sun, gathering highlights ---
      vec2 delta = (sunPlate - p) / float(SAMPLES) * 0.92;
      vec2 samp = p;
      float illum = 1.0;
      vec3 rays = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        samp += delta;
        vec3 s = texture2D(uImage, samp).rgb;
        // keep only what is genuinely bright — that's the shafts and the disc
        float m = smoothstep(0.80, 1.0, luma(s));
        rays += s * m * illum;
        illum *= 0.92;
      }
      rays /= float(SAMPLES);

      // shimmer along the shafts so the light feels alive
      float flick = 0.86 + 0.14 * sin(uTime * 0.7 + p.x * 22.0);
      // fade the effect out toward the edges of the frame
      float falloff = smoothstep(1.05, 0.15, distance(uv, sun));
      // and hold it back right around the disc, so the sky keeps its detail
      float core = smoothstep(0.0, 0.34, distance(uv, sun));

      col += rays * 1.25 * flick * falloff * core;

      // gentle warm lift in the shafts, cool hold in the shadows
      col = mix(col, col * vec3(1.06, 1.01, 0.94), falloff * 0.5);

      // vignette + reveal
      vec2 vq = vUv - 0.5;
      col *= 1.0 - dot(vq, vq) * 0.5;
      col *= uReveal;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function initGL() {
    if (REDUCED || !pin || !canvas) return null;
    const gl = canvas.getContext('webgl', {
      antialias: false, alpha: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) return null;

    const prog = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = {
      image: gl.getUniformLocation(prog, 'uImage'),
      time: gl.getUniformLocation(prog, 'uTime'),
      progress: gl.getUniformLocation(prog, 'uProgress'),
      canvasAsp: gl.getUniformLocation(prog, 'uCanvasAsp'),
      imgAsp: gl.getUniformLocation(prog, 'uImgAsp'),
      pointer: gl.getUniformLocation(prog, 'uPointer'),
      reveal: gl.getUniformLocation(prog, 'uReveal'),
    };

    const state = {
      gl, u, progress: 0, ready: false,
      imgAsp: 7987 / 3423,
      pointer: { x: 0, y: 0 }, target: { x: 0, y: 0 },
      visible: false, raf: 0, start: 0,
    };

    // texture
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 1px placeholder until the plate decodes
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([8, 10, 16]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(u.image, 0);

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      state.imgAsp = img.naturalWidth / img.naturalHeight;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      state.ready = true;
      // Paint one frame straight away, even though the scene is still far
      // below the fold. The render loop is gated on visibility, so without
      // this the canvas would still be an empty (black) buffer when the
      // reader arrives — which read as the picture "flashing in".
      resize();
      draw(performance.now());
      pin.classList.add('is-gl');   // now safe to hide the <img> fallback
    };
    img.onerror = () => { state.ready = false; };
    img.src = 'assets/img/xj1.webp';

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 1 : 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
    }

    function draw(now) {
      if (!state.start) state.start = now;
      gl.uniform1f(u.time, (now - state.start) * 0.001);
      gl.uniform1f(u.progress, state.progress);
      gl.uniform1f(u.canvasAsp, canvas.width / canvas.height);
      gl.uniform1f(u.imgAsp, state.imgAsp);
      gl.uniform2f(u.pointer, state.pointer.x, state.pointer.y);
      gl.uniform1f(u.reveal, state.ready ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      if (!state.visible) { state.raf = 0; return; }
      resize();
      // ease the pointer so the light glides rather than snaps
      state.pointer.x += (state.target.x - state.pointer.x) * 0.06;
      state.pointer.y += (state.target.y - state.pointer.y) * 0.06;
      draw(now);
      state.raf = requestAnimationFrame(frame);
    }

    state.play = () => {
      if (state.raf || !state.visible) return;
      // keep uTime continuous — resetting it snaps the shimmer on re-entry
      state.raf = requestAnimationFrame(frame);
    };
    state.stop = () => { cancelAnimationFrame(state.raf); state.raf = 0; };

    // only burn frames while the scene is actually on screen
    new IntersectionObserver((entries) => {
      state.visible = entries[0].isIntersecting;
      if (state.visible) state.play(); else state.stop();
    }, { threshold: 0.01 }).observe(pin);

    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) state.stop(); else state.play();
    });
    window.addEventListener('mousemove', (e) => {
      state.target.x = (e.clientX / window.innerWidth) * 2 - 1;
      state.target.y = 1 - (e.clientY / window.innerHeight) * 2;
    }, { passive: true });

    return state;
  }

  const glScene = initGL();

  /* --- pin the panorama and scrub the pan (and the GL progress) --- */
  if (!REDUCED && pin) {
    gsap.set('#xjPinText', { opacity: 0, y: 34 });
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: '#xjPin', start: 'top top', end: '+=180%',
        pin: true, scrub: 0.6, anticipatePin: 1,
        onUpdate: (self) => { if (glScene) glScene.progress = self.progress; },
      },
    });
    tl.to('#xjPinText', { opacity: 1, y: 0, duration: 0.22 }, 0.08)
      .to('#xjPinText', { opacity: 0, y: -26, duration: 0.22 }, 0.72);

    // the still fallback pans too, for the no-WebGL case
    if (!glScene) {
      gsap.fromTo('#xjFallback',
        { objectPosition: '0% 50%' },
        {
          objectPosition: '100% 50%', ease: 'none',
          scrollTrigger: { trigger: '#xjPin', start: 'top top', end: '+=180%', scrub: 0.6 },
        });
    }
  } else if (pin) {
    gsap.set('#xjPinText', { opacity: 1 });
  }

  /* ============================================================
     3 — WARM THE PLATES
     The three full plates are lazy so they cost nothing on first paint, but
     they are large and shown whole, so a late decode is very visible. Fetch
     them as soon as the chapter edges into view — roughly two screens of
     warning before the reader reaches the first one.
     ============================================================ */
  ScrollTrigger.create({
    trigger: section, start: 'top bottom', once: true,
    onEnter: () => {
      section.querySelectorAll('.xj-plate img').forEach((im) => {
        im.loading = 'eager';
        if (!im.complete) { const pre = new Image(); pre.src = im.src; }
      });
    },
  });

  window.addEventListener('load', () => ScrollTrigger.refresh());
})();
