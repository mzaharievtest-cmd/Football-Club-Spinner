// Football Club Spinner — Responsive app.js
// - Responsive, crisp wheel (HiDPI aware)
// - Per-slice stacked content: Logo -> Name -> Stadium (upright, honors checkboxes)
// - Adaptive sizing by radius; logo shadow for clarity

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
const fx = document.getElementById('fx'); // kept for future effects
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

// Main draw (responsive + HiDPI)
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

  // Adaptive sizes based on radius
  const logoSize = Math.round(clamp(22, radius * 0.12, 56)); // px
  const nameFontPx = Math.round(clamp(12, radius * 0.06, 22));
  const stadiumFontPx = Math.round(clamp(10, radius * 0.045, 16));
  const gap = Math.round(clamp(4, radius * 0.02, 12));
  const rStack = radius * 0.66; // radial distance where stack is centered

  // 1) Background slices (solid club color)
  for(let i=0;i<N;i++){
    const t = data[i] || {};
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // 2) Per-slice stacked content (Logo -> Name -> Stadium), upright
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const items = [];
    if (optLogo.checked && t.logo_url) items.push({type:'logo', h:logoSize});
    if (optName.checked && t.team_name) items.push({type:'name', h:Math.round(nameFontPx*1.1)});
    if (optStadium.checked && t.stadium) items.push({type:'stadium', h:Math.round(stadiumFontPx*1.0)});
    if (!items.length) continue;

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

    const totalH = items.reduce((s,it)=> s + it.h, 0) + gap * (items.length - 1);
    let yCursor = -totalH / 2;

    for (const it of items) {
      const yCenter = Math.round(yCursor + it.h/2);

      // Place along the bisector, then unrotate so content stays upright
      ctx.save();
      ctx.translate(rStack, yCenter);
      ctx.rotate(-angle);

      if (it.type === 'logo') {
        withImage(t.logo_url, (img) => {
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.7)";
          ctx.shadowBlur = 8;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2;
          ctx.drawImage(img, -logoSize/2, -logoSize/2, logoSize, logoSize);
          ctx.restore();
        });
      } else if (it.type === 'name') {
        ctx.font = `700 ${nameFontPx}px Inter,Arial,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = textColorFor(t.primary_color);
        ctx.strokeStyle = 'rgba(20,28,46,0.8)';
        ctx.lineWidth = Math.max(1, Math.round(nameFontPx/9));
        ctx.strokeText(t.team_name, 0, 0);
        ctx.fillText(t.team_name, 0, 0);
      } else if (it.type === 'stadium') {
        ctx.font = `600 ${stadiumFontPx}px Inter,Arial,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#D7E8FF';
        ctx.strokeStyle = 'rgba(20,28,46,0.7)';
        ctx.lineWidth = Math.max(1, Math.round(stadiumFontPx/9));
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
