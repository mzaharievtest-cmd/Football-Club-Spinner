/* Football Club / Player Spinner — unified app.js
   - TEAM mode: Logo / Name / Stadium / League (league text never drawn on slice; it’s in modal only)
   - PLAYER mode: Image / Name / Jersey Number / Nationality + Club (club in modal; chips filter by club)
   - When >50 items selected: hide all slice contents (only colored wedges)
   - PLAYER chips = Premier League 2025/26 clubs (Top 6 prechecked)
*/

/* =================== State =================== */
let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';
let TEAMS = [];            // from teams.json
let PLAYERS = [];          // from /data/players.json (or /players/players.json)
let currentAngle = 0;
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// Modal reveal state
let lastModalItem = null;
let modalRevealState = { logo: false, name: false, stadium: false, league: false, image: false, jersey: false, nationality: false, club: false };

/* =================== DOM =================== */
const chipsWrap   = document.getElementById('chips');
const chipsTop    = document.getElementById('chipsTop');
const chipsMore   = document.getElementById('chipsMore');
const toggleMore  = document.getElementById('toggleMore');

const spinBtn     = document.getElementById('spinBtn');
const spinFab     = document.getElementById('spinFab');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName     = document.getElementById('optName');
const optLogo     = document.getElementById('optLogo');
const optStadium  = document.getElementById('optStadium');
const optLeague   = document.getElementById('optLeague');     // TEAM-only label; not drawn on slices

// For PLAYER we reuse same inputs but we relabel them in HTML to Image/Name/Jersey/Nationality via text content.
// app.js uses their IDs as feature toggles (logo->image, stadium->jersey, league->nationality)
const lblName   = document.getElementById('lblName');
const lblLogo   = document.getElementById('lblLogo');
const lblSub1   = document.getElementById('lblSub1'); // Stadium or Jersey Number (mode-aware)
const lblSub2   = document.getElementById('lblSub2'); // League (team) or Nationality (player)

const perfTip    = document.getElementById('perfTip');

const wheel      = document.getElementById('wheel');
const fx         = document.getElementById('fx');

// Mode switch
const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

// Modal
const backdrop  = document.getElementById('backdrop');
const modalEl   = document.getElementById('modal');
const mClose    = document.getElementById('mClose');
const mHead     = document.getElementById('mHead');
const mSub      = document.getElementById('mSub');      // league (team) or nationality (player)
const mLogo     = document.getElementById('mLogo');     // logo or player image
const mStadium  = document.getElementById('mStadium');  // stadium (team) or jersey number (player)
const mFieldLabel = document.getElementById('mFieldLabel'); // “Stadium” (team) or “Jersey”

// Optional player preview list (if present in HTML)
const playerListEl = document.getElementById('playerList');

// Views (if present) — we keep a single wheel; views just gate auxiliary sidebars
const teamView   = document.getElementById('teamView');
const playerView = document.getElementById('playerView');

/* =================== Constants / Utils =================== */
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI/2) + TAU) % TAU;
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;

const PERF = {
  hideContentsThreshold: 50, // when N > 50, hide logos/images and texts on slices
  minTextWidth: 44,
  minLogoBox: 28
};

// League labels for TEAM history / modal lines
const LEAGUE_LABELS = {
  AUT: "Austrian Bundesliga", BEL: "Jupiler Pro League", BUL: "efbet Liga", CRO: "SuperSport HNL",
  CZE: "Fortuna Liga", DEN: "Superliga", EPL: "Premier League", L1: "Ligue 1", BUN: "Bundesliga",
  GRE: "Super League 1", ISR: "Ligat ha'Al", SA: "Serie A", NED: "Eredivisie", NOR: "Eliteserien",
  POL: "PKO BP Ekstraklasa", POR: "Liga Portugal", ROU: "SuperLiga", RUS: "Premier Liga",
  SCO: "Scottish Premiership", SRB: "Super liga Srbije", LLA: "LaLiga", SWE: "Allsvenskan",
  SUI: "Super League", TUR: "Süper Lig", UKR: "Ukrainian Premier League",
  PLAYER: "Players"
};

