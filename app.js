// Football Club Spinner — app.js
// This version fixes canvas drawing for the wheel:
// - HiDPI crisp rendering
// - Evenly spaced slices around the circle
// - Upright labels (never upside-down), clipped to their slice
// - Logo, Name, Stadium stacked along the radial line (logo above, then name, then stadium)
// - Adaptive sizing (fonts/logos scale by wheel size and number of teams)
// - Ellipsis when text would overflow
// - Subtle selected-slice rim highlight
// - Redraws correctly on resize
//
// Note: Spin animation, pointer position, layout, and dark theme remain intact.

// -----------------------------------------------------------------------------
// App state
// -----------------------------------------------------------------------------
let TEAMS = [];
let currentAngle = 0;  // radians; wheel rotation during animation
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// -----------------------------------------------------------------------------
// DOM references
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Constants / helpers
// -----------------------------------------------------------------------------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU; // pointer at the top

const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;

function textColorFor(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}

function truncateToWidth(ctx, text, maxW) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  const ell = '…';
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const s = text.slice(0, mid) + ell;
    if (ctx.measureText(s).width <= maxW) lo = mid + 1; else hi = mid;
  }
  const cut = Math.max(0, lo - 1);
  return text.slice(0, cut) + ell;
}

function fitFontSize(ctx, text, targetPx, minPx, maxWidth, weight = 700) {
  let size = Math.round(targetPx);
  while (size >= minPx) {
    ctx.font = `${weight} ${size}px Inter,Arial,sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  return minPx;
}

// -----------------------------------------------------------------------------
// Responsive HiDPI sizing (kept minimal; drawing also ensures HiDPI)
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Filters / UI
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Modal
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Wheel drawing (UPDATED)
// -----------------------------------------------------------------------------
function drawWheel(){
  const data = getFiltered();
  const N = data.length || 1;

  const ctx = wheel.getContext('2d');

  // HiDPI: draw using CSS pixels by mapping the device-pixel canvas back to CSS units
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const W = wheel.width / DPR;
  const H = wheel.height / DPR;

  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2, H/2);

  // Evenly distribute slices around the full circle
  const angleDraw = mod(currentAngle, TAU);
  ctx.rotate(angleDraw);

  const radius = Math.min(W,H) * 0.48;
  const slice  = TAU / N;
  const tanHalf = Math.tan(slice/2);

  // Width available across a slice at distance r from the center (chord length)
  const chordWidth = (r) => Math.max(18, 2 * r * tanHalf - 16);

  // Adaptive sizing (fewer slices => larger content)
  const density = clamp(0.78, 12 / Math.max(6, N), 1.35);

  const baseLogo = clamp(18, Math.round(radius * 0.11 * density), 56);
  const baseName = clamp(11, Math.round(radius * 0.062 * density), 22);
  const baseStad = clamp(9,  Math.round(radius * 0.048 * density), 16);

  const gapRadial = clamp(6, Math.round(radius * 0.03), 18); // spacing between stacked items (radial)
  const rimPad    = clamp(8, Math.round(radius * 0.03), 14); // keep off the rim

  const rInner = radius * 0.30;      // keep away from apex (narrow)
  const rOuter = radius - rimPad;    // final radial boundary for text/graphics

  // 1) Background slices
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const a0 = i * slice;
    const a1 = (i + 1) * slice;

    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, a0, a1);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // 2) Subtle highlight of selected slice (outer rim stroke)
  if (selectedIdx >= 0 && selectedIdx < N) {
    const a0 = selectedIdx * slice;
    const a1 = (selectedIdx + 1) * slice;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius - 1.0, a0, a1);
    ctx.lineWidth = Math.max(2, Math.round(radius * 0.015));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.restore();
  }

  // 3) Per-slice content (logo above text, all upright, clipped inside wedge)
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const showLogo = !!(optLogo?.checked && t.logo_url);
    const showName = !!(optName?.checked && t.team_name);
    const showStad = !!(optStadium?.checked && t.stadium);

    if (!showLogo && !showName && !showStad) continue;

    const aMid = i * slice + slice/2;
    const fg = textColorFor(t.primary_color);

    // Prepare item sizes
    let logoSize = showLogo ? baseLogo : 0;
    let namePx = showName ? baseName : 0;
    let stadPx = showStad ? baseStad : 0;

    // Work in the slice's local frame: +x radial outward, +y along chord
    ctx.save();

    // Clip to wedge so nothing spills
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius-1, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.clip();

    // Rotate to align +x with the wedge bisector
    ctx.rotate(aMid);

    // TARGET: place name close to the rim, stadium just outside (further toward rim),
    // and logo above (more inward), all along radial (+x) line at y = 0.
    // We'll compute center radii for each item ensuring width fits chord and no overlap.

    const padW = 8; // horizontal padding for width fit

    // Compute name position
    let nameW = 0, stadW = 0;

    if (showName) {
      // Fit name font to maximum width at the rim first
      const maxWAtRim = chordWidth(rOuter) - padW;
      namePx = fitFontSize(ctx, t.team_name, namePx, 10, maxWAtRim, 800);
      ctx.font = `800 ${namePx}px Inter,Arial,sans-serif`;
      nameW = ctx.measureText(t.team_name).width;
    }

    if (showStad) {
      const maxWAtRim = chordWidth(rOuter) - padW;
      stadPx = fitFontSize(ctx, t.stadium || '', stadPx, 9, maxWAtRim, 700);
      ctx.font = `700 ${stadPx}px Inter,Arial,sans-serif`;
      stadW = ctx.measureText(t.stadium || '').width;
    }

    // Heights of line boxes
    const nameH = showName ? Math.round(namePx * 1.10) : 0;
    const stadH = showStad ? Math.round(stadPx * 1.05) : 0;
    const logoH = showLogo ? logoSize : 0;

    // Place NAME near rim: find minimal radius where its width fits the chord
    let rName = rOuter - nameH/2;
    if (showName) {
      const needR = (nameW + padW) / (2 * tanHalf);
      rName = clamp(rInner + nameH/2, Math.max(needR, rInner + nameH/2), rOuter - nameH/2);
    }

    // Place STADIUM below name (closer to rim), with radial gap
    let rStad = rName + (showName ? (nameH/2 + gapRadial + stadH/2) : stadH/2);
    if (showStad) {
      // Also ensure chord width can fit stadium
      const needR = (stadW + padW) / (2 * tanHalf);
      rStad = Math.max(rStad, needR, rInner + stadH/2);
      // Keep within rim
      if (rStad > rOuter - stadH/2) {
        rStad = rOuter - stadH/2;
        // If now overlapping name, nudge name inward if possible
        const minName = rInner + nameH/2;
        const nameTarget = rStad - (stadH/2 + gapRadial + nameH/2);
        rName = clamp(minName, nameTarget, rName);
      }
      // If stadium still overlaps name, shrink stadium slightly
      if (showName && (rStad - stadH/2) < (rName + nameH/2 + gapRadial)) {
        const maxCenter = rOuter - stadH/2;
        const overlap = (rName + nameH/2 + gapRadial) - (rStad - stadH/2);
        if (overlap > 0) {
          const scale = clamp(0.6, (stadH - overlap) / stadH, 1);
          const newPx = Math.max(9, Math.floor(stadPx * scale));
          if (newPx < stadPx) {
            stadPx = newPx;
            ctx.font = `700 ${stadPx}px Inter,Arial,sans-serif`;
            stadW = ctx.measureText(t.stadium || '').width;
            // recompute H and rStad
            const sH = Math.round(stadPx * 1.05);
            rStad = Math.min(maxCenter, rName + nameH/2 + gapRadial + sH/2);
          }
        }
      }
    }

    // Place LOGO above name (toward center)
    let rLogo = rName - (showName ? (nameH/2 + gapRadial + logoH/2) : (logoH/2 + gapRadial));
    if (showLogo) {
      // Ensure logo also fits chord width at its radius
      const needR = (logoSize + padW) / (2 * tanHalf);
      rLogo = Math.max(rLogo, needR, rInner + logoH/2);
      // If overlapping name (too close), push inward (or shrink if needed)
      if (showName && (rLogo + logoH/2) > (rName - nameH/2 - gapRadial)) {
        // Try moving inward
        const target = rName - nameH/2 - gapRadial - logoH/2;
        rLogo = Math.max(rInner + logoH/2, target);
        if ((rLogo + logoH/2) > (rName - nameH/2 - gapRadial)) {
          // Not enough room; shrink logo slightly
          const avail = (rName - nameH/2 - gapRadial) - (rInner);
          const maxLogo = Math.max(16, Math.floor(avail));
          if (logoSize > maxLogo) {
            logoSize = clamp(16, maxLogo, logoSize);
          }
          // Recompute rLogo with new size
          const newNeedR = (logoSize + padW) / (2 * tanHalf);
          rLogo = Math.max(rInner + logoSize/2, newNeedR, rName - nameH/2 - gapRadial - logoSize/2);
        }
      }
    }

    // Draw elements upright by unrotating for each draw call, centered on y=0
    // Name (draw first so logo shadow sits on top visually)
    if (showName) {
      const maxW = chordWidth(rName) - padW;
      ctx.save();
      ctx.translate(rName, 0);
      ctx.rotate(-aMid);

      ctx.font = `800 ${namePx}px Inter,Arial,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const nameStr = truncateToWidth(ctx, t.team_name, maxW);
      ctx.strokeStyle = 'rgba(20,28,46,0.85)';
      ctx.lineWidth = Math.max(1, Math.round(namePx/9));
      ctx.fillStyle = fg;
      ctx.strokeText(nameStr, 0, 0);
      ctx.fillText(nameStr, 0, 0);

      ctx.restore();
    }

    // Stadium
    if (showStad) {
      const maxW = chordWidth(rStad) - padW;
      ctx.save();
      ctx.translate(rStad, 0);
      ctx.rotate(-aMid);

      ctx.font = `700 ${stadPx}px Inter,Arial,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const stadStr = truncateToWidth(ctx, t.stadium || '', maxW);
      ctx.strokeStyle = 'rgba(20,28,46,0.75)';
      ctx.lineWidth = Math.max(1, Math.round(stadPx/9));
      ctx.fillStyle = '#D7E8FF';
      ctx.strokeText(stadStr, 0, 0);
      ctx.fillText(stadStr, 0, 0);

      ctx.restore();
    }

    // Logo (with subtle shadow; no big badge)
    if (showLogo) {
      ctx.save();
      ctx.translate(rLogo, 0);
      ctx.rotate(-aMid);

      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      const img = new Image();
      img.src = t.logo_url;
      const drawLogo = () => {
        ctx.drawImage(img, -logoSize/2, -logoSize/2, logoSize, logoSize);
      };
      if (img.complete) drawLogo(); else img.onload = drawLogo;

      ctx.restore();
    }

    ctx.restore();
  }

  ctx.restore();
}

// -----------------------------------------------------------------------------
// Result + Spin (unchanged logic; includes precise pointer snapping)
// -----------------------------------------------------------------------------
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
      // Find slice under the pointer at top
      const theta = mod(currentAngle, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      let idx = Math.floor(offset / slice) % N;

      // Snap: rotate so center of that slice aligns to pointer
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

// -----------------------------------------------------------------------------
// Events / Boot
// -----------------------------------------------------------------------------
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

  // Redraw on resize (debounced)
  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => {
      sizeCanvas();
      drawWheel();
    }, 120);
  }, { passive: true });
}

// Load data + init
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
