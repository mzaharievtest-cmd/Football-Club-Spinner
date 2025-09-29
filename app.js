// Football Club Spinner — app.js
// Optimized: performance-aware rendering, EPL-only default, quick picks, and full league labels.

let TEAMS = [];
let currentAngle = 0; // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// Modal/session state
let lastModalTeam = null;
let modalRevealState = { logo: false, name: false, stadium: false };

// -------------------- DOM --------------------
const chips = document.getElementById('chips');
const spinBtn = document.getElementById('spinBtn');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName = document.getElementById('optName');
const optLogo = document.getElementById('optLogo');
const optStadium = document.getElementById('optStadium');

// Optional current selection (we removed the block; guard all uses)
const currentText = document.getElementById('currentText');
const currentLogo = document.getElementById('currentLogo');

const historyEl = document.getElementById('history');

// Modal
const backdrop = document.getElementById('backdrop');
const modalEl = document.getElementById('modal');
const mClose = document.getElementById('mClose');
const mHead = document.getElementById('mHead');
const mSub = document.getElementById('mSub');
const mLogo = document.getElementById('mLogo');
const mStadium = document.getElementById('mStadium');

// Quick picks and performance tip
const qpAll = document.getElementById('qpAll');
const qpNone = document.getElementById('qpNone');
const qpEPL = document.getElementById('qpEPL');
const qpTop5 = document.getElementById('qpTop5');
const perfTip = document.getElementById('perfTip');

// Canvases
const wheel = document.getElementById('wheel');
const fx = document.getElementById('fx'); // reserved

// -------------------- Utils --------------------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU; // pointer at 12 o'clock
const DEBUG = false;

const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;
const isModalOpen = () => backdrop && backdrop.style.display === 'flex';

// Performance thresholds (tuned for smoothness)
const PERF = {
  hideLogosThreshold: 80,   // when N >=, skip logos (big boost)
  hideTextThreshold: 140,   // when N >=, skip all text
  minTextWidth: 44,         // px; if slice text box narrower, skip that text
  minLogoBox: 28            // px; if logo circle smaller than this, skip logo
};

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

// -------------------- League label mapping (25 leagues) --------------------
const LEAGUE_LABELS = {
  AUT: "Austrian Bundesliga",
  BEL: "Jupiler Pro League",
  BUL: "efbet Liga",
  CRO: "SuperSport HNL",
  CZE: "Fortuna Liga",
  DEN: "Superliga",
  EPL: "Premier League",
  L1:  "Ligue 1",
  BUN: "Bundesliga",
  GRE: "Super League 1",
  ISR: "Ligat ha'Al",
  SA:  "Serie A",
  NED: "Eredivisie",
  NOR: "Eliteserien",
  POL: "PKO BP Ekstraklasa",
  POR: "Liga Portugal",
  ROU: "SuperLiga",
  RUS: "Premier Liga",
  SCO: "Scottish Premiership",
  SRB: "Super liga Srbije",
  LLA: "LaLiga",
  SWE: "Allsvenskan",
  SUI: "Super League",
  TUR: "Süper Lig",
  UKR: "Ukrainian Premier League"
};

// -------------------- Image cache for wheel (modal uses <img> directly) --------------------
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

// -------- Single-line fitting helper --------
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
  let s = (text || '').trim();
  while (s && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0,-1);
  return { text: (s || '') + '…', fontPx: minPx, truncated: true };
}

// -------------------- HiDPI sizing --------------------
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

// -------------------- Chips / History --------------------
function renderChips() {
  const leagues = [...new Set(TEAMS.map(t => t.league_code))].sort();
  chips.innerHTML = '';
  leagues.forEach(code => {
    const full = LEAGUE_LABELS[code] || code;
    const label = document.createElement('label');
    label.className = 'chip';
    // Default: only EPL checked
    const checked = (code === 'EPL');
    label.innerHTML = `
      <input type="checkbox" value="${code}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${full}">
      <span class="chip-text" title="${full}">${full}</span>
    `;
    chips.appendChild(label);
  });
}
function setCheckedCodes(codes = []) {
  const set = new Set(codes);
  chips.querySelectorAll('input[type="checkbox"]').forEach(i => {
    i.checked = set.has(i.value);
    i.setAttribute('aria-checked', i.checked ? 'true' : 'false');
  });
  selectedIdx = -1;
  drawWheel();
  const hasAny = getFiltered().length > 0;
  spinBtn.disabled = !hasAny;
  if (!hasAny && currentText) currentText.textContent = 'Please select at least one league.';
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
    const full = LEAGUE_LABELS[item.league_code] || item.league_code;
    s.textContent = `${item.team_name} (${full})`;
    div.append(i, s);
    historyEl.append(div);
  });
}

