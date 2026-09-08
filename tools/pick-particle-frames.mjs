/* ==========================================================
   行记 — particle frame selector  (build-time, run once)

   Scores every photograph in the six album folders and elects
   the single frame per album that particle-ises best.

   "Best" is defined against the exhibition's aesthetic: a
   luminous, high-contrast subject with a legible silhouette
   floating on a dark, quiet ground. That is exactly the image
   class that survives being torn into 150k points and
   reassembled — a busy edge-to-edge landscape turns to mush.

   Decoding is done with macOS `sips` (webp -> 24bpp BMP), so
   the script has zero npm dependencies.

     node tools/pick-particle-frames.mjs
     node tools/pick-particle-frames.mjs --json   # scores for every candidate

   Writes js/particle-manifest.js
   ========================================================== */

import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* Album folders live in the curated (grouped) tree; the web server
   serves the flat assets/img/. We read grouping from the former and
   emit paths against the latter. */
const SOURCE_TREE = '/Users/william/Desktop/aliases/gallerywX/assets/img';
const WEB_DIR = 'assets/img';

const ALBUMS = [
  { id: 'datong',   folder: 'datong',   title: '大同',   latin: 'DATONG',   subtitle: '华严 · 木构重檐',   caption: 'Timber remembers patience.' },
  { id: 'japan',    folder: 'japan',    title: '日本',   latin: 'JAPAN',    subtitle: '京都 · 清水舞台',   caption: 'Light borrows the room.' },
  { id: 'lijiang',  folder: 'lijiang',  title: '丽江',   latin: 'LIJIANG',  subtitle: '玉龙 · 雪山之脊',   caption: 'Altitude keeps the colour.' },
  { id: 'qinghai',  folder: 'qinghai',  title: '青海',   latin: 'QINGHAI',  subtitle: '塔尔 · 高原经堂',   caption: 'A doorway holds the plateau.' },
  { id: 'xinjiang', folder: 'xinjiang', title: '新疆',   latin: 'XINJIANG', subtitle: '天山 · 林海云谷',   caption: 'Distance is the subject.' },
  { id: 'yiheyuan', folder: 'yiheyuan', title: '颐和园', latin: 'YIHEYUAN', subtitle: '万寿 · 佛香阁下',   caption: 'Empire, kept as a garden.' },
];

const SAMPLE = 128; // analysis resolution (long edge)

/* ---------- 24bpp BMP reader ------------------------------------------ */

function decodeBMP(buf) {
  const offset = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  const rawH = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24) throw new Error(`expected 24bpp, got ${bpp}`);

  const h = Math.abs(rawH);
  const topDown = rawH < 0;
  const stride = ((w * 3 + 3) >> 2) << 2; // rows pad to 4 bytes
  const lum = new Float32Array(w * h);
  const sat = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const srcY = topDown ? y : h - 1 - y;
    let p = offset + srcY * stride;
    for (let x = 0; x < w; x++, p += 3) {
      const b = buf[p] / 255, g = buf[p + 1] / 255, r = buf[p + 2] / 255;
      const i = y * w + x;
      lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat[i] = mx > 1e-4 ? (mx - mn) / mx : 0;
    }
  }
  return { w, h, lum, sat };
}

/* ---------- metrics ---------------------------------------------------- */

/** Sobel magnitude per pixel — how much drawable structure exists. */
function sobel({ w, h, lum }) {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = lum[i - w - 1], t = lum[i - w], tr = lum[i - w + 1];
      const l = lum[i - 1], r = lum[i + 1];
      const bl = lum[i + w - 1], b = lum[i + w], br = lum[i + w + 1];
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      mag[i] = Math.hypot(gx, gy) * 0.25;
    }
  }
  return mag;
}

function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) { const d = arr[i] - m; s += d * d; }
  return Math.sqrt(s / arr.length);
}

/** Fraction of luminance mass in the darkest fifth — the "black ground" tell. */
function darkFloor(lum) {
  let n = 0;
  for (let i = 0; i < lum.length; i++) if (lum[i] < 0.2) n++;
  return n / lum.length;
}

/** Mean over the outer 18% ring. Dark, calm borders frame a subject. */
function borderMean(arr, w, h) {
  const bx = Math.max(1, Math.round(w * 0.18));
  const by = Math.max(1, Math.round(h * 0.18));
  let s = 0, n = 0;
  for (let y = 0; y < h; y++) {
    const edgeRow = y < by || y >= h - by;
    for (let x = 0; x < w; x++) {
      if (edgeRow || x < bx || x >= w - bx) { s += arr[y * w + x]; n++; }
    }
  }
  return n ? s / n : 0;
}

/** Mean over the central 55% box — where a subject should sit. */
function centerMean(arr, w, h) {
  const x0 = Math.round(w * 0.225), x1 = Math.round(w * 0.775);
  const y0 = Math.round(h * 0.225), y1 = Math.round(h * 0.775);
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) { s += arr[y * w + x]; n++; }
  }
  return n ? s / n : 0;
}

