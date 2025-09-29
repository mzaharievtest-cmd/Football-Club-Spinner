// Football Club Spinner — app.js
// Polished wheel (upright labels, adaptive, no overlap, HiDPI) + Modal "reveal" logic
// New: If a toggle (Logo/Name/Stadium) is OFF, the modal shows a blurred value with a "Show" button
// Clicking "Show" reveals that specific field without changing the toggle. If ON, it shows normally.

// --------------------------- App State ---------------------------
let TEAMS = [];
let currentAngle = 0; // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];
let lastModalTeam = null; // remember current modal team to re-apply reveal on toggle change

// --------------------------- DOM ---------------------------
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
const modalEl = document.getElementById('modal');
const mClose = document.getElementById('mClose');

const wheel = document.getElementById('wheel');
const fx = document.getElementById('fx'); // reserved

// Modal content elements (existing structure)
const mHead = document.getElementById('mHead');       // team name (text node inside)
const mSub = document.getElementById('mSub');         // league code
const mLogo = document.getElementById('mLogo');       // <img>
const mColor = document.getElementById('mColor');     // color swatch
const mColorHex = document.getElementById('mColorHex');
const mStadium = document.getElementById('mStadium'); // stadium name text

// --------------------------- Constants & Helpers ---------------------------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU; // pointer at 12 o'clock
const DEBUG = false; // set true to visualize rulers/boxes in drawWheel

const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;

function textColorFor(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}
function luminance(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return 0;
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  return 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
}
const isModalOpen = () => backdrop && backdrop.style.display === 'flex';

// Inject minimal styles for reveal buttons + blur
function ensureRevealStyles() {
  if (document.getElementById('reveal-style')) return;
  const s = document.createElement('style');
  s.id = 'reveal-style';
  s.textContent = `
    .blurred-reveal { filter: blur(6px); transition: filter .15s ease; }
    .reveal-btn {
      display: inline-block; margin-top: 8px; margin-left: 8px;
      padding: 8px 12px; border-radius: 10px;
      border: 1px solid rgba(90,161,255,.6);
      background: #152036; color: #fff; font-weight: 700; letter-spacing: .03em;
      cursor: pointer; user-select: none;
    }
    .reveal-row { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  `;
  document.head.appendChild(s);
}

// Image cache; redraw when loaded
const IMG_CACHE = new Map();
function getLogo(url, onLoad) {
  if (!url) return null;
  const cached = IMG_CACHE.get(url);
  if (cached) return cached.img;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  img.onload = () => { onLoad && onLoad(); };
  IMG_CACHE.set(url, { img });
  return img;
}

// --------------------------- Single-line fitting helpers ---------------------------
function fitSingleLine(ctx, text, {
  maxWidth,
  targetPx,
  minPx = 9,
  maxPx = 28,
  weight = 800,
  fontFamily = 'Inter, system-ui, sans-serif'
}) {
  let px = clamp(minPx, Math.round(targetPx), maxPx);
  ctx.font = `${weight} ${px}px ${fontFamily}`;
  if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px, truncated: false };

  while (px > minPx) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px, truncated: false };
  }
  // Ellipsize at character granularity
  let s = text || '';
  while (s && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return { text: (s || '').trim() + '…', fontPx: minPx, truncated: true };
}

// --------------------------- Responsive HiDPI sizing ---------------------------
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

// --------------------------- Chips / History / Modal ---------------------------
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

// Reveal helpers for modal
function applyReveal(el, enabled, btnId, labelText) {
  if (!el) return;
  // Remove prior button if exists
  const old = document.getElementById(btnId);
  if (old) old.remove();

  el.classList.remove('blurred-reveal');
  el.setAttribute('aria-hidden', 'false');

  if (enabled) {
    // fully visible, no button
    return;
  }

  // blurred view + "Show" button
  el.classList.add('blurred-reveal');
  el.setAttribute('aria-hidden', 'true');

  const btn = document.createElement('button');
  btn.id = btnId;
  btn.type = 'button';
  btn.className = 'reveal-btn';
  btn.textContent = `Show ${labelText}`;
  btn.addEventListener('click', () => {
    el.classList.remove('blurred-reveal');
    el.setAttribute('aria-hidden', 'false');
    btn.remove();
  });

  // Insert right after the element (works for img and text blocks)
  if (el.parentElement) {
    el.insertAdjacentElement('afterend', btn);
  }
}