// Map SportMonks team_id → short club code (used for player chips & filtering)
const TEAM_CODE = {
  9:'MCI',14:'MUN',15:'AVL',18:'CHE',19:'ARS',20:'NEW',27:'BUR',29:'WOL',
  51:'CRY',52:'BOU',63:'NFO',71:'LEE',78:'BHA',236:'BRE',1:'WHU',3:'SUN',
  6:'TOT',8:'LIV',11:'FUL',13:'EVE'
};
const TOP6_CODES = ['CHE','MCI','MUN','LIV','ARS','TOT'];

/* =================== Image cache =================== */
const IMG_CACHE = new Map();
function getImg(url, onLoad) {
  if (!url) return null;
  const cached = IMG_CACHE.get(url);
  if (cached) return cached.img;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  img.onload = () => onLoad && onLoad();
  img.onerror = () => onLoad && onLoad();
  IMG_CACHE.set(url, { img });
  return img;
}

/* =================== Fit single line =================== */
function fitSingleLine(ctx, text, { maxWidth, targetPx, minPx=9, maxPx=26, weight=800, fontFamily='Inter, system-ui, sans-serif' }) {
  let px = clamp(minPx, Math.round(targetPx), maxPx);
  ctx.font = `${weight} ${px}px ${fontFamily}`;
  if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px, truncated: false };

  while (px > minPx) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px, truncated: false };
  }
  let s = (text || '').trim();
  while (s && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return { text: (s || '') + '…', fontPx: minPx, truncated: true };
}

/* =================== Sizing =================== */
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

