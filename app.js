// Football Club Spinner — Polished Wheel (HiDPI, adaptive, non-overlapping, precise pointer)
// Requirements covered:
// - HiDPI crisp canvas (Retina)
// - Even slice spacing all around
// - Upright labels with ellipsis
// - Adaptive scaling (fonts/logos scale by radius & number of teams)
// - Logos to the left of text (no big badge), subtle text stroke for contrast
// - Exact pointer snapping to selected slice
// - Subtle selected-slice rim stroke highlight
// - Redraws on window resize
// - Keeps dark theme + current layout intact

let TEAMS = [];
let currentAngle = 0;     // Animated rotation (radians)
let spinning = false;
let selectedIdx = -1;     // Index under pointer after spin settles
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// DOM references (keep existing IDs in your HTML)
const chips = document.getElementById('chips');
const spinBtn = document.getElementById('spinBtn');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName = document.getElementById('optName');       // checkbox
const optLogo = document.getElementById('optLogo');       // checkbox
const optStadium = document.getElementById('optStadium'); // checkbox

const currentText = document.getElementById('currentText');
const currentLogo = document.getElementById('currentLogo');

const historyEl = document.getElementById('history');

const backdrop = document.getElementById('backdrop');
const mClose = document.getElementById('mClose');

const wheel = document.getElementById('wheel'); // main canvas
const fx = document.getElementById('fx');       // reserved for future effects

// HiDPI + responsive sizing
let DPR = Math.max(1, window.devicePixelRatio || 1);
let CSS_SIZE = 640; // canvas CSS px used for layout math

const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU; // pointer at top

// Utility helpers
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;

