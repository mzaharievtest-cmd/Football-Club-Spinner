// Football Club Spinner — app.js
// Updated: stacked per-slice content (Logo -> Name -> Stadium), upright,
// with a subtle drop shadow on the logo. Works with or without the Stadium toggle.

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

// Draw wheel with solid color slices.
// Then for each slice, stack: Logo (with drop shadow) -> Name -> Stadium.
// All elements are kept upright and centered along the slice bisector.
function drawWheel(){
  const data = getFiltered();
  const N = data.length || 1;
  const W = wheel.width, H = wheel.height;
  const ctx = wheel.getContext('2d');

  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2, H/2);

  const angleDraw = ((currentAngle % TAU) + TAU) % TAU;
  ctx.rotate(angleDraw);

  const radius = Math.min(W,H) * 0.48;
  const slice  = TAU / N;

  // 1) Background slices
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, i*slice, (i+1)*slice);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // 2) Per-slice stacked content (Logo -> Name -> Stadium), kept upright
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const items = [];
    if (optLogo.checked && t.logo_url) items.push('logo');
    if (optName.checked && t.team_name) items.push('name');
    if (optStadium.checked && t.stadium) items.push('stadium');
    if (!items.length) continue;

    const angle = i*slice + slice/2;

    // Work in the slice's direction for positioning
    ctx.save();
    ctx.rotate(angle);

    // Where to place the stack, along the slice bisector
    const rStack = radius * 0.68; // move closer/farther from center if needed
    const gap = 6;
    const heights = { logo: 36, name: 18, stadium: 14 };
    const totalH = items.reduce((sum, k) => sum + heights[k], 0) + gap * (items.length - 1);
    let yCursor = -totalH / 2;

    for (const k of items) {
      const h = heights[k];
      const yCenter = yCursor + h/2;

      // Translate outward along slice axis, then unrotate so content is upright
      ctx.save();
      ctx.translate(rStack, yCenter);
      ctx.rotate(-angle);

      if (k === 'logo') {
        const img = new Image();
        img.src = t.logo_url;
        const drawImg = () => {
          ctx.save();
          // Dark drop shadow (cheap and effective)
          ctx.shadowColor = "rgba(0,0,0,0.7)";
          ctx.shadowBlur = 6;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2;
          ctx.drawImage(img, -18, -18, 36, 36);
          ctx.restore();
        };
        if (img.complete) drawImg(); else img.onload = drawImg;
      } else if (k === 'name') {
        ctx.font = 'bold 16px Inter,Arial,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = textColorFor(t.primary_color);
        ctx.strokeStyle = '#222b3e';
        ctx.lineWidth = 2;
        ctx.strokeText(t.team_name, 0, 0);
        ctx.fillText(t.team_name, 0, 0);
      } else if (k === 'stadium') {
        ctx.font = '13px Inter,Arial,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#C9E6FF';
        ctx.strokeStyle = '#222b3e';
        ctx.lineWidth = 2;
        ctx.strokeText(t.stadium, 0, 0);
        ctx.fillText(t.stadium, 0, 0);
      }

      ctx.restore();
      yCursor += h + gap;
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

// Boot
fetch('./teams.json')
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    renderChips();
    renderHistory();
    drawWheel();
    setupEventListeners();
  });