/* =================== UI helpers =================== */
function lockUI(lock) {
  document.body.classList.toggle('ui-locked', !!lock);
  const els = document.querySelectorAll('button, input, select, textarea, [role="button"]');
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

/* =================== Chips (TEAM) =================== */
function makeChip(code, labelText, checked) {
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${code}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${labelText}">
    <span class="chip-text" title="${labelText}">${labelText}</span>`;
  return label;
}

function renderTeamChips() {
  const allCodes = [...new Set(TEAMS.map(t => t.league_code))];
  const TOP5 = ['EPL','SA','BUN','L1','LLA'];
  const topCodes = TOP5.filter(c => allCodes.includes(c));
  const moreCodes = allCodes.filter(c => !topCodes.includes(c)).sort();

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  topCodes.forEach(code => chipsTop.appendChild(makeChip(code, LEAGUE_LABELS[code] || code, code === 'EPL')));
  moreCodes.forEach(code => chipsMore.appendChild(makeChip(code, LEAGUE_LABELS[code] || code, false)));

  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more leagues';
  toggleMore.setAttribute('aria-expanded','false');
}

/* =================== Chips (PLAYER) =================== */
function renderPlayerChips() {
  // Build unique clubs from PLAYERS (code + name)
  const clubMap = new Map(); // code -> name
  PLAYERS.forEach(p => { if (p.club_code) clubMap.set(p.club_code, p.club || p.club_code); });

  const all = Array.from(clubMap.entries()).map(([club_code, club]) => ({club_code, club}));
  const top = all.filter(c => TOP6_CODES.includes(c.club_code));
  const rest = all.filter(c => !TOP6_CODES.includes(c.club_code)).sort((a,b)=>a.club.localeCompare(b.club));

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  const makeClubChip = (c, checked) => {
    const el = document.createElement('label');
    el.className = 'chip';
    el.innerHTML = `
      <input type="checkbox" value="${c.club_code}" ${checked ? 'checked aria-checked="true"':''} aria-label="${c.club}">
      <span class="chip-text" title="${c.club}">${c.club}</span>`;
    return el;
  };

  top.forEach(c => chipsTop.appendChild(makeClubChip(c, true)));  // Top 6 prechecked
  rest.forEach(c => chipsMore.appendChild(makeClubChip(c, false)));

  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more Premier League clubs';
  toggleMore.setAttribute('aria-expanded','false');
}

/* =================== Selection helpers =================== */
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
  updateSpinAvailability();
  updateSelectionBanner();
}

/* =================== Data views =================== */
function getCurrentData() {
  const active = Array.from(chipsWrap.querySelectorAll('input:checked')).map(i => i.value);

  if (MODE === 'player') {
    if (!PLAYERS.length) return [];
    // If nothing selected (first time), fallback to TOP6
    if (active.length === 0) return PLAYERS.filter(p => TOP6_CODES.includes(p.club_code));
    return PLAYERS.filter(p => active.includes(p.club_code));
  }

  // TEAM
  return TEAMS.filter(t => active.includes(t.league_code));
}

function updateSelectionBanner() {
  const n = getCurrentData().length;
  perfTip.textContent = `${n} ${MODE === 'player' ? 'players' : 'teams'} selected`;
}

function updateSpinAvailability() {
  const n = getCurrentData().length;
  if (spinBtn) spinBtn.disabled = n === 0;
  if (spinFab) spinFab.disabled = n === 0;
}

/* =================== Modal reveal =================== */
function ensureRevealStyles() {
  if (document.getElementById('reveal-style')) return;
  const s = document.createElement('style');
  s.id = 'reveal-style';
  s.textContent = `
    .reveal-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;padding:8px 12px;border-radius:10px;border:1px solid rgba(90,161,255,.6);background:#152036;color:#fff;font-weight:800;letter-spacing:.03em;cursor:pointer;user-select:none;z-index:3;position:relative;white-space:nowrap}
    .reveal-wrap{position:relative;display:inline-block;z-index:0}
    .reveal-overlay{position:absolute;inset:0;border-radius:inherit;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:transparent;pointer-events:none;z-index:2}
  `;
  document.head.appendChild(s);
}
function removeExistingRevealBtn(id){ const old=document.getElementById(id); if(old) old.remove(); }
function ensureWrapped(el){
  if(!el||!el.parentElement) return null;
  if(el.parentElement.classList.contains('reveal-wrap')) return el.parentElement;
  const wrap=document.createElement('span'); wrap.className='reveal-wrap';
  el.parentElement.insertBefore(wrap, el); wrap.appendChild(el); return wrap;
}
function addOverlay(el){ const wrap=ensureWrapped(el); if(!wrap) return; if(!wrap.querySelector('.reveal-overlay')){ const ov=document.createElement('span'); ov.className='reveal-overlay'; wrap.appendChild(ov); } }
function removeOverlay(el){ if(!el||!el.parentElement) return; const wrap=el.parentElement; if(wrap.classList.contains('reveal-wrap')){ const ov=wrap.querySelector('.reveal-overlay'); if(ov) ov.remove(); } }
function blurElement(el){ if(!el) return; el.style.setProperty('filter','blur(14px) saturate(0.9)','important'); el.style.setProperty('-webkit-filter','blur(14px) saturate(0.9)','important'); el.style.pointerEvents='none'; addOverlay(el); }
function unblurElement(el){ if(!el) return; el.style.removeProperty('filter'); el.style.removeProperty('-webkit-filter'); el.style.pointerEvents=''; removeOverlay(el); el.setAttribute('aria-hidden','false'); }
function placeButtonAfter(el,btn){ const host=el?.parentElement?.classList.contains('reveal-wrap') ? el.parentElement : el; if (host?.insertAdjacentElement) host.insertAdjacentElement('afterend', btn); }

function applyRevealByKey(key, el, enabled, btnId, labelText) {
  if (!el) return;
  removeExistingRevealBtn(btnId);
  const revealed = !!modalRevealState[key];
  if (enabled || revealed) { unblurElement(el); return; }
  blurElement(el);
  const btn = document.createElement('button');
  btn.id = btnId; btn.type = 'button'; btn.className = 'reveal-btn';
  btn.textContent = `Show ${labelText}`;
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    modalRevealState[key] = true;
    unblurElement(el);
    btn.remove();
  }, { passive: false });
  placeButtonAfter(el, btn);
}

function updateModalRevealFromToggles() {
  if (!isModalOpen() || !lastModalItem) return;

  if (MODE === 'team') {
    applyRevealByKey('logo',    mLogo,    !!optLogo?.checked,   'revealLogo',    'logo');
    applyRevealByKey('name',    mHead,    !!optName?.checked,   'revealName',    'name');
    applyRevealByKey('stadium', mStadium, !!optStadium?.checked,'revealStadium', 'stadium');
    applyRevealByKey('league',  mSub,     !!optLeague?.checked, 'revealLeague',  'league');
  } else {
    applyRevealByKey('image',       mLogo,    !!optLogo?.checked,   'revealImage',       'image');
    applyRevealByKey('name',        mHead,    !!optName?.checked,   'revealPName',       'name');
    applyRevealByKey('jersey',      mStadium, !!optStadium?.checked,'revealJersey',      'jersey number');
    applyRevealByKey('nationality', mSub,     !!optLeague?.checked, 'revealNationality', 'nationality');
  }
}

/* =================== Modal open/close =================== */
const isModalOpen = () => backdrop && backdrop.style.display === 'flex';

function openModal(item) {
  ensureRevealStyles();
  lastModalItem = item;
  modalRevealState = { logo: false, name: false, stadium: false, league: false, image: false, jersey: false, nationality: false, club: false };

  if (MODE === 'team') {
    const leagueLabel = LEAGUE_LABELS[item.league_code] || item.league_code || '';
    mHead.textContent = item.team_name || '—';
    mSub.textContent = leagueLabel || '';
    mLogo.src = item.logo_url || '';
    mLogo.alt = `${item.team_name || 'Team'} logo`;
    mFieldLabel.textContent = 'Stadium';
    mStadium.textContent = item.stadium || '—';
  } else {
    mHead.textContent = item.name || 'Player';
    mSub.textContent  = item.nationality || '';
    mLogo.src = item.image_url || '';
    mLogo.alt = `${item.name || 'Player'} image`;
    mFieldLabel.textContent = 'Jersey';
    mStadium.textContent = item.jersey ? `#${item.jersey}` : '—';
  }

  backdrop.style.display = 'flex';
  requestAnimationFrame(() => {
    modalEl.classList.add('show');
    updateModalRevealFromToggles();
  });
}
function closeModal() {
  modalEl.classList.remove('show');
  setTimeout(()=>{ backdrop.style.display = 'none'; }, 150);
}

