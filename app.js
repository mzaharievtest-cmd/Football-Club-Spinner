/**
 * app.js
 * Football Club Spinner — main UI logic (fixed: ensure `spin` is defined before it's used)
 *
 * NOTE: Replace your deployed app.js with this file and hard-refresh (Ctrl/Cmd+Shift+R).
 *
 * Fix summary:
 * - There was a runtime ReferenceError ("spin is not defined") because some event wiring
 *   referenced `spin` before it existed in the global scope (caused by a non-hoisted
 *   declaration or reordering in previous edits).
 * - This file ensures `spin` is a function declaration (hoisted) and is defined before
 *   any code that references it (setupEventListeners). That prevents the ReferenceError.
 *
 * The rest of the file preserves the previous fixes:
 * - robust getShowOptions()
 * - resilient show-on-wheel event handling (change + click + MutationObserver)
 * - modal stadium show/hide based on show-on-wheel "Stadium" toggle
 * - draw order: text first, logos on top
 * - safe image loading and DPR handling
 *
 * If you still see errors after deploying, paste the console output and I'll iterate.
 */

'use strict';

const DEBUG = false;

// -------------------- App state --------------------
let TEAMS = [];
let PLAYERS = null;
let MODE = localStorage.getItem('fsMode') || 'team'; // 'team' or 'player'

let currentAngle = 0; // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory') || '[]');

// -------------------- DOM --------------------
const chipsWrap = document.getElementById('chips');
const chipsTop = document.getElementById('chipsTop');
const chipsMore = document.getElementById('chipsMore');
const toggleMore = document.getElementById('toggleMore');

const modeTeamBtn = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

const spinBtn = document.getElementById('spinBtn');
const spinFab = document.getElementById('spinFab');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const currentText = document.getElementById('currentText');
const currentLogo = document.getElementById('currentLogo');

const historyEl = document.getElementById('history');
const historyPlayersEl = document.getElementById('historyPlayers');

const teamView = document.getElementById('teamView');
const playerView = document.getElementById('playerView');
const playerListContainer = document.getElementById('playerList');

const backdrop = document.getElementById('backdrop');
const modalEl = document.getElementById('modal');
const mClose = document.getElementById('mClose');
const mHead = document.getElementById('mHead');
const mSub = document.getElementById('mSub');
const mLogo = document.getElementById('mLogo');
const mStadium = document.getElementById('mStadium');

const qpAll  = document.getElementById('qpAll');
const qpNone = document.getElementById('qpNone');
const qpTop5 = document.getElementById('qpTop5');
const perfTip = document.getElementById('perfTip');

const wheel = document.getElementById('wheel');
const fx = document.getElementById('fx');

// -------------------- Constants & Utils --------------------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;
const isModalOpen = () => backdrop && backdrop.style.display === 'flex';

const TOP5 = ['EPL','SA','BUN','L1','LLA'];
const LEAGUE_LABELS = {
  AUT: "Austrian Bundesliga", BEL: "Jupiler Pro League", BUL: "efbet Liga", CRO: "SuperSport HNL",
  CZE: "Fortuna Liga", DEN: "Superliga", EPL: "Premier League", L1:  "Ligue 1", BUN: "Bundesliga",
  GRE: "Super League 1", ISR: "Ligat ha'Al", SA:  "Serie A", NED: "Eredivisie", NOR: "Eliteserien",
  POL: "PKO BP Ekstraklasa", POR: "Liga Portugal", ROU: "SuperLiga", RUS: "Premier Liga",
  SCO: "Scottish Premiership", SRB: "Super liga Srbije", LLA: "LaLiga", SWE: "Allsvenskan",
  SUI: "Super League", TUR: "Süper Lig", UKR: "Ukrainian Premier League"
};

const PERF = {
  hideLogosThreshold: 80,
  hideTextThreshold: 140,
  minTextWidth: 44,
  minLogoBox: 28
};

