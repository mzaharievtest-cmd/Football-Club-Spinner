#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');

const ROOT = process.cwd();
const TEAMS_PATH = path.resolve(ROOT, 'teams.json');
const OUT_PATH = path.resolve(ROOT, 'data', 'logo-text-masks.json');

function exists(p) { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } }
function readJSON(p, fallback = {}) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }

async function detectForLogo(absPath) {
  // Run OCR; we only need bounding boxes, not the text itself
  const workerOpts = { logger: null }; // set to console.log for debugging
  const res = await Tesseract.recognize(absPath, 'eng', workerOpts);
  const words = res?.data?.words || [];
  // Filter small/very low-confidence boxes; tune these thresholds as needed
  const MIN_H = 10;      // px in source image
  const MIN_W = 10;      // px in source image
  const MIN_CONF = 60;   // 0..100
  const boxes = [];
  for (const w of words) {
    const b = w?.bbox;
    const conf = Number(w?.confidence ?? 0);
    if (!b) continue;
    const bw = Math.max(0, (b.x1 ?? 0) - (b.x0 ?? 0));
    const bh = Math.max(0, (b.y1 ?? 0) - (b.y0 ?? 0));
    if (conf < MIN_CONF) continue;
    if (bw < MIN_W || bh < MIN_H) continue;
    boxes.push({ x: b.x0, y: b.y0, w: bw, h: bh, conf });
  }
  return boxes;
}

async function main() {
  if (!exists(TEAMS_PATH)) {
    console.error('ERROR: teams.json not found at repo root.');
    process.exit(2);
  }
  const teams = readJSON(TEAMS_PATH, []);
  if (!Array.isArray(teams)) {
    console.error('ERROR: teams.json must be an array.');
    process.exit(2);
  }

  // Unique logo_url values present in teams.json
  const logos = Array.from(new Set(teams.map(t => t.logo_url).filter(Boolean)));
  const current = readJSON(OUT_PATH, {}); // { "relative/logo/path.png": [ {xN,yN,wN,hN}, ... ] }

  let processed = 0, skipped = 0, updated = 0, failed = 0;

  for (const rel of logos) {
    const abs = path.resolve(ROOT, rel);
    if (!exists(abs)) { failed++; continue; }

    // Skip if already present (idempotent). Delete this guard if you prefer re-detect each run.
    if (current[rel] && Array.isArray(current[rel]) && current[rel].length) { skipped++; continue; }

    try {
      const boxes = await detectForLogo(abs);
      if (boxes.length) {
        // Normalize to 0..1 coordinates
        // Read dimensions using a lightweight probe (no external deps): use ImageData via sharp is ideal, but to avoid deps,
        // we will rely on tesseract's imageSize if available; else assume relative from bbox + page dimensions.
        // Tesseract result sometimes includes image size:
        const iw = resSafe(res => res.data?.image?.width) || resSafe(res => res.data?.textlines?.[0]?.baseline?.x1) || 0;
        const ih = resSafe(res => res.data?.image?.height) || resSafe(res => res.data?.textlines?.[0]?.baseline?.y1) || 0;

        // If Tesseract didn’t give us dimensions, fall back to requiring sharp (optional)
        let width = iw, height = ih;
        if (!width || !height) {
          try {
            const sharp = require('sharp');
            const meta = await sharp(abs).metadata();
            width = meta.width || 0;
            height = meta.height || 0;
          } catch {
            // As a last resort, skip normalization; we won't save if we can't normalize.
            console.warn(`WARN: Could not determine dimensions for ${rel}. Skipping.`);
            failed++; continue;
          }
        }

        const to4 = (n) => Math.round(n * 10000) / 10000;
        current[rel] = boxes.map(b => ({
          x: to4(b.x / width),
          y: to4(b.y / height),
          w: to4(b.w / width),
          h: to4(b.h / height)
        }));
        updated++;
      } else {
        // Save an empty array to avoid reprocessing next time
        current[rel] = [];
        processed++;
      }
    } catch (e) {
      failed++;
      console.warn(`OCR failed for ${rel}: ${e?.message || e}`);
    }
  }

  const dir = path.dirname(OUT_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8');

  console.log('Logo text detection summary:');
  console.log(`- Updated:   ${updated}`);
  console.log(`- Skipped:   ${skipped} (already had masks)`);
  console.log(`- No text:   ${processed}`);
  console.log(`- Failed:    ${failed}`);
  console.log(`- Output:    ${OUT_PATH}`);

  function resSafe(fn) { try { return fn(); } catch { return 0; } }
}

main().catch(err => { console.error(err); process.exit(1); });
