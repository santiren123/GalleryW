/* ==========================================================
   行记 — scroll choreography
   ========================================================== */
(function () {
  'use strict';

  gsap.registerPlugin(ScrollTrigger);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TOUCH = window.matchMedia('(pointer: coarse)').matches;
  const MOBILE = window.innerWidth < 821;
  const PX = MOBILE ? 0.55 : 1; // parallax scale factor

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (!REDUCED) {
    lenis = new Lenis({ duration: 1.25, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  function scrollToTarget(target) {
    if (lenis) lenis.scrollTo(target, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
    else document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- text splitting ---------- */
  function splitWords(el, perChar) {
    const walk = (node) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          const tokens = child.textContent.split(/(\s+)/);
          tokens.forEach((tok) => {
            if (!tok) return;
            if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(' ')); return; }
            // CJK: every char becomes its own word
            const chunks = perChar === 'cjk' ? [...tok] : [tok];
            chunks.forEach((chunk) => {
              const w = document.createElement('span');
              w.className = 'word';
              if (perChar === true) {
                [...chunk].forEach((c) => {
                  const i = document.createElement('i');
                  i.textContent = c;
                  w.appendChild(i);
                });
              } else {
                const i = document.createElement('i');
                i.textContent = chunk;
                w.appendChild(i);
              }
              frag.appendChild(w);
            });
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR' && !child.classList.contains('word')) {
          walk(child);
        }
      });
    };
    walk(el);
    return el.querySelectorAll('.word > i');
  }

  /* ---------- preloader + hero intro ---------- */
  const heroCanvas = document.getElementById('heroCanvas');
  const heroPromise = (window.createHeroGL && !REDUCED)
    ? window.createHeroGL(heroCanvas, 'assets/img/liuli.webp')
    : Promise.resolve(null);
  let heroState = null;

  // fallback: static hero image if WebGL unavailable
  function heroFallback() {
    heroCanvas.style.display = 'none';
    const hero = document.getElementById('hero');
    hero.style.background = 'url(assets/img/chaka1.webp) center/cover no-repeat #0c0a08';
  }

  let FIRST_VISIT = true;
  try { FIRST_VISIT = !sessionStorage.getItem('wp_visited'); sessionStorage.setItem('wp_visited', '1'); } catch (e) {}
  /* The loading animation now plays on every visit, so the preloader always
     covers the page during setup and there's no flash when returning from a
     sub-page. On a revisit it simply runs at double speed. */
  const SPEED = FIRST_VISIT ? 1 : 2;

  const counter = { v: 0 };
  const numEl = document.getElementById('preloaderNum');
  const charEl = document.getElementById('preloaderChar');
  const chars = ['山', '水', '城', '海','爱','永恒'];
  let charIdx = 0;

  const charTimer = setInterval(() => {
    charIdx = (charIdx + 1) % chars.length;
    charEl.textContent = chars[charIdx];
  }, 360 / SPEED);

  const countTween = gsap.to(counter, {
    v: 100, duration: 2.1 / SPEED, ease: 'power2.inOut',
    onUpdate: () => { numEl.textContent = String(Math.round(counter.v)).padStart(2, '0'); },
  });

  const heroChars = gsap.utils.toArray('[data-hero-char]');
  const heroWords = gsap.utils.toArray('[data-hero-word]');
  const heroFades = gsap.utils.toArray('[data-hero-fade]');
  gsap.set(heroChars, { yPercent: 55, opacity: 0, rotate: 4 });
  gsap.set(heroWords, { yPercent: 120 });
  gsap.set(heroFades, { opacity: 0, y: 24 });

  Promise.all([heroPromise, countTween]).then(([state]) => {
    heroState = state;
    if (!state && !REDUCED) heroFallback();
    if (REDUCED) heroFallback();
    clearInterval(charTimer);

    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.timeScale(SPEED);   // revisits replay the very same intro at 2× speed
    tl.to('.preloader-inner', { opacity: 0, y: -30, duration: 0.55, ease: 'power2.in' })
      .to('#preloader', { yPercent: -100, duration: 1.05, ease: 'expo.inOut' }, '-=0.1')
      .set('#preloader', { display: 'none' })
      .add(() => { document.body.classList.add('theme-anim'); }, '<');

    if (state) tl.to(state, { reveal: 1, duration: 2.2, ease: 'power2.out' }, '-=1.0');
    tl.to(heroChars, { yPercent: 0, opacity: 1, rotate: 0, duration: 1.4, stagger: 0.12 }, '-=1.7')
      .to(heroWords, { yPercent: 0, duration: 1.2, stagger: 0.07 }, '-=1.1')
      .to(heroFades, { opacity: 1, y: 0, duration: 1, stagger: 0.12 }, '-=0.9');
  });

  /* ---------- hero scroll-out + webgl feed ---------- */
  if (!REDUCED) {
    gsap.to('.hero-content', {
      y: -120, opacity: 0, ease: 'none',
      scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom 35%', scrub: true },
    });
    ScrollTrigger.create({
      trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true,
      onUpdate: (self) => { if (heroState) heroState.parallax = self.progress; },
    });
    if (lenis) {
      lenis.on('scroll', (e) => {
        if (heroState) heroState.scrollVel = gsap.utils.clamp(-1, 1, e.velocity / 90);
      });
    }
  }

  /* ---------- progress bar ---------- */
  gsap.to('#progressBar', {
    scaleX: 1, ease: 'none',
    scrollTrigger: { trigger: document.body, start: 'top top', end: 'max', scrub: 0.4 },
  });

  /* ---------- cursor ---------- */
  const cursor = document.getElementById('cursor');
  if (window.matchMedia('(pointer: fine)').matches) {
    const dot = cursor.querySelector('.cursor-dot');
    const ring = cursor.querySelector('.cursor-ring');
    const label = cursor.querySelector('.cursor-label');
    const dotX = gsap.quickTo(dot, 'x', { duration: 0.12, ease: 'power2.out' });
    const dotY = gsap.quickTo(dot, 'y', { duration: 0.12, ease: 'power2.out' });
    const ringX = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3.out' });
    const ringY = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3.out' });
    window.addEventListener('mousemove', (e) => {
      dotX(e.clientX); dotY(e.clientY); ringX(e.clientX); ringY(e.clientY);
    }, { passive: true });
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-cursor], a, button');
      if (t) {
        cursor.classList.add('is-view');
        label.textContent = t.dataset.cursor === 'view' ? 'view' : '';
      } else {
        cursor.classList.remove('is-view');
      }
    });
  }

  /* ---------- menu ---------- */
  const menu = document.getElementById('menu');
  const menuBtn = document.getElementById('menuBtn');
  const menuWord = menuBtn.querySelector('.menu-btn-word');
  const menuLinks = gsap.utils.toArray('.menu-list a');
  const menuPreviewImg = document.getElementById('menuPreviewImg');
  let menuOpen = false;
  gsap.set(menuLinks, { yPercent: 110 });

  const menuTl = gsap.timeline({ paused: true })
    .set(menu, { visibility: 'visible' })
    .to('.menu-bg', { y: '0%', duration: 0.85, ease: 'expo.inOut' })
    .to(menuLinks, { yPercent: 0, duration: 0.9, stagger: 0.055, ease: 'expo.out' }, '-=0.35')
    .fromTo('.menu-foot', { opacity: 0 }, { opacity: 1, duration: 0.5 }, '-=0.5');
  gsap.set('.menu-bg', { y: '-101%' });

  function toggleMenu(force) {
    menuOpen = typeof force === 'boolean' ? force : !menuOpen;
    document.body.classList.toggle('menu-open', menuOpen);
    menu.classList.toggle('is-open', menuOpen);
    menuBtn.setAttribute('aria-expanded', menuOpen);
    menu.setAttribute('aria-hidden', !menuOpen);
    menuWord.textContent = menuOpen ? menuWord.dataset.close : menuWord.dataset.open;
    if (menuOpen) {
      menuTl.timeScale(1).play();
      if (lenis) lenis.stop();
    } else {
      gsap.to('#menuPreview', { opacity: 0, duration: 0.2, overwrite: true });
      menuTl.timeScale(1.6).reverse().eventCallback('onReverseComplete', () => {
        menu.style.visibility = '';
      });
      if (lenis) lenis.start();
    }
  }
  menuBtn.addEventListener('click', () => toggleMenu());

  menuLinks.forEach((a) => {
    a.addEventListener('mouseenter', () => {
      if (!menuPreviewImg) return;
      menuPreviewImg.src = a.dataset.preview;
      gsap.to('#menuPreview', { opacity: 1, duration: 0.4 });
      gsap.fromTo(menuPreviewImg, { scale: 1.15 }, { scale: 1, duration: 0.7, ease: 'power2.out' });
    });
    a.addEventListener('mouseleave', () => gsap.to('#menuPreview', { opacity: 0, duration: 0.3 }));
  });

  document.querySelectorAll('[data-scrollto]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const go = () => scrollToTarget(a.dataset.scrollto);
      if (menuOpen) { toggleMenu(false); setTimeout(go, 450); } else go();
    });
  });

  /* ---------- generic text reveals ---------- */
  document.querySelectorAll('[data-anim]').forEach((el) => {
    const kind = el.dataset.anim;
    if (REDUCED) return;

    if (kind === 'chars' || kind === 'chars-cn') {
      const targets = splitWords(el, kind === 'chars-cn' ? 'cjk' : true);
      gsap.set(targets, { yPercent: 115 });
      gsap.to(targets, {
        yPercent: 0, duration: 1.1, ease: 'expo.out',
        stagger: { each: 0.018, from: 'start' },
        scrollTrigger: { trigger: el, start: 'top 84%', once: true },
      });
    } else if (kind === 'words') {
      const targets = splitWords(el, false);
      gsap.set(targets, { yPercent: 110 });
      gsap.to(targets, {
        yPercent: 0, duration: 1.15, ease: 'expo.out', stagger: 0.028,
        scrollTrigger: { trigger: el, start: 'top 82%', once: true },
      });
    } else {
      gsap.fromTo(el, { opacity: 0, y: 28 }, {
        opacity: 1, y: 0, duration: 1.1, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      });
    }
  });

  /* ---------- keep trigger positions honest ----------
     Every frame on the page reserves its box up front, so a lazy image landing
     should not move anything. This is the safety net for the case where one
     slips through: a late size change shifts everything below it, and pinned
     scenes would then fire at the wrong scroll position. Debounced so a burst
     of images costs a single recalculation. */
  {
    let pending;
    const resync = () => { clearTimeout(pending); pending = setTimeout(() => ScrollTrigger.refresh(), 250); };
    document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
      if (img.complete) return;
      img.addEventListener('load', resync, { once: true });
    });
  }

  /* ---------- figure reveals ---------- */
  if (!REDUCED) {
    document.querySelectorAll('.ph .ph-frame, .about-photo .ph-frame').forEach((frame) => {
      const img = frame.querySelector('img');
      gsap.set(frame, { clipPath: 'inset(100% 0% 0% 0%)' });
      gsap.set(img, { scale: 1.32 });
      ScrollTrigger.create({
        trigger: frame, start: 'top 88%', once: true,
        onEnter: () => {
          gsap.to(frame, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.35, ease: 'expo.inOut' });
          gsap.to(img, { scale: img.hasAttribute('data-deep') ? 1.0 : 1, duration: 1.8, ease: 'expo.out', delay: 0.1 });
        },
      });
    });

    /* deep parallax inside full-bleed frames */
    document.querySelectorAll('.ph-frame.deep img').forEach((img) => {
      gsap.fromTo(img, { yPercent: -11 }, {
        yPercent: 0, ease: 'none',
        scrollTrigger: { trigger: img.closest('.ph-frame'), start: 'top bottom', end: 'bottom top', scrub: true },
      });
    });

    /* element parallax */
    document.querySelectorAll('[data-speed]').forEach((el) => {
      const speed = parseFloat(el.dataset.speed) * PX;
      gsap.fromTo(el, { y: speed * 220 }, {
        y: speed * -220, ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
      });
    });
  }

  /* ---------- panorama pan (Qinghai) ---------- */
  const panoImg = document.getElementById('panoImg');
  if (!REDUCED && panoImg) {
    const setupPano = () => {
      const dist = () => Math.max(panoImg.scrollWidth - window.innerWidth, 0);
      gsap.to('.pano-track', {
        x: () => -dist(), ease: 'none',
        scrollTrigger: {
          trigger: '#panoPin', start: 'top top',
          end: () => '+=' + gsap.utils.clamp(window.innerHeight, window.innerHeight * 3, dist() * (MOBILE ? 1.1 : 0.85)),
          pin: true, scrub: 0.6, invalidateOnRefresh: true, anticipatePin: 1,
        },
      });
    };
    if (panoImg.complete) setupPano();
    else panoImg.addEventListener('load', () => { setupPano(); ScrollTrigger.refresh(); });
  }

  /* ---------- zoom reveal (Lijiang) ---------- */
  if (!REDUCED) {
    const zoomTl = gsap.timeline({
      scrollTrigger: {
        trigger: '#zoomPin', start: 'top top', end: '+=170%',
        pin: true, scrub: 0.6, anticipatePin: 1,
      },
    });
    zoomTl.to('#zoomFrame', { width: '100vw', height: '100vh', ease: 'power1.inOut', duration: 1 })
      .to('#zoomFrame img', { scale: 1, ease: 'none', duration: 1 }, 0)
      .to('#zoomText', { opacity: 0, scale: 0.92, duration: 0.25 }, 0.75);
  } else {
    gsap.set('#zoomFrame', { width: '100vw', height: '100vh' });
  }

  /* ---------- velocity skew ---------- */
  if (!REDUCED && !TOUCH) {
    const skewTargets = document.querySelectorAll('.skewy .ph-frame');
    if (skewTargets.length) {
      const proxy = { skew: 0 };
      const setters = [...skewTargets].map((t) => gsap.quickSetter(t, 'skewY', 'deg'));
      const clamp = gsap.utils.clamp(-4.5, 4.5);
      ScrollTrigger.create({
        onUpdate: (self) => {
          const skew = clamp(self.getVelocity() / -450);
          if (Math.abs(skew) > Math.abs(proxy.skew)) {
            proxy.skew = skew;
            gsap.to(proxy, {
              skew: 0, duration: 0.9, ease: 'power3.out', overwrite: true,
              onUpdate: () => setters.forEach((s) => s(proxy.skew)),
            });
          }
        },
      });
    }
  }

  /* ---------- theme switching ---------- */
  document.querySelectorAll('[data-theme-dark]').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec, start: 'top 58%',
      // the footer is the last element — keep the dark theme to the very bottom
      end: sec.id === 'end' ? '+=100000' : 'bottom 42%',
      onToggle: (self) => document.body.classList.toggle('theme-dark', self.isActive),
    });
  });

  /* ---------- marquee ---------- */
  const marqueeTrack = document.querySelector('#marquee1 .marquee-track');
  if (marqueeTrack && !REDUCED) {
    const loop = gsap.to(marqueeTrack, { xPercent: -50, repeat: -1, duration: 26, ease: 'none' });
    ScrollTrigger.create({
      onUpdate: (self) => {
        const v = gsap.utils.clamp(-4, 4, 1 + Math.abs(self.getVelocity()) / 350);
        gsap.to(loop, { timeScale: self.direction * v, duration: 0.4, overwrite: true });
      },
    });
  }

  /* ---------- aperture reveal (Fuji) ---------- */
  if (!REDUCED) {
    const apTl = gsap.timeline({
      scrollTrigger: {
        trigger: '#aperturePin', start: 'top top', end: '+=190%',
        pin: true, scrub: 0.6, anticipatePin: 1,
      },
    });
    // 4 explicit components on both ends: the browser collapses the inset()
    // shorthand in computed style, which desyncs gsap's string interpolation
    const startInset = MOBILE ? 'inset(34% 22% 34% 22%)' : 'inset(38% 34% 38% 34%)';
    gsap.set('#apertureText', { opacity: 0, y: 50 });
    apTl.fromTo('#apertureFrame', { clipPath: startInset }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'power1.inOut', duration: 1, immediateRender: true })
      .to('#apertureFrame img', { scale: 1, ease: 'none', duration: 1 }, 0)
      .to('#apertureText', { opacity: 1, y: 0, duration: 0.3 }, 0.62);
  } else {
    gsap.set('#apertureFrame', { clipPath: 'inset(0% 0% 0% 0%)' });
    gsap.set('#apertureText', { opacity: 1 });
  }

  /* ---------- datong shadow → sky reveal ---------- */
  if (document.getElementById('datongPin')) {
    if (!REDUCED) {
      const dTl = gsap.timeline({
        scrollTrigger: {
          trigger: '#datongPin', start: 'top top', end: '+=185%',
          pin: true, scrub: 0.6, anticipatePin: 1,
        },
      });
      gsap.set('#datongPinText', { opacity: 0, y: 28 });
      // the dark temple layer wipes upward, uncovering the bright dusk plain beneath
      dTl.fromTo('#datongShadow', { clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: 'inset(100% 0% 0% 0%)', ease: 'power1.inOut', duration: 1, immediateRender: true })
        .fromTo('#datongShadow img', { scale: 1.14 }, { scale: 1.34, ease: 'none', duration: 1 }, 0)
        .fromTo('#datongSky', { scale: 1.28 }, { scale: 1, ease: 'none', duration: 1 }, 0)
        .to('#datongPinText', { opacity: 1, y: 0, duration: 0.28 }, 0.12)
        .to('#datongPinText', { opacity: 0, y: -22, duration: 0.24 }, 0.74);
    } else {
      gsap.set('#datongShadow', { clipPath: 'inset(0% 0% 0% 0%)' });
    }
  }

  /* ---------- lightbox ---------- */
  const lightbox = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightboxImg');
  const lbVeil = document.getElementById('lightboxVeil');
  const lbCap = document.getElementById('lightboxCap');
  const lbClose = document.getElementById('lightboxClose');
  let lbOpen = false;

  function openLightbox(img, caption) {
    if (lbOpen) return;
    lbOpen = true;
    const rect = img.getBoundingClientRect();
    lbImg.src = img.currentSrc || img.src;
    lbCap.textContent = caption || '';
    lightbox.classList.add('is-open');
    if (lenis) lenis.stop();

    const natW = img.naturalWidth || rect.width;
    const natH = img.naturalHeight || rect.height;
    const margin = Math.min(window.innerWidth, window.innerHeight) * 0.06;
    const maxW = window.innerWidth - margin * 2;
    const maxH = window.innerHeight - margin * 2 - 40;
    const ratio = Math.min(maxW / natW, maxH / natH);
    const tw = natW * ratio, th = natH * ratio;
    const tx = (window.innerWidth - tw) / 2, ty = (window.innerHeight - th - 30) / 2;

    gsap.set(lbImg, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    gsap.to(lbVeil, { opacity: 1, duration: 0.45, ease: 'power2.out' });
    gsap.to(lbImg, { left: tx, top: ty, width: tw, height: th, duration: 0.75, ease: 'expo.inOut' });
    gsap.to([lbCap, lbClose], { opacity: 1, duration: 0.4, delay: 0.4 });
  }

  function closeLightbox() {
    if (!lbOpen) return;
    lbOpen = false;
    gsap.to([lbCap, lbClose], { opacity: 0, duration: 0.2 });
    gsap.to(lbImg, { opacity: 0, scale: 0.96, duration: 0.4, ease: 'power2.in' });
    gsap.to(lbVeil, {
      opacity: 0, duration: 0.5, delay: 0.1,
      onComplete: () => {
        lightbox.classList.remove('is-open');
        gsap.set(lbImg, { opacity: 1, scale: 1 });
        if (lenis) lenis.start();
      },
    });
  }

  document.querySelectorAll('.ph[data-cursor="view"] img, .about-photo img').forEach((img) => {
    img.addEventListener('click', () => {
      const fig = img.closest('figure');
      const cap = fig ? fig.querySelector('figcaption')?.textContent.trim() : '';
      openLightbox(img, cap);
    });
  });
  lbVeil.addEventListener('click', closeLightbox);
  lbClose.addEventListener('click', closeLightbox);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeLightbox(); if (menuOpen) toggleMenu(false); } });

  /* ---------- the end ---------- */
  if (!REDUCED) {
    gsap.fromTo('#endImg', { scale: 0.6, opacity: 0.25 }, {
      scale: 1, opacity: 1, ease: 'none',
      scrollTrigger: { trigger: '#end', start: 'top 85%', end: 'top 15%', scrub: 0.5 },
    });
  }
  document.getElementById('backTop').addEventListener('click', () => scrollToTarget('#top'));

  /* ---------- refresh after everything loads ---------- */
  // triggers are created out of document order (pins after theme switches),
  // so re-sort the refresh order before recalculating positions
  ScrollTrigger.sort();
  window.addEventListener('load', () => { ScrollTrigger.sort(); ScrollTrigger.refresh(); });
})();