const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function deviceDPR() { return Math.min(2, Math.max(1, window.devicePixelRatio || 1)); }
function _polite() { return new Promise(r => setTimeout(r, 40 + Math.random()*110)); }
function normalizeString(s){ return (s||'').toString().trim().toLowerCase().replace(/\s+/g,' '); }

// -------------------- Image fallback path --------------------
const FALLBACK_SILHOUETTE = '/players/silhouette-player.png';

// -------------------- Image cache & loader --------------------
const IMG_CACHE = new Map();

function createInlinePlaceholder(size = 256) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="100%" height="100%" fill="#071022"/>
    <g transform="translate(${size/2},${size/2})">
      <circle r="${Math.round(size*0.33)}" fill="#0d2a55" opacity="0.9"/>
      <circle r="${Math.round(size*0.28)}" fill="#071022"/>
    </g>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function safeDrawImage(ctx, img, ...args) {
  try {
    if (!img) return false;
    if (!img.complete) return false;
    if (typeof img.naturalWidth === 'number' && img.naturalWidth === 0) return false;
    ctx.drawImage(img, ...args);
    return true;
  } catch (e) {
    console.warn('safeDrawImage failed for', img && img.src, e);
    return false;
  }
}

function getLogo(url, onLoad) {
  if (!url) return null;
  const cached = IMG_CACHE.get(url);
  if (cached && cached.img) return cached.img;

  let img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    IMG_CACHE.set(url, { img, ok: true });
    onLoad && onLoad(null, img);
    requestAnimationFrame(drawWheel);
  };
  img.onerror = () => {
    console.warn('Image failed to load:', url);
    IMG_CACHE.delete(url);
    if (url !== FALLBACK_SILHOUETTE) {
      const fallbackImg = new Image();
      fallbackImg.crossOrigin = 'anonymous';
      fallbackImg.onload = () => {
        IMG_CACHE.set(url, { img: fallbackImg, ok: false });
        onLoad && onLoad(null, fallbackImg);
        requestAnimationFrame(drawWheel);
      };
      fallbackImg.onerror = () => {
        const placeholder = new Image();
        placeholder.src = createInlinePlaceholder(256);
        IMG_CACHE.set(url, { img: placeholder, ok: false });
        onLoad && onLoad(null, placeholder);
        requestAnimationFrame(drawWheel);
      };
      fallbackImg.src = FALLBACK_SILHOUETTE;
      IMG_CACHE.set(url, { img: fallbackImg, ok: false });
      return fallbackImg;
    } else {
      const placeholder = new Image();
      placeholder.src = createInlinePlaceholder(256);
      IMG_CACHE.set(url, { img: placeholder, ok: false });
      onLoad && onLoad(null, placeholder);
      requestAnimationFrame(drawWheel);
      return placeholder;
    }
  };
  img.src = url;
  IMG_CACHE.set(url, { img, ok: false });
  return img;
}

// -------------------- "Show on wheel" helpers --------------------
function _readCheckboxLike(el) {
  if (!el) return false;
  if (typeof el.checked !== 'undefined') return !!el.checked;
  const a = el.getAttribute && el.getAttribute('aria-checked');
  if (a === 'true') return true;
  if (a === 'false') return false;
  const input = el.querySelector && el.querySelector('input[type="checkbox"]');
  if (input) return !!input.checked;
  return false;
}

