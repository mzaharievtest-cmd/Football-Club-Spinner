// Football Club Spinner — app.js
// Polished wheel rendering per acceptance criteria:
// - HiDPI crisp canvas
// - Even slice spacing
// - Text (team + stadium) always upright
// - Stable left-to-right layout in each slice (text block then logo), no overlap
// - Adaptive scaling by slice arc (L = radius * sliceAngle)
// - Wrap/ellipsis helpers minimize premature truncation
// - Clip to wedge so nothing bleeds outside
// - Subtle selected-slice rim highlight
// - Precise pointer snap preserved, spin animation unchanged

// --------------------------- App State ---------------------------
let TEAMS = [];
let currentAngle = 0; // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// --------------------------- DOM ---------------------------
const chips = document.getElementById('chips');
const spinBtn = document.getElementById('spinBtn');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName = document.getElementById('optName');
const optLogo = document.getElementById('optLogo');
const optStadium = document.getElementById('optStadium');

const currentText = document.getElementById('currentText');
const currentLogo = document.getElementById('currentLogo');
const historyEl = document.getElementById('history');

const backdrop = document.getElementById('backdrop');
const mClose = document.getElementById('mClose');

const wheel = document.getElementById('wheel');
const fx = document.getElementById('fx'); // reserved for future effects

// --------------------------- Constants & Helpers ---------------------------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU; // pointer at 12 o'clock

const DEBUG = false; // set to true to draw text boxes and log truncation details

const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;

function textColorFor(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}

function luminance(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return 0;
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  return 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
}

// Image cache; redraw when an image loads (no layout shift)
const IMG_CACHE = new Map();
function getLogo(url, onLoad) {
  if (!url) return null;
  let entry = IMG_CACHE.get(url);
  if (entry) return entry.img;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  img.onload = () => { onLoad && onLoad(); };
  IMG_CACHE.set(url, { img });
  return img;
}

// --------------------------- Wrapping / Fitting ---------------------------

// Split text into tokens that allow breaking on space and soft separators
function tokenize(text) {
  // Normalize whitespace
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  // We want to be able to break on -, /, · as well. Split but keep separators.
  const parts = [];
  normalized.split(' ').forEach(word => {
    const chunks = word.split(/([\-\/·])/g).filter(Boolean);
    for (let i=0;i<chunks.length;i++){
      if (chunks[i].match(/[\-\/·]/)) {
        // attach separator to previous chunk to keep semantics, but allow break before next chunk
        if (parts.length) parts[parts.length-1] += chunks[i];
        else parts.push(chunks[i]);
      } else {
        parts.push(chunks[i]);
      }
    }
    // space token to indicate gap
    parts.push(' ');
  });
  if (parts.length && parts[parts.length-1] === ' ') parts.pop();
  return parts;
}

// Greedy wrap without changing font size; returns lines array
function measureWrapped(ctx, text, maxWidth) {
  const tokens = tokenize(text);
  const lines = [];
  let line = '';
  for (let i=0;i<tokens.length;i++){
    const t = tokens[i];
    const candidate = line ? line + t : t;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      if (line) {
        lines.push(line.trim());
        line = '';
        i--; // reprocess this token on the next line
      } else {
        // single token too wide; break at character level
        let s = t;
        while (s && ctx.measureText(s).width > maxWidth) s = s.slice(0, -1);
        if (s) lines.push(s);
        const rest = t.slice(s.length);
        if (rest) tokens.splice(i+1, 0, rest); // insert remainder
      }
    }
  }
  if (line) lines.push(line.trim());
  return lines;
}