/* =================== Drawing =================== */
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

  ctx.beginPath(); ctx.arc(0,0, radius, 0, TAU); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();

  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let i=1;i<=5;i++){ ctx.beginPath(); ctx.arc(0,0, radius*(i/5), 0, TAU); ctx.stroke(); }
  ctx.restore();
}

function drawWheel() {
  const data = getCurrentData();
  const N = data.length;

  const ctx = wheel.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const W = wheel.width / DPR;
  const H = wheel.height / DPR;

  if (N === 0) {
    drawGradientIdle(ctx, W, H);
    updateSelectionBanner();
    return;
  }
  updateSelectionBanner();

  const hideContents = N > PERF.hideContentsThreshold;

  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2, H/2);
  ctx.rotate(mod(currentAngle, TAU));

  const radius = Math.min(W, H) * 0.48;
  const sliceAngle = TAU / N;

  // Wedges
  for (let i=0;i<N;i++) {
    const t = data[i] || {};
    const startAngle = i * sliceAngle;
    const endAngle   = (i + 1) * sliceAngle;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0, radius, startAngle, endAngle); ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // Selected rim (when not hiding)
  if (!hideContents && selectedIdx >= 0 && selectedIdx < N) {
    const a0 = selectedIdx * sliceAngle;
    const a1 = (selectedIdx + 1) * sliceAngle;
    ctx.save();
    ctx.beginPath(); ctx.arc(0,0, radius - 1, a0, a1);
    ctx.lineWidth = Math.max(2, Math.round(radius * 0.015));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.restore();
  }

  if (!hideContents) {
    for (let i=0;i<N;i++) {
      const t = data[i] || {};
      const a0 = i * sliceAngle;
      const a1 = (i + 1) * sliceAngle;
      const aMid = (a0 + a1) / 2;
      const sliceArc = radius * (a1 - a0);

      const nameTargetPx = clamp(12, 0.20 * sliceArc, 24);
      let   logoSize     = clamp(28, 0.40 * sliceArc, 64);
      const logoHalf = logoSize / 2;
      const pad = 10;

      ctx.save();
      ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0, radius-1, a0, a1); ctx.closePath(); ctx.clip();

      ctx.rotate(aMid);
      const needFlip = Math.cos(aMid) < 0;
      if (needFlip) ctx.rotate(Math.PI);
      const sign = needFlip ? -1 : 1;

      const xLogo = sign * (radius * 0.74);
      const xText = sign * (radius * 0.42);
      const logoInner = xLogo - sign * (logoHalf + pad);
      const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

      // Decide what to draw by MODE + toggles
      if (MODE === 'team') {
        const canName   = !!optName?.checked && t.team_name && maxTextWidth >= PERF.minTextWidth;
        const canLogo   = !!optLogo?.checked && t.logo_url && (logoHalf * 2) >= PERF.minLogoBox;
        const canStad   = !!optStadium?.checked && t.stadium && maxTextWidth >= PERF.minTextWidth;

        // Name (bold) and Stadium (smaller) stacked
        if (canName || canStad) {
          ctx.save();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          const fg = '#fff';
          const strokeCol = 'rgba(12,16,28,0.65)';

          let cursorY = 0;
          if (canName) {
            const fit = fitSingleLine(ctx, t.team_name, { maxWidth: maxTextWidth, targetPx: nameTargetPx, minPx: 9, maxPx: 24, weight: 800 });
            const px = fit.fontPx;
            ctx.font = `800 ${px}px Inter, system-ui, sans-serif`;
            ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(px/10));
            ctx.fillStyle = fg;
            ctx.strokeText(fit.text, xText, cursorY - px*0.6);
            ctx.fillText(fit.text,   xText, cursorY - px*0.6);
            cursorY += 2;
          }
          if (canStad) {
            const fit2 = fitSingleLine(ctx, t.stadium, { maxWidth: maxTextWidth, targetPx: Math.max(10, nameTargetPx*0.8), minPx: 8, maxPx: 18, weight: 700 });
            const px2 = fit2.fontPx;
            ctx.font = `700 ${px2}px Inter, system-ui, sans-serif`;
            ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(px2/10));
            ctx.fillStyle = 'rgba(235,245,255,0.95)';
            ctx.strokeText(fit2.text, xText, cursorY + px2*0.6);
            ctx.fillText(fit2.text,   xText, cursorY + px2*0.6);
          }
          ctx.restore();
        }
        if (canLogo) {
          ctx.save();
          ctx.translate(xLogo, 0);
          ctx.beginPath(); ctx.arc(0, 0, logoHalf, 0, TAU); ctx.closePath();
          ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
          ctx.save();
          ctx.beginPath(); ctx.arc(0,0,logoHalf-1,0,TAU); ctx.closePath(); ctx.clip();
          const img = getImg(t.logo_url, () => requestAnimationFrame(drawWheel));
          if (img && img.complete) {
            const box = Math.max(4, 2*(logoHalf-1));
            const iw=img.naturalWidth||box, ih=img.naturalHeight||box;
            const s = Math.min(box/iw, box/ih);
            ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s);
          } else {
            ctx.fillStyle='rgba(255,255,255,0.12)'; const ph=(logoHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph);
          }
          ctx.restore(); ctx.restore();
        }
      } else {
        // PLAYER mode
        const canName   = !!optName?.checked && t.name && maxTextWidth >= PERF.minTextWidth;
        const canImage  = !!optLogo?.checked && t.image_url && (logoHalf * 2) >= PERF.minLogoBox; // reusing optLogo as "Image"
        const canJersey = !!optStadium?.checked && t.jersey && maxTextWidth >= PERF.minTextWidth; // reusing optStadium as "Jersey"
        const canNat    = !!optLeague?.checked && t.nationality && maxTextWidth >= PERF.minTextWidth; // reusing optLeague as "Nationality"

        // Name (bold) + either Jersey or Nationality line (if enabled)
        if (canName || canJersey || canNat) {
          ctx.save();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          const strokeCol = 'rgba(12,16,28,0.65)';

          let y = 0;
          if (canName) {
            const fit = fitSingleLine(ctx, t.name, { maxWidth: maxTextWidth, targetPx: nameTargetPx, minPx: 9, maxPx: 24, weight: 800 });
            const px = fit.fontPx;
            ctx.font = `800 ${px}px Inter, system-ui, sans-serif`;
            ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(px/10));
            ctx.fillStyle = '#fff';
            ctx.strokeText(fit.text, xText, y - px*0.6);
            ctx.fillText(fit.text,   xText, y - px*0.6);
            y += 2;
          }
          const subText = canJersey ? `#${t.jersey}` : (canNat ? t.nationality : '');
          if (subText) {
            const fit2 = fitSingleLine(ctx, subText, { maxWidth: maxTextWidth, targetPx: Math.max(10, nameTargetPx*0.8), minPx: 8, maxPx: 18, weight: 700 });
            const px2 = fit2.fontPx;
            ctx.font = `700 ${px2}px Inter, system-ui, sans-serif`;
            ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(px2/10));
            ctx.fillStyle = 'rgba(235,245,255,0.95)';
            ctx.strokeText(fit2.text, xText, y + px2*0.6);
            ctx.fillText(fit2.text,   xText, y + px2*0.6);
          }
          ctx.restore();
        }
        if (canImage) {
          ctx.save();
          ctx.translate(xLogo, 0);
          ctx.beginPath(); ctx.arc(0, 0, logoHalf, 0, TAU); ctx.closePath();
          ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
          ctx.save();
          ctx.beginPath(); ctx.arc(0,0,logoHalf-1,0,TAU); ctx.closePath(); ctx.clip();
          const img = getImg(t.image_url, () => requestAnimationFrame(drawWheel));
          if (img && img.complete) {
            const box = Math.max(4, 2*(logoHalf-1));
            const iw=img.naturalWidth||box, ih=img.naturalHeight||box;
            const s = Math.min(box/iw, box/ih);
            ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s);
          } else {
            ctx.fillStyle='rgba(255,255,255,0.12)'; const ph=(logoHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph);
          }
          ctx.restore(); ctx.restore();
        }
      }

      ctx.restore(); // wedge clip
    }
  }

  ctx.restore();
}

