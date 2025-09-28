// Football Club Spinner — app.js
// Vertically aligned (radial) stack per slice: Logo -> Name -> Stadium.
// Guaranteed not to overlap and fully contained within each triangle (slice).
// Responsive (auto-resizes), HiDPI crisp, and safe fallbacks (scaling + ellipsis).

let TEAMS = [];
let currentAngle = 0;
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// DOM
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
const wheel = document.getElementById('wheel');
const fx = document.getElementById('fx'); // reserved
const mClose = document.getElementById('mClose');

// HiDPI + responsive sizing
let DPR = Math.max(1, window.devicePixelRatio || 1);
let CSS_SIZE = 640; // canvas CSS px used for math

// Utils
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));

// Image cache to avoid repeated loads
const IMG_CACHE = new Map();
function withImage(url, cb) {
  if (!url) return;
  if (IMG_CACHE.has(url)) {
    const img = IMG_CACHE.get(url);
    if (img.complete) cb(img);
    else img.addEventListener('load', () => cb(img), { once: true });
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  IMG_CACHE.set(url, img);
  if (img.complete) cb(img);
  else img.addEventListener('load', () => cb(img), { once: true });
}

// Size canvas to container (responsive)
function sizeCanvas() {
  const container = wheel.parentElement || wheel;
  const rect = container.getBoundingClientRect();
  const size = clamp(280, Math.round(rect.width || 640), 1100);
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

// UI helpers
function renderChips() {
  const leagues = [...new Set(TEAMS.map(t => t.league_code))];
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

// Modal
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

// Contrast helper
function textColorFor(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}

const TAU = Math.PI * 2;

// Fit helpers
function fitFontSize(ctx, text, targetPx, minPx, maxWidth, weight = 700) {
  let size = Math.round(targetPx);
  while (size >= minPx) {
    ctx.font = `${weight} ${size}px Inter,Arial,sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  return minPx;
}
function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = '…';
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const s = text.slice(0, mid) + ell;
    if (ctx.measureText(s).width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  const cut = Math.max(0, lo - 1);
  return text.slice(0, cut) + ell;
}

// Main draw (vertical aligned, no overlap, inside slice)
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

  const angleDraw = ((currentAngle % TAU) + TAU) % TAU;
  ctx.rotate(angleDraw);

  const radius = Math.min(W,H) * 0.48;
  const slice  = TAU / N;
  const tanHalf = Math.tan(slice/2);

  // chord width at radius r (minus a small padding)
  const chordWidth = (r) => Math.max(16, 2 * r * tanHalf - 10);

  // 1) Background slices
  for (let i=0;i<N;i++){
    const t = data[i] || {};
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // 2) Content per slice
  for (let i=0;i<N;i++){
    const t = data[i] || {};
    const wantLogo = !!(optLogo.checked && t.logo_url);
    const wantName = !!(optName.checked && t.team_name);
    const wantStad = !!(optStadium.checked && t.stadium);
    if (!wantLogo && !wantName && !wantStad) continue;

    const angle = i*slice + slice/2;

    // Clip to the wedge so nothing can spill out of the triangle or the circle
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius-2, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.clip();

    // Rotate so +x is along the slice bisector (radial line we stack on)
    ctx.rotate(angle);

    // Base sizes as function of radius
    let logoSize = wantLogo ? clamp(18, Math.round(radius * 0.12), 56) : 0;
    let namePx   = wantName ? clamp(11, Math.round(radius * 0.06), 22) : 0;
    let stadPx   = wantStad ? clamp(9,  Math.round(radius * 0.045), 16) : 0;

    const rimPad = clamp(6, Math.round(radius*0.015), 10); // keep off the rim
    const rInner = radius * 0.30; // stay away from apex (narrow)
    const rOuter = radius - rimPad;

    // Radial spacing between items (no overlap along radial axis)
    const rGap   = clamp(6, Math.round(radius * 0.03), 18);

    // Prepare item models in the drawing order (center -> edge)
    // We align everything on y=0 so they’re “vertically” (tangent-wise) centered.
    const items = [];
    if (wantLogo) items.push({ kind: 'logo',    size: logoSize, weight: 0,   text: '',                minSize: 16 });
    if (wantName) items.push({ kind: 'name',    size: namePx,   weight: 800, text: t.team_name,      minSize: 10 });
    if (wantStad) items.push({ kind: 'stadium', size: stadPx,   weight: 700, text: t.stadium || '',  minSize: 9  });

    // Measure widths at a generous radius
    const generousWidth = chordWidth(rOuter);
    for (const it of items) {
      if (it.kind === 'logo') {
        it.w = it.size; // square
        it.h = it.size;
      } else {
        // Fit font to generous width
        it.size = fitFontSize(ctx, it.text, it.size, it.minSize, generousWidth, it.weight);
        ctx.font = `${it.weight} ${it.size}px Inter,Arial,sans-serif`;
        it.w = ctx.measureText(it.text).width;
        it.h = Math.round(it.size * (it.kind === 'name' ? 1.10 : 1.05));
      }
    }

    // Compute radial positions ensuring: width fits chord, no overlap, inside rim
    const rPos = [];
    let lastCenter = rInner - rGap; // so first item can start at rInner

    for (let k = 0; k < items.length; k++) {
      const it = items[k];

      // Minimal r to fit width
      const neededRForWidth = (it.w + 8) / (2 * tanHalf);
      // Minimal r to avoid overlapping previous (center distance):
      const neededRForSep = lastCenter + (k === 0 ? 0 : (items[k-1].h/2 + it.h/2 + rGap));

      let rNeeded = Math.max(rInner + it.h/2, neededRForWidth, neededRForSep);

      // If beyond rim, scale down to fit and clamp to rim
      if (rNeeded + it.h/2 > rOuter) {
        const maxCenter = rOuter - it.h/2;
        // scale for height (radial constraint)
        const space = Math.max(6, rOuter - (k === 0 ? rInner : (lastCenter + items[k-1].h/2 + rGap)));
        let sH = space / it.h; // <=1
        sH = clamp(0.5, sH, 1);

        // scale for width at the maxCenter chord
        const maxW = chordWidth(maxCenter) - 8;
        let sW = 1;
        if (it.w > maxW) sW = clamp(0.5, maxW / it.w, 1);

        const s = Math.min(sH, sW, 1);

        // Apply scaling (respect minSize)
        if (it.kind === 'logo') {
          it.size = Math.max(it.minSize, Math.floor(it.size * s));
          it.w = it.size; it.h = it.size;
        } else {
          it.size = Math.max(it.minSize, Math.floor(it.size * s));
          ctx.font = `${it.weight} ${it.size}px Inter,Arial,sans-serif`;
          it.w = ctx.measureText(it.text).width;
          it.h = Math.round(it.size * (it.kind === 'name' ? 1.10 : 1.05));
        }
        // Recompute position after scaling
        const neededRForWidth2 = (it.w + 8) / (2 * tanHalf);
        const neededRForSep2 = lastCenter + (k === 0 ? 0 : (items[k-1].h/2 + it.h/2 + rGap));
        rNeeded = Math.max(rInner + it.h/2, neededRForWidth2, neededRForSep2);
        rNeeded = Math.min(rNeeded, rOuter - it.h/2);
      }

      // Final clamp inside rim
      rNeeded = Math.min(rNeeded, rOuter - it.h/2);
      rPos.push(rNeeded);
      lastCenter = rNeeded;
    }

    // Colors
    const fg = textColorFor(t.primary_color);

    // Draw items centered at y=0 (vertical alignment), rotated upright
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      const centerR = rPos[k];

      ctx.save();
      ctx.translate(centerR, 0);
      ctx.rotate(-angle); // keep upright

      if (it.kind === 'logo') {
        withImage(t.logo_url, (img) => {
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.7)";
          ctx.shadowBlur = 8;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2;
          ctx.drawImage(img, -it.size/2, -it.size/2, it.size, it.size);
          ctx.restore();
        });
      } else {
        // If text still too wide at this center, truncate to width
        const maxW = chordWidth(centerR) - 8;
        ctx.font = `${it.weight} ${it.size}px Inter,Arial,sans-serif`;
        let text = it.text;
        if (ctx.measureText(text).width > maxW) {
          text = truncateToWidth(ctx, text, maxW);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (it.kind === 'name') {
          ctx.fillStyle = fg;
          ctx.strokeStyle = 'rgba(20,28,46,0.85)';
        } else {
          ctx.fillStyle = '#D7E8FF';
          ctx.strokeStyle = 'rgba(20,28,46,0.75)';
        }
        ctx.lineWidth = Math.max(1, Math.round(it.size / 9));
        ctx.strokeText(text, 0, 0);
        ctx.fillText(text, 0, 0);
      }

      ctx.restore();
    }

    ctx.restore(); // clip + rotation
  }

  ctx.restore();
}

// Result + spin
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
  const extraTurns  = 6 + Math.floor(Math.random()*2);
  const finalOffset = Math.random()*TAU;
  const targetAngle = TAU*extraTurns + finalOffset;
  const start    = performance.now();
  const duration = 3000;
  const easeOutCubic = x => 1 - Math.pow(1-x, 3);

  function anim(t){
    const p = Math.min(1, (t - start) / duration);
    currentAngle = targetAngle * easeOutCubic(p);
    drawWheel();

    if (p < 1){
      requestAnimationFrame(anim);
    } else {
      const theta = ((currentAngle % TAU) + TAU) % TAU;
      const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU; // top
      let idx = Math.round(((POINTER_ANGLE - theta - slice/2 + TAU) % TAU) / slice) % N;

      currentAngle = ((currentAngle + ((POINTER_ANGLE - ((theta + idx*slice + slice/2) % TAU) + TAU) % TAU)) % TAU);
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
