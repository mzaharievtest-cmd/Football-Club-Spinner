// Football Club Spinner — app.js
// Show more: extra leagues are hidden by default and only shown after clicking the button.
// "All" selects only visible leagues. EPL is selected on first load. UI is locked while spinning.

let TEAMS = [];
let currentAngle = 0; // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// Modal/session state
let lastModalTeam = null;
let modalRevealState = { logo: false, name: false, stadium: false };

// -------------------- DOM --------------------
const chipsWrap = document.getElementById('chips');
const chipsTop = document.getElementById('chipsTop');
const chipsMore = document.getElementById('chipsMore');
const toggleMore = document.getElementById('toggleMore');

const spinBtn = document.getElementById('spinBtn');
const spinFab = document.getElementById('spinFab');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName = document.getElementById('optName');
const optLogo = document.getElementById('optLogo');
const optStadium = document.getElementById('optStadium');

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

// Quick picks and banner
const qpAll  = document.getElementById('qpAll');
const qpNone = document.getElementById('qpNone');
const qpTop5 = document.getElementById('qpTop5');
const perfTip = document.getElementById('perfTip');

// Canvases
const wheel = document.getElementById('wheel');
const fx = document.getElementById('fx');

// -------------------- Utils --------------------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;
const isModalOpen = () => backdrop && backdrop.style.display === 'flex';

// Performance thresholds
const PERF = {
  hideLogosThreshold: 80,
  hideTextThreshold: 140,
  minTextWidth: 44,
  minLogoBox: 28
};

// Labels (25 leagues)
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

// -------------------- Image cache --------------------
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