/* =================== Spin / Result =================== */
function setResult(idx) {
  const data = getCurrentData();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  // Push compact item to history (mode-aware label)
  if (MODE === 'team') {
    history.unshift({ team_name: t.team_name, logo_url: t.logo_url, league_code: t.league_code });
  } else {
    history.unshift({ team_name: `${t.name} (${t.club || t.club_code || '—'})`, logo_url: t.image_url, league_code: 'PLAYER' });
  }
  if (history.length > 50) history = history.slice(0,50);
  localStorage.setItem('clubHistory', JSON.stringify(history));
  renderHistory();

  openModal(t);
}

function spin() {
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) return;

  spinning = true; lockUI(true);
  spinBtn.disabled = true; spinFab.disabled = true; selectedIdx = -1;

  const N = data.length;
  const slice = TAU / N;
  const extraTurns = 6 + Math.floor(Math.random()*3);
  const targetAngle = TAU * extraTurns + Math.random()*TAU;

  const start = performance.now();
  const duration = 3200;
  const easeOutCubic = x => 1 - Math.pow(1-x, 3);

  function anim(now) {
    const p = clamp(0, (now - start) / duration, 1);
    currentAngle = targetAngle * easeOutCubic(p);
    drawWheel();

    if (p < 1) { requestAnimationFrame(anim); }
    else {
      const theta = mod(currentAngle, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;

      // snap
      const centerAngle = idx * slice + slice/2;
      const snapDelta = mod(centerAngle - offset, TAU);
      currentAngle = mod(currentAngle + snapDelta, TAU);

      spinning = false; lockUI(false);
      const hasAny = getCurrentData().length > 0;
      spinBtn.disabled = !hasAny; spinFab.disabled = !hasAny;

      selectedIdx = idx; drawWheel(); setResult(idx);
    }
  }
  requestAnimationFrame(anim);
}