// Fit text into a box by shrinking font size before truncation.
// Returns { lines, fontPx, truncated }
function fitTextIntoBox(ctx, text, opts) {
  const {
    maxWidth,
    maxLines = 2,
    fontFamily = 'Inter, system-ui, sans-serif',
    targetPx,
    minPx = 10,
    maxPx = 26,
    lineHeight = 1.05,
    allowTighten = true,
    weight = 800,
  } = opts;

  const clampPx = clamp(minPx, Math.round(targetPx), maxPx);
  let px = clampPx;
  let lines = [];

  while (px >= minPx) {
    ctx.font = `${weight} ${px}px ${fontFamily}`;
    lines = measureWrapped(ctx, text, maxWidth);

    if (lines.length <= maxLines) {
      return { lines, fontPx: px, truncated: false, lineHeight };
    }

    // Too many lines, try shrinking
    px -= allowTighten ? 1 : 2;
  }

  // At minPx: take first (maxLines - 1) full lines, and ellipsize the last visible line
  ctx.font = `${weight} ${minPx}px ${fontFamily}`;
  const all = measureWrapped(ctx, text, maxWidth);
  let used = all.slice(0, Math.max(0, maxLines - 1));
  const remaining = all.slice(maxLines - 1).join(' ');
  // Ellipsize at character granularity for the last line
  let last = remaining;
  while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
  if (last) used.push(last + '…');
  else if (!used.length && text) used = [text[0] + '…'];
  return { lines: used, fontPx: minPx, truncated: true, lineHeight };
}

