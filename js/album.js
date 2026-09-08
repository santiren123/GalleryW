/* ==========================================================
   行记 — album page
   Renders one album from the manifest in js/albums.js
   ========================================================== */
(function () {
  'use strict';

  gsap.registerPlugin(ScrollTrigger);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOBILE = window.innerWidth < 821;

  /* ---------- resolve album ---------- */
  const slug = new URLSearchParams(location.search).get('a');
  const album = window.ALBUMS[slug] || window.ALBUMS[window.ALBUM_ORDER[0]];
  const key = window.ALBUMS[slug] ? slug : window.ALBUM_ORDER[0];

  document.title = `WPHOT — ${album.title} · ${album.cn}`;
  if (album.dark) document.body.classList.add('theme-dark');
  // lets an album carry its own paper colour (see body.album-xinjiang)
  document.body.classList.add('album-' + key);

  /* ---------- head ---------- */
  document.getElementById('albumNo').textContent = `album ${album.no} · ${album.photos.length} photographs`;
  document.getElementById('albumCn').textContent = album.cn;
  document.getElementById('albumTitle').textContent = album.title;
  document.getElementById('albumSub').textContent = album.sub;
  document.getElementById('albumCount').textContent = `${album.photos.length} photographs · scroll`;

  const next = window.ALBUM_ORDER[(window.ALBUM_ORDER.indexOf(key) + 1) % window.ALBUM_ORDER.length];
  const nextAlbum = window.ALBUMS[next];
  const nextLink = document.getElementById('nextLink');
  nextLink.href = `album.html?a=${next}`;
  nextLink.innerHTML = `next album — <span lang="zh">${nextAlbum.cn}</span> <b>${nextAlbum.title}</b> →`;

  /* ---------- grid ---------- */
  const grid = document.getElementById('albumGrid');
  const frag = document.createDocumentFragment();
  album.photos.forEach((p, i) => {
    const fig = document.createElement('figure');
    fig.className = `ph al-${p.l}`;
    fig.dataset.cursor = 'view';
    if (p.l === 'std' || p.l === 'tall') fig.dataset.speed = (i % 2 ? -0.08 : 0.08).toString();
    fig.innerHTML = `
      <div class="ph-frame${p.l === 'full' ? ' deep' : ''}">
        <img src="${p.src}" alt="${p.cap.replace(/"/g, '&quot;')}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async"${p.l === 'full' ? ' data-deep' : ''}>
      </div>
      <figcaption><span>№${String(i + 1).padStart(2, '0')}</span>${p.cap}</figcaption>`;
    frag.appendChild(fig);
  });
  grid.appendChild(frag);

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (!REDUCED) {
    lenis = new Lenis({ duration: 1.25, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  /* ---------- progress ---------- */
  gsap.to('#progressBar', {
    scaleX: 1, ease: 'none',
    scrollTrigger: { trigger: document.body, start: 'top top', end: 'max', scrub: 0.4 },
  });

  /* ---------- head intro ---------- */
  if (!REDUCED) {
    gsap.from('.album-head > *', { y: 40, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.09, delay: 0.15 });
  }

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

  /* ---------- reveals + parallax ---------- */
  if (!REDUCED) {
    document.querySelectorAll('.ph .ph-frame').forEach((frame) => {
      const img = frame.querySelector('img');
      gsap.set(frame, { clipPath: 'inset(100% 0% 0% 0%)' });
      gsap.set(img, { scale: 1.32 });
      ScrollTrigger.create({
        trigger: frame, start: 'top 88%', once: true,
        onEnter: () => {
          gsap.to(frame, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.35, ease: 'expo.inOut' });
          gsap.to(img, { scale: 1, duration: 1.8, ease: 'expo.out', delay: 0.1 });
        },
      });
    });
    document.querySelectorAll('.ph-frame.deep img').forEach((img) => {
      gsap.fromTo(img, { yPercent: -11 }, {
        yPercent: 0, ease: 'none',
        scrollTrigger: { trigger: img.closest('.ph-frame'), start: 'top bottom', end: 'bottom top', scrub: true },
      });
    });
    const PX = MOBILE ? 0.5 : 1;
    document.querySelectorAll('[data-speed]').forEach((el) => {
      const speed = parseFloat(el.dataset.speed) * PX;
      gsap.fromTo(el, { y: speed * 220 }, {
        y: speed * -220, ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
      });
    });
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

  grid.addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (!img) return;
    const cap = img.closest('figure')?.querySelector('figcaption')?.textContent.trim() || '';
    openLightbox(img, cap);
  });
  lbVeil.addEventListener('click', closeLightbox);
  lbClose.addEventListener('click', closeLightbox);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

  window.addEventListener('load', () => ScrollTrigger.refresh());
})();
