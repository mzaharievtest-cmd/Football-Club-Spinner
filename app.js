// Football Club Spinner — Responsive + Fit-to-slice app.js
// - Canvas auto-sizes to container, HiDPI crisp via devicePixelRatio
// - Per-slice stacked content: Logo -> Name -> Stadium (upright, honors checkboxes)
// - Dynamically fits fonts and logo to the slice's available width
// - Redraws on resize for all resolutions (including mobile)

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
const fx = document.getElementById('fx'); // reserved for effects
const mClose = document.getElementById('mClose');

// HiDPI + responsive sizing
let DPR = Math.max(1, window.devicePixelRatio || 1);
let CSS_SIZE = 640; // canvas size in CSS pixels (used for layout math)

// Utility
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));

// Cache images so we don't reload logos every draw
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

// Size canvas to container (responsive)
function sizeCanvas() {
  // Use the .wheel-wrap container width to determine size
  const container = wheel.parentElement || wheel;
  const rect = container.getBoundingClientRect();

  // Pick the largest square that fits the container's width, with sensible bounds
  const size = clamp(280, Math.round(rect.width || 640), 1000);

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

// Build league chips
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

// Filtering
function getFiltered() {
  const active = Array.from(chips.querySelectorAll('input:checked')).map(i => i.value);
  return TEAMS.filter(t => active.includes(t.league_code));
}

// History helpers
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

// Contrast helper for text against slice color
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
  let size = targetPx;
  while (size >= minPx) {
    ctx.font = `${weight} ${size}px Inter,Arial,sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  return minPx;
}

// Main draw (responsive + HiDPI + fit-to-slice)
function drawWheel(){
  const data = getFiltered();
  const N = data.length || 1;

  const ctx = wheel.getContext('2d');
  // Map device pixels to CSS pixels so our math uses CSS units
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
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

  // Available width at a radial distance r (straight chord width for the slice)
  const availWidthAt = (r) => Math.max(24, 2 * r * Math.tan(slice / 2) - 10);

  // Adaptive base sizes (will be fitted per-slice)
  const baseLogoSize = clamp(22, Math.round(radius * 0.12), 56);
  const baseNamePx = clamp(12, Math.round(radius * 0.06), 22);
  const baseStadiumPx = clamp(10, Math.round(radius * 0.045), 16);
  const baseGap = clamp(4, Math.round(radius * 0.02), 12);

  // Where stack is placed along the slice bisector
  const rStackBase = radius * 0.66;

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

  // 2) Content (Logo -> Name -> Stadium), upright, fitted to slice width
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const wantLogo = optLogo.checked && t.logo_url;
    const wantName = optName.checked && t.team_name;
    const wantStad = optStadium.checked && t.stadium;

    if (!wantLogo && !wantName && !wantStad) continue;

    const angle = i*slice + slice/2;

    // Clip to slice to avoid spill
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius-2, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.clip();

    // Align to slice direction
    ctx.rotate(angle);

    // Compute available width at the stack radius
    const rStack = rStackBase;
    const maxW = availWidthAt(rStack);

    // Fit sizes per content
    // Logo
    const logoSize = wantLogo ? Math.min(baseLogoSize, Math.max(18, Math.floor(maxW - 8))) : 0;

    // Name font (fit to width)
    let namePx = 0;
    if (wantName) {
      namePx = fitFontSize(ctx, t.team_name, baseNamePx, 10, maxW, 800);
    }

    // Stadium font (fit to width)
    let stadPx = 0;
    if (wantStad) {
      stadPx = fitFontSize(ctx, t.stadium, baseStadiumPx, 9, maxW, 700);
    }

    const gap = baseGap;

    // Heights for stacking (approx line boxes)
    const items = [];
    if (wantLogo)   items.push({type:'logo',   h: logoSize});
    if (wantName)   items.push({type:'name',   h: Math.round(namePx * 1.15), px: namePx});
    if (wantStad)   items.push({type:'stadium',h: Math.round(stadPx * 1.10), px: stadPx});
    const totalH = items.reduce((s,it)=> s + it.h, 0) + gap * (items.length - 1);
    let yCursor = -totalH / 2;

    // Colors
    const fg = textColorFor(t.primary_color);

    for (const it of items) {
      const yCenter = Math.round(yCursor + it.h/2);

      // Place along the bisector, then unrotate so content stays upright
      ctx.save();
      ctx.translate(rStack, yCenter);
      ctx.rotate(-angle);

      if (it.type === 'logo') {
        withImage(t.logo_url, (img) => {
          ctx.save();
          // Drop shadow: cheap and effective clarity
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

    ctx.restore(); // slice clip + rotation
  }

  ctx.restore();
}

// Result
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

// Spin
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

  // Responsive: redraw on resize (with debounce)
  let resizeTO = null;
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
    sizeCanvas();     // responsive + HiDPI setup
    drawWheel();      // initial render
    setupEventListeners();
  });