/* =================== History =================== */
function renderHistory() {
  const el = document.getElementById('history');
  if (!el) return;
  el.innerHTML = '';
  if (history.length === 0) {
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
    return;
  }
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    const i = document.createElement('img');
    i.src = item.logo_url || '';
    i.alt = `${item.team_name} image`;
    i.onerror = () => { i.src=''; i.alt='No image'; };
    const s = document.createElement('span');
    const full = LEAGUE_LABELS[item.league_code] || item.league_code;
    s.textContent = `${item.team_name}${full ? ' ('+full+')' : ''}`;
    div.append(i, s);
    el.append(div);
  });
}

/* =================== Loaders =================== */
async function loadPlayers() {
  const urls = ['/data/players.json', '/players/players.json'];
  let json = null;
  for (const u of urls) {
    try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) { json = await r.json(); break; } } catch {}
  }
  if (!json) throw new Error('players.json not found');

  PLAYERS = json.map(p => {
    const club_id = Number(p.club_id ?? p.team_id ?? p.clubId ?? 0) || 0;
    const club_code = TEAM_CODE[club_id] || (String(p.club || '').slice(0,3).toUpperCase() || 'UNK');
    const club_name = p.club || p.team || club_code;
    const img = p.image_url || p.image || p.photo || '/players/silhouette-player.png';
    const name = p.name || p.player_name || 'Player';
    const jersey = (p.jersey_number ?? p.number ?? '').toString().replace(/^#?/, '');

    return {
      // Wheel draw fields
      team_name: name,
      logo_url: img,
      primary_color: '#163058',
      stadium: '',

      // Player meta
      name,
      image_url: img,
      jersey,
      nationality: p.nationality || p.country || '',
      club: club_name,
      club_code,
      club_id
    };
  });

  // Optional preview list
  if (playerListEl) {
    playerListEl.innerHTML = '';
    PLAYERS.slice(0, 60).forEach(pl => {
      const el = document.createElement('div');
      el.className = 'player-item';
      el.innerHTML = `<img src="${pl.image_url}" alt="${pl.name}" width="40" height="40" style="border-radius:10px;object-fit:cover;margin-right:8px"> ${pl.name} — ${pl.club}`;
      playerListEl.appendChild(el);
    });
  }
}