function getShowOptions() {
  try {
    const container = document.getElementById('showOnWheel') || document.querySelector('.showopts');
    if (container) {
      const readOne = (selectors) => {
        for (const sel of selectors) {
          try {
            const el = container.querySelector(sel);
            if (el) return _readCheckboxLike(el);
          } catch (_) {}
        }
        return false;
      };
      return {
        name: readOne(['#optName', 'input[data-show="name"]', 'input[name="show-name"]', '[data-show="name"]']),
        logo: readOne(['#optLogo', 'input[data-show="logo"]', 'input[name="show-logo"]', '[data-show="logo"]']),
        stadium: readOne(['#optStadium', 'input[data-show="stadium"]', 'input[name="show-stadium"]', '[data-show="stadium"]']),
        league: readOne(['#optLeague', 'input[data-show="league"]', 'input[name="show-league"]', '[data-show="league"]'])
      };
    }
  } catch (e) {
    if (DEBUG) console.warn('getShowOptions container read failed', e);
  }

  const byId = (id) => {
    const el = document.getElementById(id);
    if (el != null) return _readCheckboxLike(el);
    return null;
  };
  const n = byId('optName'), l = byId('optLogo'), s = byId('optStadium'), q = byId('optLeague');
  if (n !== null || l !== null || s !== null || q !== null) {
    return { name: !!n, logo: !!l, stadium: !!s, league: !!q };
  }

  const qf = (selList) => {
    for (const sel of selList) {
      const el = document.querySelector(sel);
      if (el && _readCheckboxLike(el)) return true;
    }
    return false;
  };
  return {
    name: qf(['input[data-show="name"]', 'input[name="show-name"]', 'input#optName', '[data-show="name"]']),
    logo: qf(['input[data-show="logo"]', 'input[name="show-logo"]', 'input#optLogo', '[data-show="logo"]']),
    stadium: qf(['input[data-show="stadium"]', 'input[name="show-stadium"]', 'input#optStadium', '[data-show="stadium"]']),
    league: qf(['input[data-show="league"]', 'input[name="show-league"]', 'input#optLeague', '[data-show="league"]'])
  };
}

