// Football Club Spinner — app.js
// Upright, adaptive wheel + Modal reveal/blur per toggle (robust with overlay fallback)

let TEAMS = [];
let currentAngle = 0; // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];
let lastModalTeam = null;

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
const modalEl = document.getElementById('modal');
const mClose = document.getElementById('mClose');

// Modal fields
const mHead = document.getElementById('mHead');       // team name (heading)
const mSub = document.getElementById('mSub');         // league code
const mLogo = document.getElementById('mLogo');       // <img>
const mColor = document.getElementById('mColor');     // color swatch
const mColorHex = document.getElementById('mColorHex');
const mStadium = document.getElementById('mStadium'); // stadium name

const wheel = document.getElementById('wheel');
const fx = document.getElementById('fx'); // reserved

// Constants / helpers
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
const DEBUG = false;

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

// Inject minimal CSS (buttons + classes). Blurs use inline styles too, for reliability.
function ensureRevealStyles() {
  if (document.getElementById('reveal-style')) return;
  const s = document.createElement('style');
  s.id = 'reveal-style';
  s.textContent = `
    .reveal-btn {
      display: inline-flex; align-items: center; justify-content: center;
      margin-top: 8px; margin-left: 10px; padding: 8px 12px;
      border-radius: 10px; border: 1px solid rgba(90,161,255,.6);
      background: #152036; color: #fff; font-weight: 700; letter-spacing: .03em;
      cursor: pointer; user-select: none;
    }
    #mHead + .reveal-btn { display: inline-block; margin-left: 0; }
    .reveal-wrap { position: relative; display: inline-block; }
    .reveal-overlay {
      position: absolute; inset: -2px;
      border-radius: inherit;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      background: rgba(15,23,42,.25);
      pointer-events: none;
    }
  `;
  document.head.appendChild(s);
}

// Image cache for wheel (modal uses its <img>)
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