/* =================== Mode =================== */
function relabelShowOnWheel() {
  if (!lblName || !lblLogo || !lblSub1 || !lblSub2) return;
  if (MODE === 'team') {
    lblLogo.textContent = 'Logo';
    lblName.textContent = 'Name';
    lblSub1.textContent = 'Stadium';
    lblSub2.textContent = 'League';
  } else {
    lblLogo.textContent = 'Image';
    lblName.textContent = 'Name';
    lblSub1.textContent = 'Jersey Number';
    lblSub2.textContent = 'Nationality';
  }
}

async function setMode(next) {
  if (next === MODE) return;
  MODE = next;
  localStorage.setItem('fsMode', MODE);

  modeTeamBtn?.classList.toggle('mode-btn-active', MODE === 'team');
  modePlayerBtn?.classList.toggle('mode-btn-active', MODE === 'player');
  modeTeamBtn?.setAttribute('aria-pressed', MODE === 'team' ? 'true' : 'false');
  modePlayerBtn?.setAttribute('aria-pressed', MODE === 'player' ? 'true' : 'false');

  teamView?.classList.toggle('hidden', MODE === 'player');
  playerView?.classList.toggle('hidden', MODE === 'team');

  relabelShowOnWheel();

  if (MODE === 'player') {
    if (!PLAYERS.length) { try { await loadPlayers(); } catch(e) { console.warn('players.json failed:', e); } }
    renderPlayerChips();
    selectedIdx = -1;
    sizeCanvas(); drawWheel(); updateSpinAvailability(); updateSelectionBanner();
  } else {
    renderTeamChips();
    setCheckedCodes(['EPL']); // default league
    selectedIdx = -1;
    sizeCanvas(); drawWheel(); updateSpinAvailability(); updateSelectionBanner();
  }
}