function scoreImage(img) {
  const { w, h, lum, sat } = img;
  const edge = sobel(img);

  const contrast = stddev(lum);                    // tonal spread
  const structure = mean(edge);                    // overall detail
  const eCenter = centerMean(edge, w, h);
  const eBorder = borderMean(edge, w, h);
  const lBorder = borderMean(lum, w, h);
  const dark = darkFloor(lum);
  const saturation = mean(sat);

  /* Subject isolation: detail concentrated centrally, over a quiet border.
     This is the single strongest predictor of a good particle morph. */
  const isolation = eCenter / (eBorder + eCenter + 1e-5);

  /* Ground calm: dark, low-detail surround reads as negative space. */
  const groundCalm = (1 - lBorder) * 0.55 + dark * 0.45;

  /* Aspect penalty — panoramas waste the square particle field. */
  const aspect = w / h;
  const ratio = aspect > 1 ? aspect : 1 / aspect;
  const aspectFit = ratio > 2.4 ? 0.25 : ratio > 1.9 ? 0.6 : ratio > 1.6 ? 0.9 : 1;

  /* Structure has a sweet spot: too little is an empty frame, too much is
     noise that collapses into grey mush once pointised. */
  const structureFit = Math.exp(-Math.pow((structure - 0.115) / 0.085, 2));

  const score =
    isolation * 0.30 +
    groundCalm * 0.22 +
    contrast * 0.20 +
    structureFit * 0.18 +
    Math.min(saturation, 0.5) * 2 * 0.10;

  return {
    score: score * aspectFit,
    parts: {
      isolation: +isolation.toFixed(4),
      groundCalm: +groundCalm.toFixed(4),
      contrast: +contrast.toFixed(4),
      structure: +structure.toFixed(4),
      structureFit: +structureFit.toFixed(4),
      saturation: +saturation.toFixed(4),
      aspectFit,
      aspect: +aspect.toFixed(3),
    },
  };
}

/* ---------- driver ------------------------------------------------------ */

async function analyse(file, scratch) {
  const bmp = join(scratch, basename(file, extname(file)) + '.bmp');
  await run('sips', ['-s', 'format', 'bmp', '-Z', String(SAMPLE), file, '--out', bmp]);
  const img = decodeBMP(await readFile(bmp));
  return scoreImage(img);
}

async function main() {
  const verbose = process.argv.includes('--json');
  const scratch = await mkdtemp(join(tmpdir(), 'pfx-'));
  const chosen = [];
  const report = {};

  try {
    for (const album of ALBUMS) {
      const dir = join(SOURCE_TREE, album.folder);
      const files = (await readdir(dir))
        .filter((f) => /\.(webp|jpe?g|png)$/i.test(f))
        .sort();

      const ranked = [];
      for (const f of files) {
        try {
          const { score, parts } = await analyse(join(dir, f), scratch);
          /* Only frames that also exist in the flat web directory are eligible. */
          const served = existsSync(join(ROOT, WEB_DIR, f));
          ranked.push({ file: f, score, served, parts });
        } catch (err) {
          console.warn(`  ! skipped ${f}: ${err.message}`);
        }
      }

      ranked.sort((a, b) => b.score - a.score);
      report[album.id] = ranked;

      const win = ranked.find((r) => r.served) || ranked[0];
      if (!win) throw new Error(`no usable image in ${dir}`);

      chosen.push({ ...album, file: win.file, score: win.score });

      console.log(`${album.latin.padEnd(9)} -> ${win.file.padEnd(18)} ${win.score.toFixed(4)}`);
      for (const r of ranked.slice(0, 4)) {
        if (r.file === win.file) continue;
        console.log(`  ${' '.repeat(9)}    ${r.file.padEnd(18)} ${r.score.toFixed(4)}${r.served ? '' : '  (not served)'}`);
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  if (verbose) {
    await writeFile(
      join(ROOT, 'tools/particle-frame-scores.json'),
      JSON.stringify(report, null, 2)
    );
    console.log('\nwrote tools/particle-frame-scores.json');
  }

  const entries = chosen.map((c) => `  {
    id: '${c.id}',
    title: '${c.title}',
    latin: '${c.latin}',
    subtitle: '${c.subtitle}',
    caption: '${c.caption}',
    src: '${WEB_DIR}/${c.file}',
  },`).join('\n');

  const out = `/* ==========================================================
   行记 — particle exhibit manifest   [GENERATED FILE]

   Produced by tools/pick-particle-frames.mjs. Each entry is the
   highest-scoring frame in its album for particle reconstruction.
   Re-run the script to regenerate; hand edits will be overwritten.
   ========================================================== */

window.PARTICLE_ALBUMS = [
${entries}
];
`;

  await writeFile(join(ROOT, 'js/particle-manifest.js'), out);
  console.log('\nwrote js/particle-manifest.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
