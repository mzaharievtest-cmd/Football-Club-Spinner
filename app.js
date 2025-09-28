u8ii89// Football Club Spinner — app.js
// Vertically aligned stack per slice (Logo -> Name -> Stadium), clipped to slice,
// responsive (auto-resizes), HiDPI crisp, and fit-to-slice so content always
// stays inside its triangle without overlapping neighbors.

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
const fx = document.getElementById('fx'); // reserved (not used)
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

  // Function: available width across the slice at distance r from center
  const availWidthAt = (r) => Math.max(20, 2 * r * tanHalf - 8);

  // 1) Background slices (solid)
  for(let i=0;i<N;i++){
    const t = data[i] || {};
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // 2) Content per slice (stacked along bisector, upright), clipped to slice
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const showLogo = !!(optLogo.checked && t.logo_url);
    const showName = !!(optName.checked && t.team_name);
    const showStad = !!(optStadium.checked && t.stadium);

    if (!showLogo && !showName && !showStad) continue;

    const angle = i*slice + slice/2;

    // Clip to slice so no bleeding across triangles
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius-2, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.clip();

    // Rotate into slice direction (bisector)
    ctx.rotate(angle);

    // Base sizes from radius
    let logoSize = showLogo ? clamp(20, Math.round(radius * 0.12), 60) : 0;
    let namePx   = showName ? clamp(11, Math.round(radius * 0.06), 22) : 0;
    let stadPx   = showStad ? clamp(9,  Math.round(radius * 0.045), 16) : 0;
    const gap    = clamp(4, Math.round(radius * 0.02), 12);

    // Initial stack radius candidate
    const rMin   = radius * 0.48; // prevent too close to center (narrow width)
    const rMax   = radius * 0.86; // keep away from rim
    let   rStack = radius * 0.66;

    // Compute max allowed width at rStack
    let maxW = availWidthAt(rStack);

    // Measure widths; fit fonts to maxW
    if (showName) namePx = fitFontSize(ctx, t.team_name, namePx, 10, maxW, 800);
    if (showStad) stadPx = fitFontSize(ctx, t.stadium,  stadPx, 9,  maxW, 700);

    // Re-measure with decided sizes
    let nameW = 0, stadW = 0;
    if (showName) { ctx.font = `800 ${namePx}px Inter,Arial,sans-serif`; nameW = ctx.measureText(t.team_name).width; }
    if (showStad) { ctx.font = `700 ${stadPx}px Inter,Arial,sans-serif`; stadW = ctx.measureText(t.stadium).width; }
    const logoW = showLogo ? logoSize : 0;
    const widest = Math.max(logoW, nameW, stadW);

    // If widest exceeds current maxW, try moving outward (wider chord).
    if (widest > maxW) {
      const neededR = (widest + 8) / (2 * tanHalf); // r >= (width+pad)/(2*tanHalf)
      rStack = clamp(rMin, neededR, rMax);
      maxW = availWidthAt(rStack);

      // Still too wide? Scale items uniformly to fit.
      if (widest > maxW) {
        const scale = maxW / widest;
        if (showLogo) logoSize = Math.max(16, Math.floor(logoSize * scale));
        if (showName) namePx   = Math.max(10, Math.floor(namePx * scale));
        if (showStad) stadPx   = Math.max(9,  Math.floor(stadPx * scale));
        // Update widths after scaling
        if (showName) { ctx.font = `800 ${namePx}px Inter,Arial,sans-serif`; nameW = ctx.measureText(t.team_name).width; }
        if (showStad) { ctx.font = `700 ${stadPx}px Inter,Arial,sans-serif`; stadW = ctx.measureText(t.stadium).width; }
      }
    }

    // Compute vertical layout
    const items = [];
    if (showLogo) items.push({ type:'logo',    h: logoSize });
    if (showName) items.push({ type:'name',    h: Math.round(namePx * 1.1), px: namePx });
    if (showStad) items.push({ type:'stadium', h: Math.round(stadPx * 1.05), px: stadPx });

    const totalH = items.reduce((s,it)=> s + it.h, 0) + gap * (items.length - 1);
    let yCursor = -Math.round(totalH / 2);

    const fg = textColorFor(t.primary_color);

    // Draw each item centered on bisector, then unrotate to keep upright
    for (const it of items) {
      const yCenter = yCursor + Math.round(it.h/2);

      ctx.save();
      ctx.translate(rStack, yCenter);
      ctx.rotate(-angle);

      if (it.type === 'logo') {
        withImage(t.logo_url, (img) => {
          ctx.save();
          // Subtle shadow to separate from bright slices
          ctx.shadowColor = "rgba(0,0,0,0.7)";
          ctx.shadowBlur = 8;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2;
          const s = logoSize;
          ctx.drawImage(img, -s/2, -s/2, s, s);
          ctx.restore();
        });
      } else if (it.type === 'name') {
        ctx.font = `800 ${it.px}px Inter,Arial,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = fg;
        ctx.strokeStyle = 'rgba(20,28,46,0.85)';
        ctx.lineWidth = Math.max(1, Math.round(it.px/9));
        ctx.strokeText(t.team_name, 0, 0);
        ctx.fillText(t.team_name, 0, 0);
      } else if (it.type === 'stadium') {
        ctx.font = `700 ${it.px}px Inter,Arial,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#D7E8FF';
        ctx.strokeStyle = 'rgba(20,28,46,0.75)';
        ctx.lineWidth = Math.max(1, Math.round(it.px/9));
        ctx.strokeText(t.stadium, 0, 0);
        ctx.fillText(t.stadium, 0, 0);
      }

      ctx.restore();
      yCursor += it.h + gap;
    }

    ctx.restore(); // clip + rotation
  }

  ctx.restore();
}

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
      // Determine index under the pointer (top)
      const theta = ((currentAngle % TAU) + TAU) % TAU;
      const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU; // top
      const N = getFiltered().length || 1;
      const slice = TAU / N;
      let idx = Math.round(((POINTER_ANGLE - theta - slice/2 + TAU) % TAU) / slice) % N;

      // Snap angle so the chosen slice is exactly under the pointer
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