// Fit a single line by shrinking font before ellipsis
function fitSingleLine(ctx, text, {
  maxWidth, targetPx, minPx = 9, maxPx = 28, weight = 800,
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
  let s = text || '';
  while (s && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0,-1);
  return { text: (s || '').trim() + '…', fontPx: minPx, truncated: true };
}

// HiDPI sizing
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

// Chips / History
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

// ---------- Modal reveal helpers (robust blur with overlay fallback) ----------
function removeExistingRevealBtn(id) {
  const old = document.getElementById(id);
  if (old) old.remove();
}
function ensureWrapped(el) {
  if (!el || !el.parentElement) return null;
  if (el.parentElement.classList.contains('reveal-wrap')) return el.parentElement;
  const wrap = document.createElement('span');
  wrap.className = 'reveal-wrap';
  // Preserve inline size by copying border-radius when present
  const cs = getComputedStyle(el);
  const br = cs.borderRadius || '';
  if (br) wrap.style.borderRadius = br;
  el.parentElement.insertBefore(wrap, el);
  wrap.appendChild(el);
  return wrap;
}
function addOverlay(el) {
  const wrap = ensureWrapped(el);
  if (!wrap) return;
  let ov = wrap.querySelector('.reveal-overlay');
  if (!ov) {
    ov = document.createElement('span');
    ov.className = 'reveal-overlay';
    wrap.appendChild(ov);
  }
}
function removeOverlay(el) {
  if (!el || !el.parentElement) return;
  const wrap = el.parentElement;
  if (wrap.classList.contains('reveal-wrap')) {
    const ov = wrap.querySelector('.reveal-overlay');
    if (ov) ov.remove();
    // optional: unwrap (skip to avoid layout jumps)
  }
}
function blurElement(el) {
  if (!el) return;
  // Inline filter with !important + webkit for stubborn CSS
  el.style.setProperty('filter', 'blur(8px) saturate(0.9)', 'important');
  el.style.setProperty('-webkit-filter', 'blur(8px) saturate(0.9)', 'important');
  el.style.pointerEvents = 'none';
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('reveal-blur-inline');

  // If computed style still shows 'none', apply overlay fallback
  requestAnimationFrame(() => {
    const cs = getComputedStyle(el);
    const f = cs.filter || cs.webkitFilter || 'none';
    if (f === 'none' || f === '') {
      addOverlay(el);
    }
  });
}
function unblurElement(el) {
  if (!el) return;
  el.classList.remove('reveal-blur-inline');
  el.style.removeProperty('filter');
  el.style.removeProperty('-webkit-filter');
  el.style.pointerEvents = '';
  el.setAttribute('aria-hidden', 'false');
  removeOverlay(el);
}
function placeButtonAfter(el, btn) {
  const wrap = el && el.parentElement && el.parentElement.classList.contains('reveal-wrap')
    ? el.parentElement
    : el;
  if (wrap && wrap.insertAdjacentElement) {
    wrap.insertAdjacentElement('afterend', btn);
  } else if (el && el.insertAdjacentElement) {
    el.insertAdjacentElement('afterend', btn);
  } else if (el && el.parentElement) {
    el.parentElement.appendChild(btn);
  }
}
function applyReveal(el, enabled, btnId, labelText) {
  if (!el) return;
  removeExistingRevealBtn(btnId);

  const wasRevealed = el.dataset.revealed === 'true';
  if (enabled || wasRevealed) {
    unblurElement(el);
    return;
  }

  blurElement(el);

  const btn = document.createElement('button');
  btn.id = btnId;
  btn.type = 'button';
  btn.className = 'reveal-btn';
  btn.textContent = `Show ${labelText}`;
  btn.addEventListener('click', () => {
    el.dataset.revealed = 'true';
    unblurElement(el);
    btn.remove();
  });

  placeButtonAfter(el, btn);
}
function updateModalRevealFromToggles() {
  if (!isModalOpen() || !lastModalTeam) return;
  applyReveal(mLogo,   !!optLogo?.checked,   'revealLogoBtn',   'logo');
  applyReveal(mHead,   !!optName?.checked,   'revealNameBtn',   'name');
  applyReveal(mStadium,!!optStadium?.checked,'revealStadiumBtn','stadium');
}

function openModal(team){
  ensureRevealStyles();
  lastModalTeam = team;

  // Populate and reset reveal state for this session
  if (mHead)   { mHead.textContent = team.team_name || '—'; mHead.dataset.revealed = 'false'; }
  if (mSub)    mSub.textContent = team.league_code || '';
  if (mLogo)   { mLogo.src = team.logo_url || ''; mLogo.alt = (team.team_name || 'Club') + ' logo'; mLogo.dataset.revealed = 'false'; }
  if (mColor)  mColor.style.background = team.primary_color || '#4f8cff';
  if (mColorHex) mColorHex.textContent = team.primary_color || '#4f8cff';
  if (mStadium) { mStadium.textContent = team.stadium || '—'; mStadium.dataset.revealed = 'false'; }

  // Apply reveal/blur per toggles
  updateModalRevealFromToggles();

  backdrop.style.display = 'flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));
}
function closeModal(){
  modalEl.classList.remove('show');
  setTimeout(()=> backdrop.style.display='none', 150);
}

// ---------- Wheel drawing (upright single-line names, optional stadium, no overlap) ----------
function drawWheel(){
  const data = getFiltered();
  const N = data.length || 1;

  const ctx = wheel.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
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

  // Wedges
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

  // Selected rim stroke
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

  // Content
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

    // Rotate to bisector + upright
    ctx.rotate(midAngle);
    const needFlip = Math.cos(midAngle) < 0;
    if (needFlip) ctx.rotate(Math.PI);
    const sign = needFlip ? -1 : 1;

    // Geometry: text then logo
    const xLogo = sign * (radius * 0.74);
    const xText = sign * (radius * 0.42);
    const logoInner = wantLogo ? (xLogo - sign * (logoHalf + pad)) : sign * (radius * 0.86);
    const xBoxLeft = Math.min(xText, logoInner);
    const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

    // Text (single-line)
    if (wantName || wantStadium) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      let namePx = nameTargetPx;
      let yName = 0;

      if (wantName) {
        const heavy = (lum >= 0.35 && lum <= 0.45);
        const fitted = fitSingleLine(ctx, t.team_name || '', {
          maxWidth: maxTextWidth, targetPx: nameTargetPx, minPx: 9, maxPx: 22, weight: heavy ? 900 : 800
        });
        namePx = fitted.fontPx;

        const gap = wantStadium ? 4 : 0;
        const totalH = wantStadium ? (namePx + gap + stadiumTargetPx) : namePx;
        yName = -totalH/2 + namePx/2;

        ctx.font = `${heavy ? 900 : 800} ${namePx}px Inter, system-ui, sans-serif`;
        ctx.strokeStyle = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.85)';
        ctx.lineWidth = Math.max(1, Math.round(namePx/9));
        ctx.fillStyle = fg;
        ctx.strokeText(fitted.text, xBoxLeft, yName);
        ctx.fillText(fitted.text, xBoxLeft, yName);
      }

      if (wantStadium) {
        const stadFit = fitSingleLine(ctx, t.stadium || '', {
          maxWidth: maxTextWidth, targetPx: stadiumTargetPx, minPx: 8, maxPx: 18, weight: 700
        });
        const yStad = wantName ? (yName + namePx/2 + 4 + stadFit.fontPx/2) : 0;

        ctx.font = `700 ${stadFit.fontPx}px Inter, system-ui, sans-serif`;
        ctx.strokeStyle = 'rgba(12,16,28,0.75)';
        ctx.lineWidth = Math.max(1, Math.round(stadFit.fontPx/9));
        ctx.fillStyle = '#D7E8FF';
        ctx.strokeText(stadFit.text, xBoxLeft, yStad);
        ctx.fillText(stadFit.text, xBoxLeft, yStad);
      }

      ctx.restore();
    }

    // Logo
    if (wantLogo) {
      ctx.save();
      ctx.translate(xLogo, 0);

      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      ctx.beginPath();
      ctx.arc(0, 0, logoHalf, 0, TAU);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();

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

    ctx.restore(); // clip + rotations
  }

  ctx.restore();
}

// Result + Spin (precise snap)
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

// Events / Boot
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

  // Redraw + refresh modal reveal states on toggles
  optName.onchange = () => { drawWheel(); updateModalRevealFromToggles(); };
  optLogo.onchange = () => { drawWheel(); updateModalRevealFromToggles(); };
  optStadium.onchange = () => { drawWheel(); updateModalRevealFromToggles(); };

  spinBtn.onclick = spin;
  resetHistoryBtn.addEventListener('click', resetHistory);

  mClose.onclick = closeModal;
  backdrop.addEventListener('click', e => { if(e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(e.key==='Escape' && backdrop.style.display==='flex') closeModal(); });

  // Debounced resize redraw
  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => {
      sizeCanvas();
      drawWheel();
    }, 120);
  }, { passive: true });
}

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