// -------- Single-line fitting --------
function fitSingleLine(ctx, text, { maxWidth, targetPx, minPx = 9, maxPx = 28, weight = 800, fontFamily = 'Inter, system-ui, sans-serif' }) {
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

// -------------------- Sizing --------------------
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

// -------------------- Strict UI lock while spinning --------------------
const INTERACTIVE_SELECTOR = 'button, input, select, textarea, [role="button"]';
function lockUI(lock) {
  document.body.classList.toggle('ui-locked', !!lock);
  const els = document.querySelectorAll(INTERACTIVE_SELECTOR);
  els.forEach(el => {
    if (lock) {
      if (!el.dataset.lockSaved) {
        el.dataset.lockSaved = '1';
        el.dataset.prevDisabled = el.disabled ? '1' : '0';
      }
      el.disabled = true;
      el.setAttribute('aria-disabled', 'true');
    } else {
      if (el.dataset.lockSaved === '1') {
        const prev = el.dataset.prevDisabled === '1';
        el.disabled = prev;
        if (!prev) el.removeAttribute('aria-disabled');
        delete el.dataset.lockSaved;
        delete el.dataset.prevDisabled;
      }
    }
  });
}

// -------------------- Chips / History --------------------
const TOP5 = ['EPL','SA','BUN','L1','LLA']; // Premier League, Serie A, Bundesliga, Ligue 1, LaLiga

function makeChip(code, checked) {
  const full = LEAGUE_LABELS[code] || code;
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${code}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${full}">
    <span class="chip-text" title="${full}">${full}</span>
  `;
  return label;
}

function renderChips() {
  const allCodes = [...new Set(TEAMS.map(t => t.league_code))];
  const topCodes = TOP5.filter(c => allCodes.includes(c));
  const moreCodes = allCodes.filter(c => !topCodes.includes(c)).sort();

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  // Top 5 — EPL checked by default
  topCodes.forEach(code => chipsTop.appendChild(makeChip(code, code === 'EPL')));

  // Extra leagues — populated but hidden until the user clicks the button
  moreCodes.forEach(code => chipsMore.appendChild(makeChip(code, false)));

  // Ensure hidden on initial render
  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more leagues';
  toggleMore.setAttribute('aria-expanded', 'false');
  toggleMore.disabled = false;
  toggleMore.classList.remove('disabled');
}

// Only select visible league codes (Top 5 by default; plus extras when shown)
function visibleCodes() {
  const codes = Array.from(chipsTop.querySelectorAll('input[type="checkbox"]')).map(i => i.value);
  if (!chipsMore.hidden) {
    codes.push(...Array.from(chipsMore.querySelectorAll('input[type="checkbox"]')).map(i => i.value));
  }
  return codes;
}

function setCheckedCodes(codes = []) {
  const set = new Set(codes);
  chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => {
    i.checked = set.has(i.value);
    i.setAttribute('aria-checked', i.checked ? 'true' : 'false');
  });
  selectedIdx = -1;
  drawWheel();
  const hasAny = getFiltered().length > 0;
  spinBtn.disabled = !hasAny;
  spinFab.disabled = !hasAny;
  if (!hasAny && currentText) currentText.textContent = 'Please select at least one league.';
  updateSelectionBanner();
}

function getFiltered() {
  const active = Array.from(chipsWrap.querySelectorAll('input:checked')).map(i => i.value);
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

// -------------------- Modal blur/reveal (unchanged helpers omitted for brevity) --------------------
function ensureRevealStyles() {
  if (document.getElementById('reveal-style')) return;
  const s = document.createElement('style');
  s.id = 'reveal-style';
  s.textContent = `
    .reveal-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;margin-left:10px;padding:8px 12px;border-radius:10px;border:1px solid rgba(90,161,255,.6);background:#152036;color:#fff;font-weight:700;letter-spacing:.03em;cursor:pointer;user-select:none;z-index:999;position:relative}
    #mHead + .reveal-btn{display:inline-block;margin-left:0}
    .reveal-wrap{position:relative;display:inline-block;z-index:0}
    .reveal-overlay{position:absolute;inset:0;border-radius:inherit;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:transparent;pointer-events:none;z-index:2}
  `;
  document.head.appendChild(s);
}
function removeExistingRevealBtn(id){ const old=document.getElementById(id); if(old) old.remove(); }
function ensureWrapped(el){ if(!el||!el.parentElement) return null; if(el.parentElement.classList.contains('reveal-wrap')) return el.parentElement; const wrap=document.createElement('span'); wrap.className='reveal-wrap'; const cs=getComputedStyle(el); if(cs.borderRadius) wrap.style.borderRadius=cs.borderRadius; el.parentElement.insertBefore(wrap,el); wrap.appendChild(el); return wrap; }
function addOverlay(el){ const wrap=ensureWrapped(el); if(!wrap) return; if(!wrap.querySelector('.reveal-overlay')){ const ov=document.createElement('span'); ov.className='reveal-overlay'; wrap.appendChild(ov); } }
function removeOverlay(el){ if(!el||!el.parentElement) return; const wrap=el.parentElement; if(wrap.classList.contains('reveal-wrap')){ const ov=wrap.querySelector('.reveal-overlay'); if(ov) ov.remove(); } }
function blurElement(el){ if(!el) return; el.style.setProperty('filter','blur(14px) saturate(0.9)','important'); el.style.setProperty('-webkit-filter','blur(14px) saturate(0.9)','important'); el.style.transform='translateZ(0)'; el.style.pointerEvents='none'; el.setAttribute('aria-hidden','true'); requestAnimationFrame(()=>{ const cs=getComputedStyle(el); const f=(cs.filter||cs.webkitFilter||'').trim(); if(!f||f==='none') addOverlay(el); }); }
function unblurElement(el){ if(!el) return; el.style.removeProperty('filter'); el.style.removeProperty('-webkit-filter'); el.style.transform=''; el.style.pointerEvents=''; el.setAttribute('aria-hidden','false'); removeOverlay(el); }
function placeButtonAfter(el,btn){ const host=el?.parentElement?.classList.contains('reveal-wrap') ? el.parentElement : el; if (host?.insertAdjacentElement) host.insertAdjacentElement('afterend', btn); else el?.parentElement?.appendChild(btn); }
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

// -------------------- Selection banner --------------------
function updateSelectionBanner() {
  const N = getFiltered().length;
  perfTip.textContent = `${N} teams selected`;
}

// -------------------- Drawing (wheel) --------------------
// ... drawGradientIdle, drawWheel, setResult functions unchanged from previous version ...

// drawGradientIdle
function drawGradientIdle(ctx, W, H) {
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,W,H);

  ctx.save();
  ctx.translate(W/2, H/2);

  const radius = Math.min(W, H) * 0.48;

  const g = ctx.createRadialGradient(0,0, radius*0.1, 0,0, radius);
  g.addColorStop(0.00, '#1A2C5A');
  g.addColorStop(0.35, '#21386F');
  g.addColorStop(0.65, '#0E2A57');
  g.addColorStop(1.00, '#0B1B38');

  ctx.beginPath();
  ctx.arc(0,0, radius, 0, TAU);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let i=1;i<=5;i++){
    ctx.beginPath();
    ctx.arc(0,0, radius*(i/5), 0, TAU);
    ctx.stroke();
  }

  ctx.restore();
}

// drawWheel (same as earlier performance-aware version; omitted for brevity)
// ... paste your latest drawWheel implementation here without changes ...

// setResult (unchanged)
// ... paste your latest setResult implementation here ...

// spin (locks UI during spin; unchanged)
// ... paste your latest spin implementation here ...

// -------------------- Events / Boot --------------------
function setupEventListeners() {
  // Leagues toggles
  chipsWrap.addEventListener('change', () => {
    if (spinning) return;
    selectedIdx = -1;
    drawWheel();
    const len = getFiltered().length;
    spinBtn.disabled = len === 0;
    spinFab.disabled = len === 0;
    if (len === 0 && currentText) currentText.textContent = 'Please select at least one league.';
    updateSelectionBanner();
  });

  // Enable Show more / Show fewer toggle — only reveals extra leagues on click
  toggleMore.addEventListener('click', () => {
    if (spinning) return;
    const hidden = chipsMore.hidden;
    if (hidden) {
      chipsMore.hidden = false;
      toggleMore.textContent = 'Show fewer leagues';
      toggleMore.setAttribute('aria-expanded', 'true');
    } else {
      chipsMore.hidden = true;
      toggleMore.textContent = 'Show more leagues';
      toggleMore.setAttribute('aria-expanded', 'false');
    }
  });

  // Quick picks with active styling — "All" selects only visible leagues
  function setActive(btn) { [qpAll, qpNone, qpTop5].forEach(b => b.classList.toggle('active', b === btn)); }

  qpAll.onclick  = () => { if (spinning) return; setCheckedCodes(visibleCodes()); setActive(qpAll); };
  qpNone.onclick = () => { if (spinning) return; setCheckedCodes([]); setActive(qpNone); };
  qpTop5.onclick = () => {
    if (spinning) return;
    setCheckedCodes(TOP5.filter(c => visibleCodes().includes(c)));
    setActive(qpTop5);
  };

  // Spin actions
  spinBtn.onclick = spin;
  spinFab.onclick = spin;

  // History and modal
  resetHistoryBtn.addEventListener('click', () => { if (!spinning) resetHistory(); });
  mClose.onclick = () => { if (!spinning) closeModal(); };
  backdrop.addEventListener('click', e => { if(!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(!spinning && e.key==='Escape' && isModalOpen()) closeModal(); });

  // Debounced resize redraw
  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => { sizeCanvas(); drawWheel(); }, 120);
  }, { passive: true });
}

fetch(`./teams.json?v=${Date.now()}`)
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    ensureRevealStyles();
    renderChips();              // Top 5 rendered; extras populated but hidden
    renderHistory();
    sizeCanvas();
    setCheckedCodes(['EPL']);   // EPL-only on first load
    drawWheel();
    setupEventListeners();
  })
  .catch(err => {
    console.error('Failed to load teams.json', err);
    if (currentText) currentText.textContent = 'Failed to load teams.';
  });
