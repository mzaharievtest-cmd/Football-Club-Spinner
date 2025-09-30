#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');

const ROOT = process.cwd();
const TEAMS_PATH = path.resolve(ROOT, 'teams.json');
const OUT_PATH = path.resolve(ROOT, 'data', 'logo-text-masks.json');

function exists(p) { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } }
function readJSON(p, fallback = {}) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }

async function detectForLogo(absPath) {
  // Read image dimensions via sharp
  let iw = 0, ih = 0;
  try {
    const meta = await sharp(absPath).metadata();
    iw = meta.width || 0;
    ih = meta.height || 0;
  } catch (e) {
    console.warn(`WARN: sharp failed to read metadata for ${absPath}: ${e?.message || e}`);
    return [];
  }
  if (!iw || !ih) return [];

  // OCR — do NOT pass a logger; some versions throw if logger is not a function
  const res = await Tesseract.recognize(absPath, 'eng');
  const words = res?.data?.words || [];

  // Filter small/low-confidence boxes (tune as needed)
  const MIN_H = Math.max(10, Math.round(ih * 0.02)); // >= 2% of height
  const MIN_W = Math.max(10, Math.round(iw * 0.02)); // >= 2% of width
  const MIN_CONF = 60; // 0..100

  const rects = [];
  for (const w of words) {
    const b = w?.bbox;
    const conf = Number(w?.confidence ?? 0);
    if (!b || conf < MIN_CONF) continue;
    const bw = Math.max(0, (b.x1 ?? 0) - (b.x0 ?? 0));
    const bh = Math.max(0, (b.y1 ?? 0) - (b.y0 ?? 0));
    if (bw < MIN_W || bh < MIN_H) continue;

    // Normalize to 0..1 coords
    rects.push({
      x: +(b.x0 / iw).toFixed(4),
      y: +(b.y0 / ih).toFixed(4),
      w: +(bw  / iw).toFixed(4),
      h: +(bh  / ih).toFixed(4)
    });
  }
  return rects;
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

  const logos = Array.from(new Set(teams.map(t => t.logo_url).filter(Boolean)));
  const current = readJSON(OUT_PATH, {}); // { "logos1/vendor/...png": [ {x,y,w,h}, ... ] }

  let updated = 0, skipped = 0, processedNoText = 0, failed = 0;

  for (const rel of logos) {
    const abs = path.resolve(ROOT, rel);
    if (!exists(abs)) { failed++; continue; }

    // Skip if we already have an entry (including empty array = "no text")
    if (current[rel] && Array.isArray(current[rel])) { skipped++; continue; }

    try {
      const rects = await detectForLogo(abs);
      current[rel] = rects;
      if (rects.length) updated++; else processedNoText++;
    } catch (e) {
      failed++;
      console.warn(`OCR failed for ${rel}: ${e?.message || e}`);
    }
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8');

  console.log('Logo text detection summary:');
  console.log(`- Updated:         ${updated}`);
  console.log(`- Skipped (exists):${skipped}`);
  console.log(`- No text:         ${processedNoText}`);
  console.log(`- Failed:          ${failed}`);
  console.log(`- Output:          ${OUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
