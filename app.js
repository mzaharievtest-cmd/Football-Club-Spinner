// Football Club Spinner — app.js
// Vertically aligned (radial) stack per slice: Logo -> Name -> Stadium.
// Guaranteed to fit inside its triangle (slice), no overlap, responsive, HiDPI crisp.

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
  img.src = url;
  IMG_CACHE.set(url, img);
  if (img.complete) cb(img);
  else img.addEventListener('load', () => cb(img), { once: true });
}

// Responsive canvas sizing to container
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

// Contrast helper: returns dark text for light colors and white for dark colors
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

  // Chord width available at distance r
  const chordWidth = (r) => Math.max(20, 2 * r * tanHalf - 10);

  // 1) Background slices
  for(let i=0;i<N;i++){
    const t = data[i] || {};
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // 2) Content per slice (radial stack), clipped to slice
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const showLogo = !!(optLogo.checked && t.logo_url);
    const showName = !!(optName.checked && t.team_name);
    const showStad = !!(optStadium.checked && t.stadium);
    if (!showLogo && !showName && !showStad) continue;

    const angle = i*slice + slice/2;

    ctx.save();
    // Clip wedge
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius-2, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.clip();

    // Rotate into the slice's bisector. x-axis = radial, y-axis = across-chord.
    ctx.rotate(angle);

    // Base sizes from radius
    let logoSize = showLogo ? clamp(20, Math.round(radius * 0.12), 60) : 0;
    let namePx   = showName ? clamp(11, Math.round(radius * 0.06), 22) : 0;
    let stadPx   = showStad ? clamp(9,  Math.round(radius * 0.045), 16) : 0;

    // Radial spacing (gap between items along radial axis)
    const rGap   = clamp(6, Math.round(radius * 0.03), 18);

    // Radial bounds to keep stack inside triangle nicely
    const rInner = radius * 0.28; // away from apex (narrow)
    const rOuter = radius * 0.86; // away from rim

    // We stack OUTWARDS along radial axis: logo (nearer center) -> name -> stadium.
    // For each item, pick the minimal r where its width fits the chord.
    // Also ensure radial separation (no overlapping) using item "heights".

    const items = [];
    if (showLogo) items.push({ type: 'logo',    size: logoSize, h: logoSize, w: logoSize, weight: 0 });
    if (showName) items.push({ type: 'name',    size: namePx,   h: Math.round(namePx*1.1), w: 0, weight: 800, text: t.team_name });
    if (showStad) items.push({ type: 'stadium', size: stadPx,   h: Math.round(stadPx*1.05), w: 0, weight: 700, text: t.stadium   });

    // Pre-fit text widths at a generous chord (rOuter) so we have initial sizes
    const generousWidth = chordWidth(rOuter);
    for (const it of items) {
      if (it.type === 'name') {
        it.size = fitFontSize(ctx, it.text, it.size, 10, generousWidth, it.weight);
        ctx.font = `${it.weight} ${it.size}px Inter,Arial,sans-serif`;
        it.w = ctx.measureText(it.text).width;
      } else if (it.type === 'stadium') {
        it.size = fitFontSize(ctx, it.text, it.size, 9, generousWidth, it.weight);
        ctx.font = `${it.weight} ${it.size}px Inter,Arial,sans-serif`;
        it.w = ctx.measureText(it.text).width;
      } else if (it.type === 'logo') {
        it.w = it.size;
      }
    }

    const positions = [];
    let rCursor = rInner;

    for (let k = 0; k < items.length; k++) {
      const it = items[k];

      // Minimal radius to fit width
      const neededRForWidth = (it.w + 8) / (2 * tanHalf);
      let rNeeded = Math.max(rInner, neededRForWidth);

      // Radial separation from previous item
      if (k > 0) {
        const prev = items[k-1];
        // Half heights + gap along radial line
        const sep = (prev.h/2) + (it.h/2) + rGap;
        rNeeded = Math.max(rNeeded, positions[k-1] + sep);
      }

      // Clamp within outer bound
      if (rNeeded > rOuter) {
        // Too wide/large; scale it to fit at rOuter
        const maxW = chordWidth(rOuter) - 8;
        if (it.type === 'logo') {
          const scale = Math.max(0.6, maxW / it.w);
          it.size = Math.max(16, Math.floor(it.size * scale));
          it.h = it.size; it.w = it.size;
        } else {
          const scale = Math.max(0.6, maxW / it.w);
          it.size = Math.max(it.type === 'name' ? 10 : 9, Math.floor(it.size * scale));
          ctx.font = `${it.weight} ${it.size}px Inter,Arial,sans-serif`;
          it.w = ctx.measureText(it.text).width;
          it.h = Math.round(it.size * (it.type === 'name' ? 1.1 : 1.05));
        }
        rNeeded = rOuter; // place at the outer limit after scaling
      }

      positions.push(rNeeded);
      rCursor = rNeeded;
    }

    const fg = textColorFor(t.primary_color);

    // Draw items at computed radii, centered on y=0 (vertical alignment)
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      const rPos = positions[k];

      ctx.save();
      ctx.translate(rPos, 0); // along radial axis
      ctx.rotate(-angle);     // keep content upright

      if (it.type === 'logo') {
        withImage(t.logo_url, (img) => {
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.7)";
          ctx.shadowBlur = 8;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2;
          const s = it.size;
          ctx.drawImage(img, -s/2, -s/2, s, s);
          ctx.restore();
        });
      } else if (it.type === 'name') {
        ctx.font = `800 ${it.size}px Inter,Arial,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = fg;
        ctx.strokeStyle = 'rgba(20,28,46,0.85)';
        ctx.lineWidth = Math.max(1, Math.round(it.size/9));
        ctx.strokeText(it.text, 0, 0);
        ctx.fillText(it.text, 0, 0);
      } else if (it.type === 'stadium') {
        ctx.font = `700 ${it.size}px Inter,Arial,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#D7E8FF';
        ctx.strokeStyle = 'rgba(20,28,46,0.75)';
        ctx.lineWidth = Math.max(1, Math.round(it.size/9));
        ctx.strokeText(it.text, 0, 0);
        ctx.fillText(it.text, 0, 0);
      }

      ctx.restore();
    }

    ctx.restore(); // clip + rotation
  }

  ctx.restore();
}

// Result and spin
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
      const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
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
