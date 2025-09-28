// Football Club Spinner — app.js
// Wheel canvas drawing fixed to meet the acceptance criteria:
// - HiDPI crisp canvas
// - Evenly spaced slices, correct clipping to wedge
// - All labels always upright (never upside-down) using midAngle + optional PI flip
// - Consistent in-slice layout (logo outer, text block inner) with padding
// - Adaptive sizing by slice arc length (L = radius * sliceAngle)
// - Ellipsis/wrap (max 2 lines for name) with predictable truncation
// - No overlap with pointer; subtle selected rim highlight
// - Re-draws on window resize; spin logic intact

// --------------------------- App State ---------------------------
let TEAMS = [];
let currentAngle = 0; // radians; animated rotation
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
const fx = document.getElementById('fx'); // reserved

// --------------------------- Constants & Helpers ---------------------------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU; // pointer at 12 o'clock

const DEBUG = false; // set true to visualize bounding boxes and rulers

const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;

function textColorFor(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}

// Cache logo images; when they load, re-draw (no layout shift)
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

// Wrap into up to maxLines. Uses greedy word-wrapping; last line truncates with ellipsis if needed.
function wrapLinesWithEllipsis(ctx, text, maxWidth, maxLines) {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';

  for (let i = 0; i < words.length; i++) {
    const next = cur ? cur + ' ' + words[i] : words[i];
    if (ctx.measureText(next).width <= maxWidth) {
      cur = next;
    } else {
      if (cur) {
        lines.push(cur);
      } else {
        // single long word; hard cut with ellipsis
        let s = words[i];
        while (s && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
        lines.push(s + '…');
      }
      cur = '';
      if (lines.length === maxLines - 1) {
        // last line: append remaining with ellipsis
        const rest = words.slice(i).join(' ');
        let truncated = rest;
        while (truncated && ctx.measureText(truncated + '…').width > maxWidth) {
          truncated = truncated.slice(0, -1);
        }
        lines.push(truncated + (truncated ? '…' : ''));
        return lines;
      }
      i--; // re-evaluate current word for next line
    }
  }
  if (cur) lines.push(cur);
  // If too many lines, crop last with ellipsis
  if (lines.length > maxLines) {
    let last = lines.slice(0, maxLines).join(' ');
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    return [last + '…'];
  }
  return lines;
}

// --------------------------- Responsive HiDPI sizing ---------------------------
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

// --------------------------- UI helpers (unchanged) ---------------------------
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

function saveHistory() {
  localStorage.setItem('clubHistory', JSON.stringify(history));
}
function resetHistory() {
  history = [];
  saveHistory();
  renderHistory();
}
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

// --------------------------- Modal (unchanged) ---------------------------
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
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw using CSS pixels
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const W = wheel.width / DPR;
  const H = wheel.height / DPR;

  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2, H/2);

  // Wheel geometry
  const angleDraw = mod(currentAngle, TAU);
  ctx.rotate(angleDraw);

  const radius = Math.min(W,H) * 0.48;
  const sliceAngle = TAU / N;
  const tanHalf = Math.tan(sliceAngle/2);

  // Helper: width across slice at radius r
  const chordWidth = (r) => Math.max(18, 2 * r * tanHalf - 16);

  // 1) Draw all wedges (evenly spaced)
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

  // 2) Subtle highlight of selected slice
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

  // 3) Per-slice content (logo + text block). Clip to wedge; keep labels upright.
  for (let i = 0; i < N; i++) {
    const team = data[i] || {};
    const showLogo = !!(optLogo?.checked && team.logo_url);
    const showName = !!(optName?.checked && team.team_name);
    const showStadium = !!(optStadium?.checked && team.stadium);

    if (!showLogo && !showName && !showStadium) continue;

    const startAngle = i * sliceAngle;
    const endAngle   = (i + 1) * sliceAngle;
    const midAngle   = (startAngle + endAngle) / 2;
    const L          = radius * (endAngle - startAngle); // arc length

    // Adaptive sizing from arc length
    let logoSize      = clamp(24, 0.35 * L, 56);
    let nameFontPx    = clamp(12, 0.22 * L, 22);
    let stadiumFontPx = clamp(11, 0.18 * L, 18);

    const padding = 8;
    const fg = textColorFor(team.primary_color);

    ctx.save();

    // Clip strictly to wedge so nothing bleeds
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius - 1, startAngle, endAngle);
    ctx.closePath();
    ctx.clip();

    // Move to slice frame: +x points along radial line to midAngle
    ctx.rotate(midAngle);

    // Upright rule: if pointing left side of circle, rotate 180 so text is upright
    const needFlip = Math.cos(midAngle) < 0;
    if (needFlip) ctx.rotate(Math.PI);
    const outward = needFlip ? -1 : 1; // use to keep "outer" positions consistent

    // Layout positions along +x (outward), +y tangential
    const xLogoCenter = outward * (radius * 0.72);
    const xTextLeft   = outward * (radius * 0.42);

    // Compute max text width between xTextLeft and the inner edge of logo (minus padding)
    const logoHalf = showLogo ? (logoSize / 2) : 0;
    const xTextRightLimit = outward > 0
      ? (xLogoCenter - logoHalf - padding)
      : (xLogoCenter + logoHalf + padding);

    let maxTextWidth = Math.max(0, Math.abs(xTextRightLimit - xTextLeft));

    // If space too small, drop stadium first, then logo
    let allowStadium = showStadium;
    let allowLogo = showLogo;
    if (maxTextWidth < 60) {
      allowStadium = false;
      maxTextWidth = Math.max(0, Math.abs(xTextRightLimit - xTextLeft));
      if (maxTextWidth < 60) {
        allowLogo = false;
        // Recompute with no logo reservation
        const xRightNoLogo = outward > 0 ? (radius * 0.86) : (-radius * 0.86);
        maxTextWidth = Math.max(60, Math.abs(xRightNoLogo - xTextLeft));
      }
    }

    // Fit/wrap text
    // Name can be up to 2 lines (or 1 line if arc length is tiny)
    const maxLines = L < 90 ? 1 : 2;

    let nameLines = [];
    let stadLine = '';
    if (showName) {
      ctx.font = `800 ${nameFontPx}px Inter, system-ui, sans-serif`;
      nameLines = wrapLinesWithEllipsis(ctx, team.team_name, maxTextWidth, maxLines);
      // If after wrapping the combined height is too tall against logo, we can reduce fonts slightly
      const approxNameH = nameLines.length * (nameFontPx * 1.12);
      const maxBlockH = Math.max(logoSize, nameFontPx * 1.12 * 2 + (allowStadium ? (stadiumFontPx * 1.05 + 6) : 0));
      if (approxNameH > maxBlockH) {
        const scale = clamp(0.8, maxBlockH / approxNameH, 1);
        nameFontPx = Math.max(10, Math.floor(nameFontPx * scale));
        ctx.font = `800 ${nameFontPx}px Inter, system-ui, sans-serif`;
        nameLines = wrapLinesWithEllipsis(ctx, team.team_name, maxTextWidth, maxLines);
      }
    }
    if (allowStadium) {
      ctx.font = `700 ${stadiumFontPx}px Inter, system-ui, sans-serif`;
      stadLine = truncateToWidth(ctx, team.stadium || '', maxTextWidth);
    }

    // Draw LOGO (as circular badge with white stroke) if allowed
    if (allowLogo) {
      ctx.save();
      ctx.translate(xLogoCenter, 0);

      // Shadow first
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      // Badge ring background (transparent center)
      ctx.beginPath();
      ctx.arc(0, 0, logoHalf, 0, TAU);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();

      // White border
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();

      // Clip circle and draw image (contain)
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, logoHalf - 1, 0, TAU);
      ctx.closePath();
      ctx.clip();

      const img = getLogo(team.logo_url, () => requestAnimationFrame(drawWheel));
      if (img && img.complete) {
        // draw “contain” inside square box
        const box = logoHalf * 2 - 2;
        // Most logos are square; for generality, we can letterbox without distorting:
        const iw = img.naturalWidth || box;
        const ih = img.naturalHeight || box;
        const scale = Math.min(box / iw, box / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        ctx.drawImage(img, -dw/2, -dh/2, dw, dh);
      } else {
        // Placeholder ring (keeps layout stable)
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(-logoHalf+2, -logoHalf+2, (logoHalf-2)*2, (logoHalf-2)*2);
      }
      ctx.restore(); // end image clip
      ctx.restore();
    }

    // Draw TEXT block (aligned to left edge xTextLeft, centered vertically on y=0)
    if (showName || allowStadium) {
      // Compose lines
      const lines = [];
      if (showName) lines.push(...nameLines);
      if (allowStadium && stadLine) lines.push(stadLine);

      // Compute vertical block metrics
      const nameLH = nameFontPx * 1.12;
      const stadLH = stadiumFontPx * 1.05;
      let totalH = 0;
      for (let li = 0; li < lines.length; li++) {
        totalH += (li < nameLines.length ? nameLH : stadLH);
        if (li === nameLines.length - 1 && allowStadium && stadLine) {
          totalH += 6; // gap between name block and stadium
        }
      }

      // top-left anchor (xTextLeft, -totalH/2), but we draw per-line using fillText with baseline alphabetic
      let yCursor = -totalH / 2;

      // Draw name lines
      ctx.save();
      ctx.textAlign = outward > 0 ? 'left' : 'right';
      ctx.fillStyle = fg;

      for (let li = 0; li < nameLines.length; li++) {
        const line = nameLines[li];
        ctx.font = `800 ${nameFontPx}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = 'alphabetic';

        const lineH = nameLH;
        const y = yCursor + lineH; // alphabetic baseline adjustment

        // subtle contrast stroke
        ctx.strokeStyle = 'rgba(12,16,28,0.85)';
        ctx.lineWidth = Math.max(1, Math.round(nameFontPx/9));
        ctx.strokeText(line, xTextLeft, y);

        ctx.fillText(line, xTextLeft, y);
        yCursor += lineH;
      }

      // Small gap before stadium
      if (allowStadium && stadLine) yCursor += 6;

      // Draw stadium
      if (allowStadium && stadLine) {
        const lineH = stadLH;
        const y = yCursor + lineH;

        ctx.font = `700 ${stadiumFontPx}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#D7E8FF';
        ctx.strokeStyle = 'rgba(12,16,28,0.75)';
        ctx.lineWidth = Math.max(1, Math.round(stadiumFontPx/9));
        ctx.strokeText(stadLine, xTextLeft, y);
        ctx.fillText(stadLine, xTextLeft, y);

        yCursor += lineH;
      }
      ctx.restore();

      // Debug guides
      if (DEBUG) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0,255,255,0.6)';
        ctx.setLineDash([4,3]);
        const xTR = outward > 0 ? (xTextLeft + maxTextWidth) : (xTextLeft - maxTextWidth);
        ctx.beginPath();
        ctx.moveTo(xTextLeft, -radius*0.05);
        ctx.lineTo(xTextLeft, radius*0.05);
        ctx.moveTo(xTR, -radius*0.05);
        ctx.lineTo(xTR, radius*0.05);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Debug: wedge outline
    if (DEBUG) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius - 1, startAngle, endAngle);
      ctx.closePath();
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
      const theta = mod(currentAngle, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      let idx = Math.floor(offset / slice) % N;

      // Snap slice center exactly under pointer
      const centerAngle = idx * slice + slice/2;
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