function textColorFor(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  // Simple perceived luminance (gamma-aware)
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

// Responsive canvas sizing to container
function sizeCanvas() {
  const container = wheel.parentElement || wheel;
  const rect = container.getBoundingClientRect();
  const size = clamp(300, Math.round(rect.width || 640), 1200);
  CSS_SIZE = size;
  DPR = Math.max(1, window.devicePixelRatio || 1);

  wheel.width = Math.round(size * DPR);
  wheel.height = Math.round(size * DPR);
  fx.width = wheel.width;
  fx.height = wheel.height;

  wheel.style.width = size + 'px';
  wheel.style.height = size + 'px';
  fx.style.width = size + 'px';
  fx.style.height = size + 'px';
}

// League chips
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

// History
function saveHistory() { localStorage.setItem('clubHistory', JSON.stringify(history)); }

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

// Modal helpers
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

// Main draw
function drawWheel(){
  const data = getFiltered();
  const N = data.length || 1;

  const ctx = wheel.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw using CSS px
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const W = CSS_SIZE;
  const H = CSS_SIZE;

  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2, H/2);

  // Normalize and rotate the whole wheel by currentAngle (counterclockwise)
  const angleDraw = mod(currentAngle, TAU);
  ctx.rotate(angleDraw);

  const radius = Math.min(W,H) * 0.48;
  const slice  = TAU / N;
  const tanHalf = Math.tan(slice / 2);

  // Chord width (available width across the wedge) at radius r
  const chordWidth = (r) => Math.max(18, 2 * r * tanHalf - 16);

  // Base adaptive sizing (scale based on radius and N)
  const density = clamp(0.75, 12 / Math.max(6, N), 1.35); // fewer teams -> larger content

  const baseLogo = clamp(18, Math.round(radius * 0.11 * density), 54);
  const baseName = clamp(11, Math.round(radius * 0.062 * density), 22);
  const baseStad = clamp(9,  Math.round(radius * 0.048 * density), 16);
  const xGap     = clamp(6,  Math.round(radius * 0.02), 12); // logo <-> text
  const yGap     = clamp(2,  Math.round(baseName * 0.25), 6); // name <-> stadium

  const rimPad   = clamp(8, Math.round(radius * 0.03), 14); // keep content off the rim
  const rRow     = radius - rimPad - Math.max(baseLogo, baseName + yGap + baseStad) / 2; // row center radius

  // 1) Background slices (evenly spaced)
  for (let i=0; i<N; i++){
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

  // 2) Selected slice subtle highlight (outer rim stroke)
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

  // 3) Per-slice content: logo to the left of a text block (name above stadium)
  //    Keep text upright, prevent overlap, center row along chord.
  for (let i=0; i<N; i++) {
    const t = data[i] || {};
    const showLogo = !!(optLogo?.checked && t.logo_url);
    const showName = !!(optName?.checked && t.team_name);
    const showStad = !!(optStadium?.checked && t.stadium);

    if (!showLogo && !showName && !showStad) continue;

    const aMid = i * slice + slice / 2;

    ctx.save();

    // Clip to the wedge so nothing crosses slice or rim
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius-1, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.clip();

    // Align to wedge bisector: +x radial outward, +y along chord direction
    ctx.rotate(aMid);

    // Available width across the chord at rRow
    const availW = chordWidth(rRow);

    // Determine logo size and text widths to fit into availW
    let logoSize = showLogo ? baseLogo : 0;
    // Reserve space: [logo] xGap [textBlock]
    const textMaxW = Math.max(0, availW - (showLogo ? (logoSize + xGap) : 0));

    // Fit font sizes to textMaxW; later we still truncate if needed
    let namePx = 0, stadPx = 0;
    if (showName) {
      ctx.font = `800 ${baseName}px Inter,Arial,sans-serif`;
      namePx = fitFontSize(ctx, t.team_name, baseName, 10, textMaxW, 800);
    }
    if (showStad) {
      ctx.font = `700 ${baseStad}px Inter,Arial,sans-serif`;
      stadPx = fitFontSize(ctx, t.stadium, baseStad, 9, textMaxW, 700);
    }

    // Row composition geometry along local +y axis (tangential)
    // We center the entire row on y=0 so it's symmetric within the chord.
    const textBlockH = (showName ? namePx : 0) + (showStad ? (yGap + stadPx) : 0);
    const rowH = Math.max(showLogo ? logoSize : 0, textBlockH);

    const rowW = (showLogo ? logoSize : 0) + (showLogo && (showName || showStad) ? xGap : 0) + textMaxW;

    // We center the row in local +y direction [-rowW/2 .. +rowW/2]
    const yStart = -rowW / 2;

    // Compute positions in the rotated frame, then draw upright by unrotating for each item.

    // Logo
    if (showLogo) {
      const yLogoCenter = yStart + (logoSize / 2);

      ctx.save();
      // Move to row anchor (rRow along +x), then to logo center along +y
      ctx.translate(rRow, yLogoCenter);
      // Keep the logo upright relative to page
      ctx.rotate(-aMid);

      ctx.save();
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

      ctx.restore();
    }

    // Text block (aligned left after logo)
    if (showName || showStad) {
      const yTextLeft = yStart + (showLogo ? (logoSize + xGap) : 0);

      // Text lines are drawn upright, left-aligned, clipped by the wedge
      const fg = textColorFor(t.primary_color);

      // Name
      if (showName) {
        ctx.save();
        ctx.translate(rRow, yTextLeft);
        ctx.rotate(-aMid); // upright

        ctx.font = `800 ${namePx}px Inter,Arial,sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.strokeStyle = 'rgba(12,16,28,0.85)';
        ctx.lineWidth = Math.max(1, Math.round(namePx / 9));
        ctx.fillStyle = fg;

        const nameStr = truncateToWidth(ctx, t.team_name, textMaxW);
        // Draw with subtle contrast stroke
        ctx.strokeText(nameStr, 0, 0);
        ctx.fillText(nameStr, 0, 0);

        ctx.restore();
      }

      // Stadium (below name)
      if (showStad) {
        ctx.save();
        ctx.translate(rRow, yTextLeft + (showName ? (yGap + namePx) : 0));
        ctx.rotate(-aMid); // upright

        ctx.font = `700 ${stadPx}px Inter,Arial,sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.strokeStyle = 'rgba(12,16,28,0.75)';
        ctx.lineWidth = Math.max(1, Math.round(stadPx / 9));
        ctx.fillStyle = '#D7E8FF';

        const stadStr = truncateToWidth(ctx, t.stadium || '', textMaxW);
        ctx.strokeText(stadStr, 0, 0);
        ctx.fillText(stadStr, 0, 0);

        ctx.restore();
      }
    }

    ctx.restore();
  }

  ctx.restore();
}

// Spin logic with precise pointer snapping
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

  // Randomized target angle (several full turns + random offset)
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
      const offset = mod(POINTER_ANGLE - theta, TAU); // pointer ahead of wheel zero
      let idx = Math.floor(offset / slice) % N;

      // Snap angle so the chosen slice's CENTER aligns exactly under the pointer
      const centerAngleOfIdx = idx * slice + slice/2;
      const snapDelta = mod(centerAngleOfIdx - offset, TAU);
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

// Events
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

  // Responsive redraw on resize (debounced)
  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => {
      sizeCanvas();
      drawWheel();
    }, 120);
  }, { passive: true });
}

// Boot
fetch('./teams.json')
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    renderChips();
    renderHistory();
    sizeCanvas(); // responsive + HiDPI setup
    drawWheel();  // initial render
    setupEventListeners();
  });