// -------------------- Drawing helpers (ellipsize, gradient) --------------------
function ellipsizeText(ctx, text, maxWidth, font) {
  if (!text) return '';
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = text.slice(0, mid) + '…';
    if (ctx.measureText(t).width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  return text.slice(0, Math.max(0, lo - 1)) + '…';
}

function drawGradientIdle(ctx, W, H) {
  const DPR = deviceDPR();
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2,H/2);
  const radius = Math.min(W,H) * 0.48;
  const g = ctx.createRadialGradient(0,0, radius*0.1, 0,0, radius);
  g.addColorStop(0.00, '#1A2C5A');
  g.addColorStop(0.35, '#21386F');
  g.addColorStop(0.65, '#0E2A57');
  g.addColorStop(1.00, '#0B1B38');
  ctx.beginPath();
  ctx.arc(0,0, radius,0,TAU);
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

// -------------------- Drawing (wheel) --------------------
function drawWheel(){
  if (!wheel) return;
  const ctx = wheel.getContext && wheel.getContext('2d');
  if (!ctx) return;
  const data = getCurrentData();
  const N = data.length;
  const DPR = deviceDPR();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const W = wheel.width / DPR;
  const H = wheel.height / DPR;

  if (N === 0) {
    drawGradientIdle(ctx, W, H);
    if (perfTip) perfTip.textContent = `0 ${MODE === 'player' ? 'players' : 'teams'} selected`;
    return;
  }

  const hideLogos = (MODE === 'team') ? (N >= PERF.hideLogosThreshold) : (N >= 300);
  const hideText  = N >= PERF.hideTextThreshold;
  if (perfTip) perfTip.textContent = `${N} ${MODE === 'player' ? 'players' : 'teams'} selected`;

  ctx.imageSmoothingEnabled = !hideText;
  ctx.imageSmoothingQuality = hideText ? 'low' : 'high';
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2,H/2);

  const angleDraw = mod(currentAngle, TAU);
  ctx.rotate(angleDraw);

  const radius = Math.min(W,H) * 0.48;
  const sliceAngle = TAU / N;

  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const startAngle = i * sliceAngle;
    const endAngle   = (i + 1) * sliceAngle;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, startAngle, endAngle);
    ctx.closePath();
    if (MODE === 'team') {
      ctx.fillStyle = t.primary_color || '#4f8cff';
    } else {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(16,24,40,0.92)' : 'rgba(10,16,28,0.92)';
    }
    ctx.fill();
  }

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

  const show = getShowOptions();

  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const a0 = i * sliceAngle;
    const a1 = (i + 1) * sliceAngle;
    const aMid = (a0 + a1) / 2;
    const sliceArc = radius * (a1 - a0);

    const logoSize = clamp(28, 0.40 * sliceArc, 64);
    const logoHalf = logoSize / 2;
    const basePad = 10;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius - 1, a0, a1);
    ctx.closePath();
    ctx.clip();

    ctx.save();
    ctx.rotate(aMid);
    const needFlip = Math.cos(aMid) < 0;
    if (needFlip) ctx.rotate(Math.PI);
    const sign = needFlip ? -1 : 1;

    let xLogo = sign * (radius * 0.74);
    let xText = sign * (radius * 0.48);
    const logoInner = xLogo - sign * (logoHalf + basePad);
    const minGap = 16;
    if (show.logo && show.name) {
      const gap = Math.abs(logoInner - xText);
      if (gap < (logoHalf + minGap)) {
        const shift = (logoHalf + minGap) - gap;
        xText = xText - sign * shift;
      }
    }

    const xBoxLeft = Math.min(xText, logoInner);
    const maxTextWidth = Math.max(60, Math.abs(logoInner - xText));
    const namePx = Math.max(10, Math.min(16, Math.round(sliceArc * 0.06)));
    const nameFont = `700 ${namePx}px Inter, system-ui, sans-serif`;

    if (MODE === 'team') {
      const canShowName    = show.name && t.team_name && maxTextWidth >= PERF.minTextWidth;
      const canShowStadium = show.stadium && t.stadium && maxTextWidth >= PERF.minTextWidth;

      if (canShowName || canShowStadium) {
        ctx.save();
        ctx.textAlign = needFlip ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        const strokeCol = 'rgba(12,16,28,0.65)';
        const fillCol = '#fff';
        if (canShowName) {
          const nameToDraw = ellipsizeText(ctx, t.team_name, maxTextWidth, nameFont);
          ctx.font = nameFont;
          ctx.lineWidth = Math.max(1, Math.round(namePx / 10));
          ctx.strokeStyle = strokeCol;
          ctx.fillStyle = fillCol;
          ctx.strokeText(nameToDraw, xBoxLeft, 0 - (canShowStadium ? 8 : 0));
          ctx.fillText(nameToDraw, xBoxLeft, 0 - (canShowStadium ? 8 : 0));
        }
        if (canShowStadium) {
          const stadPx = Math.max(9, Math.round(sliceArc * 0.045));
          const stadFont = `700 ${stadPx}px Inter, system-ui, sans-serif`;
          const stadToDraw = ellipsizeText(ctx, t.stadium, maxTextWidth, stadFont);
          ctx.font = stadFont;
          ctx.globalAlpha = 0.92;
          ctx.strokeText(stadToDraw, xBoxLeft, 12);
          ctx.fillText(stadToDraw, xBoxLeft, 12);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }
    } else {
      const playerName = t.name || t.team_name || 'Player';
      const canShowName = show.name && playerName && maxTextWidth >= PERF.minTextWidth;
      if (canShowName) {
        ctx.save();
        ctx.textAlign = needFlip ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        const nameToDraw = ellipsizeText(ctx, playerName, maxTextWidth, nameFont);
        ctx.font = nameFont;
        ctx.fillStyle = '#fff';
        const yText = logoHalf + 8;
        ctx.fillText(nameToDraw, xBoxLeft, yText);
        ctx.restore();
      }
    }

    if (MODE === 'team') {
      const canShowLogo = show.logo && t.logo_url && logoHalf*2 >= PERF.minLogoBox;
      if (canShowLogo) {
        ctx.save();
        ctx.translate(xLogo, 0);
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
        if (img) {
          const box = Math.max(4, 2 * (logoHalf - 1));
          const iw = img.naturalWidth || box, ih = img.naturalHeight || box;
          const s = Math.min(box / iw, box / ih);
          safeDrawImage(ctx, img, -iw*s/2, -ih*s/2, iw*s, ih*s);
        }
        ctx.restore();
        ctx.restore();
      }
    } else {
      const playerImgUrl = t.image_url || t.logo_url || FALLBACK_SILHOUETTE;
      const canShowLogo = show.logo && playerImgUrl && logoHalf*2 >= PERF.minLogoBox;
      if (canShowLogo) {
        ctx.save();
        ctx.translate(xLogo, 0);
        ctx.beginPath();
        ctx.arc(0, 0, logoHalf, 0, TAU);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.stroke();

        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, logoHalf - 1, 0, TAU);
        ctx.closePath();
        ctx.clip();

        const img = getLogo(playerImgUrl, () => requestAnimationFrame(drawWheel));
        if (img) {
          const box = Math.max(4, 2 * (logoHalf - 1));
          const iw = img.naturalWidth || box, ih = img.naturalHeight || box;
          const s = Math.min(box / iw, box / ih);
          safeDrawImage(ctx, img, -iw*s/2, -ih*s/2, iw*s, ih*s);
        }
        ctx.restore();
        ctx.restore();
      }
    }

    ctx.restore(); // rotation
    ctx.restore(); // clip
  }

  ctx.restore();
}

