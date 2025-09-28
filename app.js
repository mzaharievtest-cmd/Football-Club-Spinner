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
const fx = document.getElementById('fx');
const mClose = document.getElementById('mClose');

// High-DPI support
let DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));
let CSS_SIZE = 640; // current CSS pixel size used for drawing calculations

function sizeCanvas() {
  // Use the rendered width of the canvas (CSS pixels) as our base
  const rect = wheel.getBoundingClientRect();
  const size = Math.max(320, Math.round(rect.width || 640)); // min 320 for safety
  CSS_SIZE = size;

  // Set backing store size in device pixels
  wheel.width = Math.round(size * DPR);
  wheel.height = Math.round(size * DPR);
  fx.width = wheel.width;
  fx.height = wheel.height;

  // Ensure CSS size matches the measured size
  wheel.style.width = size + 'px';
  wheel.style.height = size + 'px';
  fx.style.width = size + 'px';
  fx.style.height = size + 'px';
}

window.addEventListener('resize', () => {
  DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  sizeCanvas();
  drawWheel();
});

// Image cache for logos to avoid reloading each draw
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

function textColorFor(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}

const TAU = Math.PI * 2;

// Draw wheel with stacked elements per slice based on checkboxes; crisp on high-DPI
function drawWheel(){
  const data = getFiltered();
  const N = data.length || 1;

  const ctx = wheel.getContext('2d', { alpha: true });
  // Map device pixels back to CSS pixels so our math is in CSS units
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const W = CSS_SIZE;
  const H = CSS_SIZE;

  ctx.clearRect(0, 0, W, H);

  const radius = Math.min(W,H) * 0.48;
  const slice  = TAU / N;

  ctx.save();
  ctx.translate(Math.round(W/2), Math.round(H/2));

  // Rotate whole wheel by currentAngle
  const angleDraw = ((currentAngle % TAU) + TAU) % TAU;
  ctx.rotate(angleDraw);

  // 1) Draw background slices
  for(let i=0;i<N;i++){
    const t = data[i] || {};
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // 2) Draw content in each slice (stacked vertically)
  for (let i=0;i<N;i++){
    const t = data[i] || {};

    // Build stack (logo -> name -> stadium) depending on toggles
    const items = [];
    if (optLogo.checked && t.logo_url) items.push({type:'logo', h:40});
    if (optName.checked && t.team_name) items.push({type:'name', h:22});
    if (optStadium.checked && t.stadium) items.push({type:'stadium', h:18});

    if (items.length === 0) continue;

    // Rotate into slice so +x points along slice bisector; draw along that axis.
    ctx.save();
    ctx.rotate(i*slice + slice/2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const rStack = radius * 0.64; // keep safely inside the wheel
    const gap = 6;
    const totalH = items.reduce((s,it)=> s+it.h, 0) + gap*(items.length-1);
    let yCursor = -totalH/2;

    for (const it of items) {
      const yCenter = Math.round(yCursor + it.h/2);

      if (it.type === 'logo') {
        withImage(t.logo_url, (img) => {
          // drawImage expects top-left and size; keep 40x40 for clarity
          ctx.drawImage(img, Math.round(rStack - 20), Math.round(yCenter - 20), 40, 40);
        });
      } else if (it.type === 'name') {
        ctx.font = '700 18px Inter,Arial,sans-serif';
        ctx.fillStyle = textColorFor(t.primary_color);
        ctx.strokeStyle = 'rgba(12,16,28,0.85)';
        ctx.lineWidth = 2;
        ctx.strokeText(t.team_name, Math.round(rStack), yCenter);
        ctx.fillText(t.team_name, Math.round(rStack), yCenter);
      } else if (it.type === 'stadium') {
        ctx.font = '600 13px Inter,Arial,sans-serif';
        ctx.fillStyle = '#D7E8FF';
        ctx.strokeStyle = 'rgba(12,16,28,0.75)';
        ctx.lineWidth = 2;
        ctx.strokeText(t.stadium, Math.round(rStack), yCenter);
        ctx.fillText(t.stadium, Math.round(rStack), yCenter);
      }

      yCursor += it.h + gap;
    }
    ctx.restore();
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
      // Normalize and compute selected index under the pointer (top)
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
}

// Load teams.json and initialize app
fetch('./teams.json')
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    renderChips();
    renderHistory();
    sizeCanvas();     // set high-DPI sizes
    drawWheel();      // initial render
    setupEventListeners();
  });
