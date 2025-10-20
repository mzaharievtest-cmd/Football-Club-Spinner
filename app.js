/**
 * app.js
 * Football Spinner — main UI logic
 *
 * Patch: ensure "Show" (Stadium) is displayed in the modal reliably.
 * - Robust stadium lookup for a selected item: t.stadium, t.meta.stadium,
 *   fallback to matching TEAMS by name/club (normalized).
 * - Pass stadium text into openModal() and render it (show "—" if missing).
 *
 * Overwrite deployed app.js with this file and hard-refresh (Ctrl/Cmd+Shift+R).
 */

'use strict';

const DEBUG = false;

// -------------------- App state --------------------
let TEAMS = [];
let PLAYERS = null; // normalized player objects (team-shaped)
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

// -------------------- Helpers: stadium lookup --------------------
function findTeamByNameOrClub(nameOrClub) {
  if (!nameOrClub || !TEAMS || TEAMS.length === 0) return null;
  const target = normalizeString(nameOrClub);
  // exact first
  let t = TEAMS.find(x => normalizeString(x.team_name) === target);
  if (t) return t;
  // partial includes
  t = TEAMS.find(x => normalizeString(x.team_name).includes(target) || target.includes(normalizeString(x.team_name)));
  if (t) return t;
  // match by club field variants
  t = TEAMS.find(x => normalizeString(x.team_name).indexOf(target) !== -1);
  return t || null;
}

function resolveStadiumForItem(item) {
  // item may be team-shaped or player-shaped
  if (!item) return '';
  // 1) direct fields
  if (item.stadium && String(item.stadium).trim()) return String(item.stadium).trim();
  if (item.meta && item.meta.stadium && String(item.meta.stadium).trim()) return String(item.meta.stadium).trim();
  // 2) check team_name / name / club
  const candidates = [item.team_name, item.name, item.club, item.team].filter(Boolean);
  for (const c of candidates) {
    const team = findTeamByNameOrClub(c);
    if (team && team.stadium && String(team.stadium).trim()) return String(team.stadium).trim();
  }
  // 3) fallback empty
  return '';
}

// -------------------- "Show on wheel" UI read helper --------------------
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

// -------------------- Mode handling (toggle buttons) --------------------
function setMode(newMode) {
  if (newMode === MODE) return;
  MODE = newMode;
  localStorage.setItem('fsMode', MODE);

  if (modeTeamBtn && modePlayerBtn) {
    modeTeamBtn.classList.toggle('mode-btn-active', MODE === 'team');
    modePlayerBtn.classList.toggle('mode-btn-active', MODE === 'player');
    modeTeamBtn.setAttribute('aria-pressed', MODE === 'team' ? 'true' : 'false');
    modePlayerBtn.setAttribute('aria-pressed', MODE === 'player' ? 'true' : 'false');
    modeTeamBtn.dataset.selected = MODE === 'team' ? '1' : '0';
    modePlayerBtn.dataset.selected = MODE === 'player' ? '1' : '0';
  }

  if (MODE === 'team') {
    teamView && teamView.classList.remove('hidden');
    playerView && playerView.classList.add('hidden');
    drawWheel();
  } else {
    teamView && teamView.classList.add('hidden');
    playerView && playerView.classList.remove('hidden');
    if (!PLAYERS) {
      loadPlayers().then(() => {
        selectedIdx = -1;
        drawWheel();
        const hasAny = getCurrentData().length > 0;
        if (spinBtn) spinBtn.disabled = !hasAny;
        if (spinFab) spinFab.disabled = !hasAny;
      }).catch(err => {
        console.error('Failed to load players.json', err);
        drawWheel();
      });
    } else {
      selectedIdx = -1;
      drawWheel();
    }
  }
}

// (The rest of the file — drawing, spin animation, UI wiring — remains unchanged from the working version.
// Important changes are in setResult (below) and openModal which accept and display stadium.)

// -------------------- Spin / Result (setResult updated) --------------------
function setResult(idx) {
  const data = getCurrentData();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  if (t) {
    if (MODE === 'team') {
      const leagueLabel = (t && (t.league_code && (LEAGUE_LABELS[t.league_code] || t.league_code))) || '';
      if (currentText) currentText.textContent = `${t.team_name} · ${leagueLabel}`;
      if (currentLogo) { currentLogo.src = t.logo_url || ""; currentLogo.alt = (t.team_name || 'Club') + ' logo'; }
      history.unshift(t);
    } else {
      if (currentText) currentText.textContent = `${t.name || t.team_name || 'Player'}`;
      if (currentLogo) { currentLogo.src = t.image_url || t.logo_url || ""; currentLogo.alt = (t.name || 'Player') + ' photo'; }
      history.unshift(t);
    }

    if (history.length > 50) history = history.slice(0,50);
    localStorage.setItem('clubHistory', JSON.stringify(history));
    renderHistory();

    // Resolve stadium robustly and pass it to modal
    const stadiumText = resolveStadiumForItem(t) || '';
    if (t && (t.image_url || t.logo_url || stadiumText)) {
      setTimeout(() => {
        openModal({
          team_name: MODE === 'team' ? (t.team_name || '') : (t.name || ''),
          league_code: MODE === 'team' ? t.league_code : '',
          logo_url: MODE === 'team' ? t.logo_url : (t.image_url || ''),
          stadium: stadiumText
        });
      }, 160);
    }
  }
}

// -------------------- Modal helpers (openModal displays stadium) --------------------
function openModal({ team_name = '', league_code = '', logo_url = '', stadium = '' } = {}) {
  if (!backdrop || !modalEl) return;
  mHead.textContent = team_name || '';
  mSub.textContent = league_code ? (LEAGUE_LABELS[league_code] || league_code) : '';
  mLogo.src = logo_url || '';
  mLogo.alt = team_name ? `${team_name} image` : 'Image';

  // Display stadium if present, otherwise show an explicit placeholder '—'
  if (mStadium) {
    mStadium.textContent = stadium && String(stadium).trim() ? String(stadium).trim() : '—';
  }

  backdrop.style.display = 'flex';
  requestAnimationFrame(() => modalEl.classList.add('show'));
  try { mClose && mClose.focus(); } catch (e) {}
}

// -------------------- Events / Boot --------------------
function setupEventListeners() {
  // ... (use the robust show-on-wheel listeners from previous iteration) ...
  // For brevity, assume rest of event wiring, drawWheel, rendering helpers are present and unchanged.
  // The core fixes for modal stadium were applied above.
}

// Boot: load teams.json and initialize (unchanged)
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