// Draw the name + stadium block at (x,y), left-aligned along +x
// cfg: { ctx, x, y, maxWidth, name, stadium, basePxName, basePxStadium, maxLinesName=2, color, xLogo, logoHalf, padding, backgroundLum }
function drawLabelBlock(cfg) {
  const {
    ctx, x, y, maxWidth,
    name, stadium,
    basePxName, basePxStadium,
    maxLinesName = 2,
    color,
    xLogo, logoHalf, padding,
    backgroundLum,
    forceOneLine = false
  } = cfg;

  const smallSlice = forceOneLine;
  const nameMaxLines = smallSlice ? 1 : maxLinesName;

  // Slightly tighter line-height on very small slices
  const lhName = smallSlice ? 1.03 : 1.06;
  const lhStad = smallSlice ? 1.03 : 1.05;

  // Fit name first
  const nameFit = fitTextIntoBox(ctx, name || '', {
    maxWidth,
    maxLines: nameMaxLines,
    fontFamily: 'Inter, system-ui, sans-serif',
    targetPx: basePxName,
    minPx: 10,
    maxPx: 26,
    lineHeight: lhName,
    allowTighten: true,
    weight: (backgroundLum >= 0.35 && backgroundLum <= 0.45) ? 900 : 800,
  });

  // After fitting name, check if we have space for stadium
  let canDrawStadium = !!stadium && !!optStadium?.checked && maxWidth >= 80;
  // Ensure the text block's right edge doesn't encroach into the logo area (horizontal guard)
  const rightEdge = x + maxWidth;
  const logoLeftEdge = xLogo - logoHalf - padding;
  if (rightEdge > logoLeftEdge) {
    // reduce available width; re-fit name
    const newMax = Math.max(40, logoLeftEdge - x);
    const nameFit2 = fitTextIntoBox(ctx, name || '', {
      maxWidth: newMax,
      maxLines: nameMaxLines,
      fontFamily: 'Inter, system-ui, sans-serif',
      targetPx: nameFit.fontPx,
      minPx: 10,
      maxPx: 26,
      lineHeight: lhName,
      allowTighten: true,
      weight: (backgroundLum >= 0.35 && backgroundLum <= 0.45) ? 900 : 800,
    });
    if (DEBUG && nameFit2.truncated && !nameFit.truncated) {
      console.log({ team: name, reason: 'logo-guard-shrink', fontPx: nameFit2.fontPx, lines: nameFit2.lines });
    }
    nameFit.lines = nameFit2.lines;
    nameFit.fontPx = nameFit2.fontPx;
    nameFit.truncated = nameFit2.truncated;
  }

  // Decide stadium presence: ensure at least 0.85 * basePxStadium space visually remains
  let stadDraw = null;
  if (canDrawStadium) {
    const stadFit = fitTextIntoBox(ctx, stadium || '', {
      maxWidth: Math.max(40, Math.min(maxWidth, (xLogo - logoHalf - padding) - x)),
      maxLines: 1,
      fontFamily: 'Inter, system-ui, sans-serif',
      targetPx: basePxStadium,
      minPx: 9,
      maxPx: 22,
      lineHeight: lhStad,
      allowTighten: true,
      weight: 700,
    });
    if (stadFit.fontPx >= 0.85 * basePxStadium) {
      stadDraw = stadFit;
    }
  }

  // Compute total block height
  const nameLineH = nameFit.fontPx * nameFit.lineHeight;
  const stadLineH = stadDraw ? (stadDraw.fontPx * stadDraw.lineHeight) : 0;
  const gap = stadDraw ? 6 : 0;
  const totalH = nameFit.lines.length * nameLineH + gap + (stadDraw ? stadLineH : 0);

  // Vertical centering around y
  let yCursor = y - totalH / 2;

  // Draw background debug rect
  if (DEBUG) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,255,255,0.10)';
    ctx.fillRect(x, yCursor, maxWidth, totalH);
    ctx.restore();
  }

  // Name lines
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Subtle stroke for contrast; add extra light shadow in mid-contrast region
  const strokeColor = (backgroundLum >= 0.35 && backgroundLum <= 0.45) ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.85)';
  const nameWeight = (backgroundLum >= 0.35 && backgroundLum <= 0.45) ? 900 : 800;

  for (const line of nameFit.lines) {
    const baselineY = yCursor + nameLineH;
    ctx.font = `${nameWeight} ${nameFit.fontPx}px Inter, system-ui, sans-serif`;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(1, Math.round(nameFit.fontPx / 9));
    ctx.fillStyle = color;
    ctx.strokeText(line, x, baselineY);
    ctx.fillText(line, x, baselineY);
    yCursor += nameLineH;
  }
  ctx.restore();

  // Gap then stadium
  if (stadDraw) yCursor += gap;

  if (stadDraw) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${stadDraw.fontPx}px Inter, system-ui, sans-serif`;
    ctx.strokeStyle = 'rgba(12,16,28,0.75)';
    ctx.lineWidth = Math.max(1, Math.round(stadDraw.fontPx / 9));
    ctx.fillStyle = '#D7E8FF';
    const baselineY = yCursor + stadDraw.fontPx * stadDraw.lineHeight;
    const lastLine = stadDraw.lines.join(' ').trim();
    ctx.strokeText(lastLine, x, baselineY);
    ctx.fillText(lastLine, x, baselineY);
    ctx.restore();
  }

  if (DEBUG && nameFit.truncated) {
    console.log({ team: name, fontPx: nameFit.fontPx, truncated: true, lines: nameFit.lines });
  }
}

// --------------------------- HiDPI sizing ---------------------------
function sizeCanvas() {
  const rect = (wheel.parentElement || wheel).getBoundingClientRect();
  const cssSize = clamp(300, Math.round(rect.width || 640), 1200);
  const DPR = Math.max(1, window.devicePixelRatio || 1);

  wheel.width = Math.round(cssSize * DPR);
  wheel.height = Math.round(cssSize * DPR);
  fx.width = wheel.width;
  fx.height = wheel.height;

  wheel.style.width = cssSize + 'px';
  wheel.style.height = cssSize + 'px';
  fx.style.width = cssSize + 'px';
  fx.style.height = cssSize + 'px';
}

// --------------------------- Chips / History / Modal (unchanged) ---------------------------
function renderChips() {
  const leagues = [...new Set(TEAMS.map(t => t.league_code))].sort();
  chips.innerHTML = '';
  leagues.forEach(code => {
    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `<input type="checkbox" value="${code}" checked aria-checked="true"> ${code}`;
    chips.appendChild(label);
  });
}
function getFiltered() {
  const active = Array.from(chips.querySelectorAll('input:checked')).map(i => i.value);
  return TEAMS.filter(t => active.includes(t.league_code));
}
function saveHistory() { localStorage.setItem('clubHistory', JSON.stringify(history)); }
function resetHistory() { history = []; saveHistory(); renderHistory(); }
function renderHistory() {
  historyEl.innerHTML = '';
  if (history.length === 0) {
    historyEl.setAttribute('aria-live', 'polite');
    historyEl.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
  }
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    const i = document.createElement('img');
    i.src = item.logo_url;
    i.alt = `${item.team_name} logo`;
    i.onerror = () => { i.src = ''; i.alt = 'No image'; };
    const s = document.createElement('span');
    s.textContent = `${item.team_name} (${item.league_code})`;
    div.append(i, s);
    historyEl.append(div);
  });
}
function openModal(team){
  document.getElementById('mHead').textContent = team.team_name;
  document.getElementById('mSub').textContent  = team.league_code;
  document.getElementById('mLogo').src         = team.logo_url || "";
  document.getElementById('mColor').style.background = team.primary_color || '#4f8cff';
  document.getElementById('mColorHex').textContent   = team.primary_color || '#4f8cff';
  document.getElementById('mStadium').textContent    = team.stadium || '—';
  backdrop.style.display = 'flex';
  requestAnimationFrame(()=> document.getElementById('modal').classList.add('show'));
}
function closeModal(){
  document.getElementById('modal').classList.remove('show');
  setTimeout(()=> backdrop.style.display='none', 150);
}

// --------------------------- WHEEL DRAWING (UPDATED) ---------------------------
function drawWheel(){
  const data = getFiltered();
  const N = data.length || 1;

  const ctx = wheel.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw in CSS px
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const W = wheel.width / DPR;
  const H = wheel.height / DPR;

  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2, H/2);

  const angleDraw = mod(currentAngle, TAU);
  ctx.rotate(angleDraw);

  const radius = Math.min(W, H) * 0.48;
  const sliceAngle = TAU / N;

  // 1) Draw wedges
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const startAngle = i * sliceAngle;
    const endAngle   = (i + 1) * sliceAngle;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // 2) Subtle selected rim highlight
  if (selectedIdx >= 0 && selectedIdx < N) {
    const a0 = selectedIdx * sliceAngle;
    const a1 = (selectedIdx + 1) * sliceAngle;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius - 1.0, a0, a1);
    ctx.lineWidth = Math.max(2, Math.round(radius * 0.015));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.restore();
  }

  // 3) Per-slice content
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const showLogo    = !!(optLogo?.checked && t.logo_url);
    const showName    = !!(optName?.checked && t.team_name);
    const showStadium = !!(optStadium?.checked && t.stadium);

    if (!showLogo && !showName && !showStadium) continue;

    const startAngle = i * sliceAngle;
    const endAngle   = (i + 1) * sliceAngle;
    const midAngle   = (startAngle + endAngle) / 2;
    const sliceArc   = radius * (endAngle - startAngle); // L

    // Adaptive targets per spec
    const nameTargetPx    = clamp(14, 0.23 * sliceArc, 24);
    const stadiumTargetPx = clamp(12, 0.18 * sliceArc, 18);
    let   logoSize        = clamp(24, 0.34 * sliceArc, 56);
    const logoHalf = logoSize / 2;

    const pad = 10;

    const fg = textColorFor(t.primary_color);
    const lum = luminance(t.primary_color);

    ctx.save();

    // Clip to wedge
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius - 1, startAngle, endAngle);
    ctx.closePath();
    ctx.clip();

    // Rotate into slice frame (+x radial)
    ctx.rotate(midAngle);

    // Upright text rule
    if (Math.cos(midAngle) < 0) ctx.rotate(Math.PI);

    // Geometry: text block then logo, both centered vertically on y=0
    const xLogo = radius * 0.74;
    const xText = radius * 0.42;
    let   maxTextWidth = Math.max(60, (xLogo - logoHalf - pad) - xText);

    const forceOneLine = sliceArc < 90; // very thin slice

    // Draw text block (may decide to skip stadium if width is small)
    if (showName) {
      drawLabelBlock({
        ctx,
        x: xText,
        y: 0,
        maxWidth: maxTextWidth,
        name: t.team_name,
        stadium: showStadium ? (t.stadium || '') : '',
        basePxName: nameTargetPx,
        basePxStadium: stadiumTargetPx,
        maxLinesName: 2,
        color: fg,
        xLogo, logoHalf, padding: pad,
        backgroundLum: lum,
        forceOneLine
      });
    }

    // Draw logo badge (if enabled)
    if (showLogo) {
      ctx.save();
      ctx.translate(xLogo, 0);

      // Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      // Outer ring
      ctx.beginPath();
      ctx.arc(0, 0, logoHalf, 0, TAU);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();

      // Clip circle then draw image (contain)
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, logoHalf - 1, 0, TAU);
      ctx.closePath();
      ctx.clip();

      const img = getLogo(t.logo_url, () => requestAnimationFrame(drawWheel));
      if (img && img.complete) {
        // contain in square (2*logoHalf - 2)
        const box = Math.max(4, 2 * (logoHalf - 1));
        const iw = img.naturalWidth || box;
        const ih = img.naturalHeight || box;
        const scale = Math.min(box / iw, box / ih);
        const dw = iw * scale, dh = ih * scale;
        ctx.drawImage(img, -dw/2, -dh/2, dw, dh);
      } else {
        // placeholder
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        const ph = (logoHalf - 3) * 2;
        ctx.fillRect(-ph/2, -ph/2, ph, ph);
      }
      ctx.restore(); // end clip

      ctx.restore();
    }

    if (DEBUG) {
      // Visualize the text box width ruler
      ctx.save();
      ctx.strokeStyle = 'rgba(0,255,255,0.6)';
      ctx.setLineDash([4,3]);
      ctx.beginPath();
      ctx.moveTo(xText, -radius*0.04);
      ctx.lineTo(xText,  radius*0.04);
      ctx.moveTo(xText + maxTextWidth, -radius*0.04);
      ctx.lineTo(xText + maxTextWidth,  radius*0.04);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore(); // slice clip + rotation
  }

  ctx.restore();
}

// --------------------------- Result + Spin (unchanged) ---------------------------
function setResult(idx){
  const data = getFiltered();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  currentText.textContent = `${t.team_name} · ${t.league_code}`;
  currentLogo.src         = t.logo_url || "";

  history.unshift(t);
  if (history.length > 50) history = history.slice(0,50);
  saveHistory();
  renderHistory();
  openModal(t);
}

function spin(){
  if (spinning) return;
  const data = getFiltered();
  if (!data.length) {
    currentText.textContent = 'Please select at least one league.';
    return;
  }

  spinning = true;
  spinBtn.disabled = true;
  selectedIdx = -1;

  const N = data.length;
  const slice = TAU / N;

  const extraTurns  = 6 + Math.floor(Math.random()*3); // 6..8 turns
  const finalOffset = Math.random() * TAU;
  const targetAngle = TAU * extraTurns + finalOffset;

  const start    = performance.now();
  const duration = 3200;
  const easeOutCubic = x => 1 - Math.pow(1-x, 3);

  function anim(now){
    const p = clamp(0, (now - start) / duration, 1);
    currentAngle = targetAngle * easeOutCubic(p);
    drawWheel();

    if (p < 1){
      requestAnimationFrame(anim);
    } else {
      // Determine index under the pointer (top)
      const theta = mod(currentAngle, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;

      // Snap: align center of that slice exactly under pointer
      const centerAngle = idx * slice + slice / 2;
      const snapDelta = mod(centerAngle - offset, TAU);
      currentAngle = mod(currentAngle + snapDelta, TAU);

      spinning = false;
      spinBtn.disabled = false;
      selectedIdx = idx;
      drawWheel();
      setResult(idx);
    }
  }
  requestAnimationFrame(anim);
}

// --------------------------- Events / Boot ---------------------------
function setupEventListeners() {
  chips.addEventListener('change', () => {
    selectedIdx = -1;
    drawWheel();
    if (getFiltered().length === 0) {
      currentText.textContent = 'Please select at least one league.';
      spinBtn.disabled = true;
    } else {
      currentText.textContent = 'No selection yet';
      spinBtn.disabled = false;
    }
  });

  optName.onchange = optLogo.onchange = optStadium.onchange = () => drawWheel();
  spinBtn.onclick = spin;
  resetHistoryBtn.addEventListener('click', resetHistory);

  mClose.onclick = closeModal;
  backdrop.addEventListener('click', e => { if(e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(e.key==='Escape' && backdrop.style.display==='flex') closeModal(); });

  // Debounced resize redraw
  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => {
      sizeCanvas();
      drawWheel();
    }, 120);
  }, { passive: true });
}

// Load data & init
fetch('./teams.json')
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    renderChips();
    renderHistory();
    sizeCanvas();
    drawWheel();
    setupEventListeners();
  });