// -------------------- Spin / Result --------------------
// Ensure spin is a function declaration (hoisted) and available before listeners that reference it.
function spin() {
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) {
    if (currentText) currentText.textContent = `Please select at least one ${MODE === 'player' ? 'player' : 'league'}.`;
    return;
  }

  spinning = true;
  lockUI(true);
  if (spinBtn) spinBtn.disabled = true;
  if (spinFab) spinFab.disabled = true;
  selectedIdx = -1;

  const N = data.length;
  const slice = TAU / N;
  const extraTurns  = prefersReducedMotion ? 1 : 6 + Math.floor(Math.random()*3);
  const finalOffset = Math.random() * TAU;
  const targetAngle = TAU * extraTurns + finalOffset;

  const start = performance.now();
  const duration = prefersReducedMotion ? 600 : 3200;
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
      lockUI(false);
      const hasAny = getCurrentData().length > 0;
      if (spinBtn) spinBtn.disabled = !hasAny;
      if (spinFab) spinFab.disabled = !hasAny;
      selectedIdx = idx;
      drawWheel();
      setResult(idx);
    }
  }
  requestAnimationFrame(anim);
}

// -------------------- Other helpers (lockUI, chips, history, modal) --------------------
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

function renderChips() {
  const allCodes = [...new Set(TEAMS.map(t => t.league_code))];
  const topCodes = TOP5.filter(c => allCodes.includes(c));
  const moreCodes = allCodes.filter(c => !topCodes.includes(c)).sort();

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  topCodes.forEach(code => chipsTop.appendChild(makeChip(code, code === 'EPL')));
  moreCodes.forEach(code => chipsMore.appendChild(makeChip(code, false)));

  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more leagues';
  toggleMore.setAttribute('aria-expanded', 'false');
  toggleMore.disabled = false;
  toggleMore.classList.remove('disabled');
}

