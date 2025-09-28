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

// HiDPI support
let DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));
let CSS_SIZE = 640; // canvas size in CSS pixels (layout/drawing math)

function sizeCanvas() {
  const rect = wheel.getBoundingClientRect();
  const size = Math.max(320, Math.round(rect.width || 640));
  CSS_SIZE = size;

  wheel.width = Math.round(size * DPR);
  wheel.height = Math.round(size * DPR);
  fx.width = wheel.width;
  fx.height = wheel.height;

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

// Image cache for logos
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

// Color and contrast helpers
function textColorFor(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}
function hexToRgb(hex) {
  if(!hex) return {r:79,g:140,b:255};
  hex = hex.replace('#','').trim();
  if (hex.length !== 6) return {r:79,g:140,b:255};
  return {
    r: parseInt(hex.slice(0,2),16),
    g: parseInt(hex.slice(2,4),16),
    b: parseInt(hex.slice(4,6),16)
  };
}
function rgbToStr({r,g,b}, a=1) {
  return `rgba(${Math.max(0,Math.min(255,r))},${Math.max(0,Math.min(255,g))},${Math.max(0,Math.min(255,b))},${a})`;
}
function tint(hex, p) {
  // p in [-1, 1]; positive lighter, negative darker
  const {r,g,b} = hexToRgb(hex);
  const t = p >= 0 ? 255 : 0;
  const f = Math.abs(p);
  return rgbToStr({
    r: Math.round(r + (t - r) * f),
    g: Math.round(g + (t - g) * f),
    b: Math.round(b + (t - b) * f)
  }, 1);
}

// Drawing helpers
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h/2, w/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

const TAU = Math.PI * 2;

// Main draw
function drawWheel(){
  const data = getFiltered();
  const N = data.length || 1;

  const ctx = wheel.getContext('2d', { alpha: true });
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw in CSS pixels
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

  // 1) Background: radial "club gradient rays"
  for(let i=0;i<N;i++){
    const t = data[i] || {};
    const base = t.primary_color || '#4f8cff';

    const g = ctx.createRadialGradient(0, 0, radius*0.06, 0, 0, radius);
    g.addColorStop(0.00, tint(base, +0.22)); // lighter near center
    g.addColorStop(0.60, tint(base,  0.00)); // base mid
    g.addColorStop(1.00, tint(base, -0.35)); // darker at edge

    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();

    // very subtle seam to clean antialias between slices
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.stroke();
  }

  // Subtle vignette / inner glow
  ctx.save();
  const overlay = ctx.createRadialGradient(0,0, radius*0.05, 0,0, radius);
  overlay.addColorStop(0.00, 'rgba(255,255,255,0.06)');
  overlay.addColorStop(0.75, 'rgba(0,0,0,0.00)');
  overlay.addColorStop(1.00, 'rgba(0,0,0,0.22)');
  ctx.beginPath();
  ctx.arc(0,0, radius, 0, TAU);
  ctx.closePath();
  ctx.fillStyle = overlay;
  ctx.fill();
  ctx.restore();

  // 2) Content per slice (stacked)
  for (let i=0;i<N;i++){
    const t = data[i] || {};
    const items = [];
    if (optLogo.checked && t.logo_url) items.push({type:'logo', h:44});
    if (optName.checked && t.team_name) items.push({type:'name', h:24});
    if (optStadium.checked && t.stadium) items.push({type:'stadium', h:18});
    if (items.length === 0) continue;

    ctx.save();
    // clip to slice so content never spills over neighboring segments
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius-2, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.clip();

    // rotate into the slice's bisector
    ctx.rotate(i*slice + slice/2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const rStack = radius * 0.64; // radial position for stack center
    const gap = 6;
    const totalH = items.reduce((s,it)=> s+it.h, 0) + gap*(items.length-1);
    let yCursor = -totalH/2;

    // colors
    const fg = textColorFor(t.primary_color);
    const pillBg = (fg === '#fff') ? 'rgba(10,16,28,0.60)' : 'rgba(255,255,255,0.72)';
    const pillStroke = (fg === '#fff') ? 'rgba(5,10,18,0.55)' : 'rgba(255,255,255,0.65)';

    for (const it of items) {
      const yCenter = Math.round(yCursor + it.h/2);
      const xCenter = Math.round(rStack);

      if (it.type === 'logo') {
        // circular badge + clipped logo + ring
        const badgeR = 22; // badge radius
        const logoR  = 19; // inner logo radius

        // soft shadow
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;

        // badge
        ctx.beginPath();
        ctx.arc(xCenter, yCenter, badgeR, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fill();
        ctx.restore();

        // clip for logo
        ctx.save();
        ctx.beginPath();
        ctx.arc(xCenter, yCenter, logoR, 0, TAU);
        ctx.clip();

        withImage(t.logo_url, (img) => {
          ctx.drawImage(img, xCenter - logoR, yCenter - logoR, logoR*2, logoR*2);
        });
        ctx.restore();

        // ring
        ctx.beginPath();
        ctx.arc(xCenter, yCenter, badgeR-0.5, 0, TAU);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(12,16,28,0.28)';
        ctx.stroke();
      }

      if (it.type === 'name') {
        ctx.font = '800 18px Inter,Arial,sans-serif';
        const text = t.team_name;
        const metrics = ctx.measureText(text);
        const w = Math.ceil(metrics.width) + 16; // padding
        const h = 24;
        // draw pill
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1.5;
        roundRect(ctx, xCenter - w/2, yCenter - h/2, w, h, 10);
        ctx.fillStyle = pillBg;
        ctx.fill();
        ctx.restore();
        // stroke for extra separation
        ctx.lineWidth = 1;
        ctx.strokeStyle = pillStroke;
        roundRect(ctx, xCenter - w/2, yCenter - h/2, w, h, 10);
        ctx.stroke();

        // text
        ctx.fillStyle = fg;
        ctx.fillText(text, xCenter, yCenter);
      }

      if (it.type === 'stadium') {
        ctx.font = '700 13px Inter,Arial,sans-serif';
        const text = t.stadium;
        const metrics = ctx.measureText(text);
        const w = Math.ceil(metrics.width) + 14;
        const h = 18;

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.22)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        roundRect(ctx, xCenter - w/2, yCenter - h/2, w, h, 9);
        ctx.fillStyle = pillBg;
        ctx.fill();
        ctx.restore();

        ctx.lineWidth = 1;
        ctx.strokeStyle = pillStroke;
        roundRect(ctx, xCenter - w/2, yCenter - h/2, w, h, 9);
        ctx.stroke();

        ctx.fillStyle = (fg === '#fff') ? '#EAF4FF' : '#0b0f17';
        ctx.fillText(text, xCenter, yCenter);
      }

      yCursor += it.h + gap;
    }

    ctx.restore(); // slice clip + rotation
  }

  ctx.restore();
}

// Spin/result logic
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
}

// Boot
fetch('./teams.json')
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    renderChips();
    renderHistory();
    sizeCanvas();     // HiDPI setup
    drawWheel();      // initial render
    setupEventListeners();
  });