function updateModalRevealFromToggles() {
  if (!isModalOpen() || !lastModalTeam) return;
  // Respect current toggles: visible if ON, blurred + show button if OFF
  applyReveal(mLogo, !!optLogo?.checked, 'revealLogoBtn', 'logo');
  applyReveal(mHead, !!optName?.checked, 'revealNameBtn', 'name');
  applyReveal(mStadium, !!optStadium?.checked, 'revealStadiumBtn', 'stadium');
}

function openModal(team){
  ensureRevealStyles();
  lastModalTeam = team;

  // Fill content
  if (mHead) mHead.textContent = team.team_name || '—';
  if (mSub) mSub.textContent = team.league_code || '';
  if (mLogo) mLogo.src = team.logo_url || '';
  if (mColor) mColor.style.background = team.primary_color || '#4f8cff';
  if (mColorHex) mColorHex.textContent = team.primary_color || '#4f8cff';
  if (mStadium) mStadium.textContent = team.stadium || '—';

  // Apply reveal rules based on toggles (initial state)
  updateModalRevealFromToggles();

  // Show modal
  backdrop.style.display = 'flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));
}
function closeModal(){
  modalEl.classList.remove('show');
  setTimeout(()=> backdrop.style.display='none', 150);
}

// --------------------------- WHEEL DRAWING (upright, adaptive, single-line names) ---------------------------
function drawWheel(){
  const data = getFiltered();
  const N = data.length || 1;

  const ctx = wheel.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw using CSS px
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const W = wheel.width / DPR;
  const H = wheel.height / DPR;

  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2, H/2);

  const angleDraw = mod(currentAngle, TAU);
  ctx.rotate(angleDraw);

  const radius = Math.min(W, H) * 0.48;
  const sliceAngle = TAU / N;

  // 1) Wedges
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const startAngle = i * sliceAngle;
    const endAngle   = (i + 1) * sliceAngle;

    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // 2) Selected rim stroke
  if (selectedIdx >= 0 && selectedIdx < N) {
    const a0 = selectedIdx * sliceAngle;
    const a1 = (selectedIdx + 1) * sliceAngle;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0,0, radius - 1, a0, a1);
    ctx.lineWidth = Math.max(2, Math.round(radius * 0.015));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.restore();
  }

  // 3) Slice content
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const wantLogo    = !!(optLogo?.checked && t.logo_url);
    const wantName    = !!(optName?.checked && t.team_name);
    const wantStadium = !!(optStadium?.checked && t.stadium);

    if (!wantLogo && !wantName && !wantStadium) continue;

    const startAngle = i * sliceAngle;
    const endAngle   = (i + 1) * sliceAngle;
    const midAngle   = (startAngle + endAngle) / 2;
    const sliceArc   = radius * (endAngle - startAngle);

    // Adaptive targets — keep names single-line by default
    const nameTargetPx    = clamp(11, 0.18 * sliceArc, 20);
    const stadiumTargetPx = clamp(10, 0.15 * sliceArc, 16);
    let   logoSize        = clamp(22, 0.32 * sliceArc, 52);
    const logoHalf = logoSize / 2;
    const pad = 10;

    const fg = textColorFor(t.primary_color);
    const lum = luminance(t.primary_color);

    ctx.save();

    // Clip to wedge
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius - 1, startAngle, endAngle);
    ctx.closePath();
    ctx.clip();

    // Rotate to bisector and keep upright
    ctx.rotate(midAngle);
    const needFlip = Math.cos(midAngle) < 0;
    if (needFlip) ctx.rotate(Math.PI);
    const sign = needFlip ? -1 : 1;

    // Geometry (left-to-right along radial): text block then logo
    const xLogo = sign * (radius * 0.74);
    const xText = sign * (radius * 0.42);
    const logoInner = wantLogo ? (xLogo - sign * (logoHalf + pad)) : sign * (radius * 0.86);
    const xBoxLeft = Math.min(xText, logoInner);
    const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

    // Text block
    if (wantName || wantStadium) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      let yCenter = 0;
      let namePx = nameTargetPx;

      // Name single line
      if (wantName) {
        const heavy = (lum >= 0.35 && lum <= 0.45);
        const fitted = fitSingleLine(ctx, t.team_name || '', {
          maxWidth: maxTextWidth,
          targetPx: nameTargetPx,
          minPx: 9,
          maxPx: 22,
          weight: heavy ? 900 : 800
        });
        namePx = fitted.fontPx;

        // If stadium also shown, shift name up a bit to make room for stadium
        const stadEstimate = wantStadium ? stadiumTargetPx : 0;
        const gap = wantStadium ? 4 : 0;
        const totalH = wantStadium ? (namePx + gap + stadEstimate) : namePx;
        let yName = -totalH/2 + namePx/2;

        ctx.font = `${heavy ? 900 : 800} ${namePx}px Inter, system-ui, sans-serif`;
        ctx.strokeStyle = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.85)';
        ctx.lineWidth = Math.max(1, Math.round(namePx/9));
        ctx.fillStyle = fg;
        ctx.strokeText(fitted.text, xBoxLeft, yName);
        ctx.fillText(fitted.text, xBoxLeft, yName);

        yCenter = yName; // remember for below calc
      }

      // Stadium (always attempt when toggled)
      if (wantStadium) {
        const stadFit = fitSingleLine(ctx, t.stadium || '', {
          maxWidth: maxTextWidth,
          targetPx: stadiumTargetPx,
          minPx: 8,
          maxPx: 18,
          weight: 700
        });
        const gap = wantName ? 4 : 0;
        const totalH = wantName ? (namePx + gap + stadFit.fontPx) : stadFit.fontPx;
        // name centered at -total/2 + namePx/2; stadium baseline at +total/2 - stadPx/2
        const yStad = wantName ? (totalH/2 - stadFit.fontPx/2) : 0;

        ctx.font = `700 ${stadFit.fontPx}px Inter, system-ui, sans-serif`;
        ctx.strokeStyle = 'rgba(12,16,28,0.75)';
        ctx.lineWidth = Math.max(1, Math.round(stadFit.fontPx/9));
        ctx.fillStyle = '#D7E8FF';
        ctx.strokeText(stadFit.text, xBoxLeft, yStad);
        ctx.fillText(stadFit.text, xBoxLeft, yStad);
      }

      ctx.restore();

      if (DEBUG) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0,255,255,0.6)';
        ctx.setLineDash([4,3]);
        ctx.beginPath();
        ctx.moveTo(xBoxLeft, -radius*0.04);
        ctx.lineTo(xBoxLeft,  radius*0.04);
        ctx.moveTo(xBoxLeft + maxTextWidth, -radius*0.04);
        ctx.lineTo(xBoxLeft + maxTextWidth,  radius*0.04);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Logo
    if (wantLogo) {
      ctx.save();
      ctx.translate(xLogo, 0);

      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      // ring
      ctx.beginPath();
      ctx.arc(0, 0, logoHalf, 0, TAU);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();

      // clip + image (contain)
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, logoHalf - 1, 0, TAU);
      ctx.closePath();
      ctx.clip();

      const img = getLogo(t.logo_url, () => requestAnimationFrame(drawWheel));
      if (img && img.complete) {
        const box = Math.max(4, 2 * (logoHalf - 1));
        const iw = img.naturalWidth || box, ih = img.naturalHeight || box;
        const s = Math.min(box / iw, box / ih);
        ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        const ph = (logoHalf - 3) * 2;
        ctx.fillRect(-ph/2, -ph/2, ph, ph);
      }
      ctx.restore();
      ctx.restore();
    }

    ctx.restore(); // wedge clip + rotations
  }

  ctx.restore();
}

// --------------------------- Result + Spin (unchanged) ---------------------------
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

  const extraTurns  = 6 + Math.floor(Math.random()*3);
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
      const theta = mod(currentAngle, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;

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

// --------------------------- Events / Boot ---------------------------
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

  // Wheel redraw + live modal reveal state updates
  optName.onchange = () => { drawWheel(); updateModalRevealFromToggles(); };
  optLogo.onchange = () => { drawWheel(); updateModalRevealFromToggles(); };
  optStadium.onchange = () => { drawWheel(); updateModalRevealFromToggles(); };

  spinBtn.onclick = spin;
  resetHistoryBtn.addEventListener('click', resetHistory);

  mClose.onclick = closeModal;
  backdrop.addEventListener('click', e => { if(e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(e.key==='Escape' && isModalOpen()) closeModal(); });

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

// Boot
fetch('./teams.json')
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    ensureRevealStyles();
    renderChips();
    renderHistory();
    sizeCanvas();
    drawWheel();
    setupEventListeners();
  });