// -------------------- Modal blur/reveal (robust) --------------------
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
      z-index: 999; position: relative;
    }
    #mHead + .reveal-btn { display: inline-block; margin-left: 0; }
    .reveal-wrap { position: relative; display: inline-block; z-index: 0; }
    .reveal-overlay {
      position: absolute; inset: 0;
      border-radius: inherit;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      background: transparent;
      pointer-events: none;
      z-index: 2;
    }
  `;
  document.head.appendChild(s);
}

// ... blur/unblur helpers omitted for brevity (unchanged from your current file) ...
function removeExistingRevealBtn(id){ const old=document.getElementById(id); if(old) old.remove(); }
function ensureWrapped(el){ if(!el||!el.parentElement) return null; if(el.parentElement.classList.contains('reveal-wrap')) return el.parentElement; const w=document.createElement('span'); w.className='reveal-wrap'; const cs=getComputedStyle(el); if(cs.borderRadius) w.style.borderRadius=cs.borderRadius; el.parentElement.insertBefore(w,el); w.appendChild(el); return w; }
function addOverlay(el){ const w=ensureWrapped(el); if(!w) return; if(!w.querySelector('.reveal-overlay')){ const ov=document.createElement('span'); ov.className='reveal-overlay'; w.appendChild(ov); } }
function removeOverlay(el){ if(!el||!el.parentElement) return; const w=el.parentElement; if(w.classList.contains('reveal-wrap')){ const ov=w.querySelector('.reveal-overlay'); if(ov) ov.remove(); } }
function blurElement(el){ if(!el) return; el.style.setProperty('filter','blur(14px) saturate(0.9)','important'); el.style.setProperty('-webkit-filter','blur(14px) saturate(0.9)','important'); el.style.transform='translateZ(0)'; el.style.pointerEvents='none'; el.setAttribute('aria-hidden','true'); requestAnimationFrame(()=>{ const cs=getComputedStyle(el); const f=(cs.filter||cs.webkitFilter||'').trim(); if(!f||f==='none') addOverlay(el); }); }
function unblurElement(el){ if(!el) return; el.style.removeProperty('filter'); el.style.removeProperty('-webkit-filter'); el.style.transform=''; el.style.pointerEvents=''; el.setAttribute('aria-hidden','false'); removeOverlay(el); }
function placeButtonAfter(el,btn){ const host=el?.parentElement?.classList.contains('reveal-wrap')?el.parentElement:el; if(host?.insertAdjacentElement) host.insertAdjacentElement('afterend', btn); else el?.parentElement?.appendChild(btn); }

function applyRevealByKey(key, el, enabled, btnId, labelText) {
  if (!el) return;
  removeExistingRevealBtn(btnId);
  const revealed = !!modalRevealState[key];
  if (enabled || revealed) { unblurElement(el); return; }
  blurElement(el);
  const btn = document.createElement('button');
  btn.id = btnId; btn.type = 'button'; btn.className = 'reveal-btn';
  btn.textContent = `Show ${labelText}`;
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); modalRevealState[key] = true; unblurElement(el); btn.remove(); }, { passive: false });
  placeButtonAfter(el, btn);
}

function updateModalRevealFromToggles() {
  if (!isModalOpen() || !lastModalTeam) return;
  applyRevealByKey('logo',    mLogo,    !!optLogo?.checked,    'revealLogoBtn',    'logo');
  applyRevealByKey('name',    mHead,    !!optName?.checked,    'revealNameBtn',    'name');
  applyRevealByKey('stadium', mStadium, !!optStadium?.checked, 'revealStadiumBtn', 'stadium');
}

// -------------------- Modal open/close --------------------
function openModal(team){
  ensureRevealStyles();
  lastModalTeam = team;
  modalRevealState = { logo: false, name: false, stadium: false };

  const leagueLabel = LEAGUE_LABELS[team.league_code] || team.league_code;

  if (mHead)   mHead.textContent = team.team_name || '—';
  if (mSub)    mSub.textContent = leagueLabel;
  if (mLogo)   { mLogo.src = team.logo_url || ''; mLogo.alt = (team.team_name || 'Club') + ' logo'; }
  if (mStadium) mStadium.textContent = team.stadium || '—';

  backdrop.style.display = 'flex';
  requestAnimationFrame(() => {
    modalEl.classList.add('show');
    updateModalRevealFromToggles();
  });
}
function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=> backdrop.style.display='none', 150); }

// -------------------- Wheel drawing (performance-aware) --------------------
function updatePerfBanner({ hideText, hideLogos, N }) {
  if (!perfTip) return;
  if (!hideText && !hideLogos) { perfTip.hidden = true; perfTip.textContent = ''; return; }
  let msg = 'Performance mode: ';
  const bits = [];
  if (hideText) bits.push('text hidden');
  if (hideLogos) bits.push('logos hidden');
  bits.push(`(${N} teams)`);
  msg += bits.join(' · ');
  perfTip.hidden = false;
  perfTip.textContent = msg;
}

function drawWheel(){
  const data = getFiltered();
  const N = data.length || 1;

  // Auto performance toggles
  const hideLogos = N >= PERF.hideLogosThreshold;
  const hideText = N >= PERF.hideTextThreshold;

  updatePerfBanner({ hideText, hideLogos, N });

  const ctx = wheel.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Slightly lower smoothing if extremely dense to boost perf
  ctx.imageSmoothingEnabled = !hideText;
  ctx.imageSmoothingQuality = hideText ? 'low' : 'high';

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

  // Selected rim stroke (turn off heavy strokes in dense mode)
  if (!hideText && selectedIdx >= 0 && selectedIdx < N) {
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

  // Content (logos/text) skipped entirely in hideText mode
  if (!hideText || !hideLogos) {
    for (let i = 0; i < N; i++) {
      const t = data[i] || {};

      const a0 = i * sliceAngle;
      const a1 = (i + 1) * sliceAngle;
      const aMid = (a0 + a1) / 2;
      const sliceArc = radius * (a1 - a0);

      // Derived sizes
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
      ctx.arc(0,0, radius - 1, a0, a1);
      ctx.closePath();
      ctx.clip();

      // Rotate to bisector and keep upright
      ctx.rotate(aMid);
      const needFlip = Math.cos(aMid) < 0;
      if (needFlip) ctx.rotate(Math.PI);
      const sign = needFlip ? -1 : 1;

      // Geometry: text box then logo
      const xLogo = sign * (radius * 0.74);
      const xText = sign * (radius * 0.42);
      const logoInner = xLogo - sign * (logoHalf + pad);
      const xBoxLeft = Math.min(xText, logoInner);
      const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

      // Decide what to render this slice
      const canShowName    = !hideText && optName?.checked && t.team_name && maxTextWidth >= PERF.minTextWidth;
      const canShowStadium = !hideText && optStadium?.checked && t.stadium && maxTextWidth >= PERF.minTextWidth;
      const canShowLogo    = !hideLogos && optLogo?.checked && t.logo_url && (logoHalf * 2) >= PERF.minLogoBox;

      // Text
      if (canShowName || canShowStadium) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        let namePx = nameTargetPx;
        let yName = 0;

        if (canShowName) {
          const heavy = (lum >= 0.35 && lum <= 0.45);
          const fitted = fitSingleLine(ctx, t.team_name || '', {
            maxWidth: maxTextWidth, targetPx: nameTargetPx, minPx: 9, maxPx: 22,
            weight: heavy ? 900 : 800
          });
          namePx = fitted.fontPx;

          const gap = canShowStadium ? 4 : 0;
          const totalH = canShowStadium ? (namePx + gap + stadiumTargetPx) : namePx;
          yName = -totalH/2 + namePx/2;

          ctx.font = `${heavy ? 900 : 800} ${namePx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.65)'; // lighter stroke in perf mode
          ctx.lineWidth = Math.max(1, Math.round(namePx/10));
          ctx.fillStyle = fg;
          ctx.strokeText(fitted.text, xBoxLeft, yName);
          ctx.fillText(fitted.text, xBoxLeft, yName);
        }

        if (canShowStadium) {
          const stadFit = fitSingleLine(ctx, t.stadium || '', {
            maxWidth: maxTextWidth, targetPx: stadiumTargetPx, minPx: 8, maxPx: 18, weight: 700
          });
          const yStad = canShowName ? (yName + namePx/2 + 4 + stadFit.fontPx/2) : 0;

          ctx.font = `700 ${stadFit.fontPx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = 'rgba(12,16,28,0.45)';
          ctx.lineWidth = Math.max(1, Math.round(stadFit.fontPx/10));
          ctx.fillStyle = '#D7E8FF';
          ctx.strokeText(stadFit.text, xBoxLeft, yStad);
          ctx.fillText(stadFit.text, xBoxLeft, yStad);
        }

        ctx.restore();
      }

      // Logo
      if (canShowLogo) {
        ctx.save();
        ctx.translate(xLogo, 0);

        // Cheaper shadow for perf
        if (N < PERF.hideLogosThreshold) {
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 4;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2;
        }

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
  }

  ctx.restore();
}

// -------------------- Result + Spin (precise pointer snap) --------------------
function setResult(idx){
  const data = getFiltered();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  const leagueLabel = LEAGUE_LABELS[t.league_code] || t.league_code;

  if (currentText) currentText.textContent = `${t.team_name} · ${leagueLabel}`;
  if (currentLogo) currentLogo.src = t.logo_url || "";

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
    if (currentText) currentText.textContent = 'Please select at least one league.';
    return;
  }

  spinning = true;
  spinBtn.disabled = true;
  selectedIdx = -1;

  const N = data.length;
  const slice = TAU / N;

  const extraTurns  = 6 + Math.floor(Math.random()*3); // 6..8
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

      // Snap the chosen slice center under the pointer
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

// -------------------- Events / Boot --------------------
function setupEventListeners() {
  chips.addEventListener('change', () => {
    selectedIdx = -1;
    drawWheel();
    if (getFiltered().length === 0) {
      if (currentText) currentText.textContent = 'Please select at least one league.';
      spinBtn.disabled = true;
    } else {
      if (currentText) currentText.textContent = '';
      spinBtn.disabled = false;
    }
  });

  // Quick picks
  qpAll.onclick  = () => setCheckedCodes([...new Set(TEAMS.map(t=>t.league_code))]);
  qpNone.onclick = () => setCheckedCodes([]);
  qpEPL.onclick  = () => setCheckedCodes(['EPL']);
  qpTop5.onclick = () => setCheckedCodes(['EPL','LLA','SA','BUN','L1']);

  // Redraw wheel + refresh modal reveal when toggles change
  optName.onchange    = () => { drawWheel(); updateModalRevealFromToggles(); };
  optLogo.onchange    = () => { drawWheel(); updateModalRevealFromToggles(); };
  optStadium.onchange = () => { drawWheel(); updateModalRevealFromToggles(); };

  spinBtn.onclick = spin;
  resetHistoryBtn.addEventListener('click', resetHistory);

  mClose.onclick = closeModal;
  backdrop.addEventListener('click', e => { if(e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(e.key==='Escape' && isModalOpen()) closeModal(); });

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

// Use a cache-buster so browsers don't hold on to stale teams.json
fetch(`./teams.json?v=${Date.now()}`)
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    ensureRevealStyles();
    renderChips();             // will default to EPL only
    renderHistory();
    sizeCanvas();
    drawWheel();
    setupEventListeners();
  })
  .catch(err => {
    console.error('Failed to load teams.json', err);
    if (currentText) currentText.textContent = 'Failed to load teams.';
  });