/* =================== Events / Boot =================== */
function setupEventListeners() {
  modeTeamBtn?.addEventListener('click', () => setMode('team'));
  modePlayerBtn?.addEventListener('click', () => setMode('player'));

  chipsWrap.addEventListener('change', () => {
    if (spinning) return;
    selectedIdx = -1;
    drawWheel();
    updateSpinAvailability();
    updateSelectionBanner();
  });

  toggleMore.addEventListener('click', () => {
    if (spinning) return;
    const hidden = chipsMore.hidden;
    chipsMore.hidden = !hidden;
    toggleMore.textContent = hidden
      ? (MODE === 'player' ? 'Show fewer clubs' : 'Show fewer leagues')
      : (MODE === 'player' ? 'Show more Premier League clubs' : 'Show more leagues');
    toggleMore.setAttribute('aria-expanded', String(!hidden));
  });

  const onWheelToggleChange = () => {
    if (spinning) return;
    drawWheel();
    if (isModalOpen()) updateModalRevealFromToggles();
  };
  optName?.addEventListener('change', onWheelToggleChange);
  optLogo?.addEventListener('change', onWheelToggleChange);
  optStadium?.addEventListener('change', onWheelToggleChange);
  optLeague?.addEventListener('change', onWheelToggleChange);

  spinBtn?.addEventListener('click', spin);
  spinFab?.addEventListener('click', spin);

  resetHistoryBtn?.addEventListener('click', ()=>{ if (!spinning) { history=[]; localStorage.setItem('clubHistory','[]'); renderHistory(); } });
  mClose?.addEventListener('click', ()=>{ if (!spinning) closeModal(); });
  backdrop?.addEventListener('click', e => { if(!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(!spinning && e.key==='Escape' && isModalOpen()) closeModal(); });

  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(()=>{ sizeCanvas(); drawWheel(); }, 120);
  }, { passive:true });
}

/* =================== Boot =================== */
fetch(`./teams.json?v=${Date.now()}`)
  .then(r => r.json())
  .then(data => {
    TEAMS = data || [];
    ensureRevealStyles();
    renderTeamChips();
    renderHistory();
    sizeCanvas();
    relabelShowOnWheel();
    setCheckedCodes(['EPL']);   // default: EPL selected in TEAM
    drawWheel();
    setupEventListeners();

    // reflect saved choice
    if (MODE === 'player') {
      // Switch after initial TEAM render to build DOM & labels correctly
      setMode('player');
    } else {
      modeTeamBtn?.classList.add('mode-btn-active');
      updateSpinAvailability();
    }
  })
  .catch(err => {
    console.error('Failed to load teams.json', err);
    sizeCanvas(); drawGradientIdle(wheel.getContext('2d'), wheel.width, wheel.height);
  });