function makeChip(code, checked) {
  const full = LEAGUE_LABELS[code] || code;
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${escapeHtml(code)}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${escapeHtml(full)}">
    <span class="chip-text" title="${escapeHtml(full)}">${escapeHtml(full)}</span>
  `;
  return label;
}

function setCheckedCodes(codes = []) {
  const set = new Set(codes);
  chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => {
    i.checked = set.has(i.value);
    i.setAttribute('aria-checked', i.checked ? 'true' : 'false');
  });
  selectedIdx = -1;
  drawWheel();
  const hasAny = getCurrentData().length > 0;
  if (spinBtn) spinBtn.disabled = !hasAny;
  if (spinFab) spinFab.disabled = !hasAny;
  if (!hasAny && currentText) {
    currentText.textContent = `Please select at least one ${MODE === 'player' ? 'player league' : 'league'}.`;
  }
  if (perfTip) {
    const n = getCurrentData().length;
    perfTip.textContent = `${n} ${MODE === 'player' ? 'players' : 'teams'} selected`;
  }
}

function renderHistory() {
  if (historyEl) {
    historyEl.innerHTML = '';
    if (history.length === 0) {
      historyEl.setAttribute('aria-live', 'polite');
      historyEl.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
    } else {
      history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'item';
        const i = document.createElement('img');
        i.src = item.logo_url || item.image_url || '';
        i.alt = `${item.team_name || item.name || 'Item'} image`;
        i.className = 'history-logo';
        i.width = 38; i.height = 38;
        i.onerror = () => { i.src = ''; i.alt = 'No image'; };
        const s = document.createElement('span');
        const label = item.team_name || item.name || (LEAGUE_LABELS[item.league_code] || item.league_code) || '—';
        s.textContent = `${label}`;
        div.append(i, s);
        historyEl.append(div);
      });
    }
  }

  if (historyPlayersEl) {
    historyPlayersEl.innerHTML = historyEl ? historyEl.innerHTML : '';
  }
}

// -------------------- Modal helpers (respect show-on-wheel stadium) --------------------
function resolveStadiumForItem(item) {
  if (!item) return '';
  if (item.stadium && String(item.stadium).trim()) return String(item.stadium).trim();
  if (item.meta && item.meta.stadium && String(item.meta.stadium).trim()) return String(item.meta.stadium).trim();
  const candidate = item.team_name || item.name || item.club || item.team || '';
  if (candidate && TEAMS && TEAMS.length) {
    const norm = normalizeString(candidate);
    const match = TEAMS.find(x => normalizeString(x.team_name) === norm || normalizeString(x.team_name).includes(norm));
    if (match && match.stadium && String(match.stadium).trim()) return String(match.stadium).trim();
  }
  return '';
}

function openModal({ team_name = '', league_code = '', logo_url = '', stadium = '' } = {}) {
  if (!backdrop || !modalEl) return;

  mHead.textContent = team_name || '';
  mSub.textContent = league_code ? (LEAGUE_LABELS[league_code] || league_code) : '';
  if (mLogo) { mLogo.src = logo_url || ''; mLogo.alt = team_name ? `${team_name} image` : 'Image'; }

  let show = { stadium: true };
  try { show = (typeof getShowOptions === 'function') ? getShowOptions() : show; } catch (e) {}

  const stadiumRow = mStadium ? mStadium.parentElement : null;
  if (show && show.stadium) {
    if (stadiumRow) stadiumRow.style.display = '';
    if (mStadium) mStadium.textContent = stadium && String(stadium).trim() ? String(stadium).trim() : '—';
  } else {
    if (stadiumRow) stadiumRow.style.display = 'none';
    if (mStadium) mStadium.textContent = '';
  }

  backdrop.style.display = 'flex';
  requestAnimationFrame(() => modalEl.classList.add('show'));
  try { mClose && mClose.focus(); } catch (e) {}
}

// -------------------- Events / Boot --------------------
function setupEventListeners() {
  if (chipsWrap) {
    chipsWrap.addEventListener('change', () => {
      if (spinning) return;
      selectedIdx = -1;
      drawWheel();
      const len = getCurrentData().length;
      if (spinBtn) spinBtn.disabled = len === 0;
      if (spinFab) spinFab.disabled = len === 0;
      if (len === 0 && currentText) {
        currentText.textContent = `Please select at least one ${MODE === 'player' ? 'player league' : 'league'}.`;
      }
      if (perfTip) {
        perfTip.textContent = `${len} ${MODE === 'player' ? 'players' : 'teams'} selected`;
      }
    });
  }

  if (toggleMore) {
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
  }

  const showChangeHandler = (e) => {
    if (spinning) return;
    const t = e.target;
    if (!t) return;
    const inShowArea = !!(t.closest && (t.closest('#showOnWheel') || t.closest('.showopts')));
    if (!inShowArea) return;
    if (DEBUG) console.log('show-on-wheel toggled', getShowOptions());
    drawWheel();
    const n = getCurrentData().length;
    if (spinBtn) spinBtn.disabled = n === 0;
    if (spinFab) spinFab.disabled = n === 0;
    if (perfTip) perfTip.textContent = `${n} ${MODE === 'player' ? 'players' : 'teams'} selected`;
  };

  document.addEventListener('change', showChangeHandler, { capture: false });
  document.addEventListener('click', showChangeHandler, { capture: false });

  try {
    const container = document.getElementById('showOnWheel') || document.querySelector('.showopts');
    if (container) {
      const mo = new MutationObserver(() => { drawWheel(); });
      mo.observe(container, { childList: true, subtree: true, attributes: true });
    }
  } catch (e) {}

  if (spinBtn) spinBtn.onclick = spin;
  if (spinFab) spinFab.onclick = spin;

  if (resetHistoryBtn) {
    resetHistoryBtn.addEventListener('click', () => {
      if (!spinning) {
        history = [];
        localStorage.removeItem('clubHistory');
        renderHistory();
      }
    });
  }

  if (mClose) mClose.onclick = () => { if (!spinning) closeModal(); };
  if (backdrop) {
    backdrop.addEventListener('click', e => { if(!spinning && e.target===backdrop) closeModal(); });
  }
  window.addEventListener('keydown', e => { if(!spinning && e.key==='Escape' && isModalOpen()) closeModal(); });

  if (qpAll) {
    qpAll.addEventListener('click', () => {
      chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = true; i.setAttribute('aria-checked', 'true'); });
      selectedIdx = -1; drawWheel();
      const n = getCurrentData().length; if (spinBtn) spinBtn.disabled = n === 0; if (spinFab) spinFab.disabled = n === 0;
      if (perfTip) perfTip.textContent = `${n} ${MODE === 'player' ? 'players' : 'teams'} selected`;
    });
  }
  if (qpNone) {
    qpNone.addEventListener('click', () => {
      chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = false; i.setAttribute('aria-checked', 'false'); });
      selectedIdx = -1; drawWheel();
      if (spinBtn) spinBtn.disabled = true;
      if (spinFab) spinFab.disabled = true;
      if (currentText) currentText.textContent = `Please select at least one ${MODE === 'player' ? 'player league' : 'league'}.`;
      if (perfTip) perfTip.textContent = `0 ${MODE === 'player' ? 'players' : 'teams'} selected`;
    });
  }
  if (qpTop5) {
    qpTop5.addEventListener('click', () => { const codes = TOP5; setCheckedCodes(codes); });
  }

  let resizeTO;
  window.addEventListener('resize', () => { clearTimeout(resizeTO); resizeTO = setTimeout(() => { sizeCanvas(); drawWheel(); }, 120); }, { passive: true });

  // initial sync
  const n = getCurrentData().length;
  if (spinBtn) spinBtn.disabled = n === 0;
  if (spinFab) spinFab.disabled = n === 0;
  if (perfTip) perfTip.textContent = `${n} ${MODE === 'player' ? 'players' : 'teams'} selected`;
}

// -------------------- Canvas sizing --------------------
function sizeCanvas() {
  const rect = (wheel.parentElement || wheel).getBoundingClientRect();
  const cssSize = clamp(300, Math.round(rect.width || 640), 1200);
  const DPR = deviceDPR();
  wheel.width = Math.round(cssSize * DPR);
  wheel.height = Math.round(cssSize * DPR);
  fx.width = wheel.width;
  fx.height = wheel.height;
  wheel.style.width = cssSize + 'px';
  wheel.style.height = cssSize + 'px';
  fx.style.width = cssSize + 'px';
  fx.style.height = cssSize + 'px';
}

// -------------------- Boot --------------------
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

fetch(`./teams.json?v=${Date.now()}`)
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    renderChips();
    renderHistory();
    sizeCanvas();
    setCheckedCodes(['EPL']);
    if (MODE === 'player') {
      setMode('player');
    } else {
      setMode('team');
    }
    setupEventListeners();
    drawWheel();
  })
  .catch(err => {
    console.error('Failed to load teams.json', err);
    if (currentText) currentText.textContent = 'Failed to load teams.';
  });

// Expose helpers for debugging
window.__fs = { drawWheel, spin, setMode, loadPlayers, TEAMS, PLAYERS, getCurrentData };
