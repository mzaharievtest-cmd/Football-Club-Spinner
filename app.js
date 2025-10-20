/**
 * app.js
 * Football Club Spinner — PLAYER wheel in right box, TEAM wheel unchanged
 *
 * This version includes helpers for resolving public paths and player images.
 * It also includes a robust tryFetchPlayers + loadPlayers implementation that prefers /data/players.json
 * and normalizes the players into the team-shaped structure used by the wheel.
 *
 * Overwrite your deployed app.js with this file and hard-refresh (Ctrl/Cmd+Shift+R).
 */

'use strict';

/* -------------------- App state -------------------- */
let TEAMS = [];
let PLAYERS = null; // loaded lazily
let MODE = 'team';  // 'team' or 'player'
let currentAngleTeam = 0;
let currentAnglePlayer = 0;
let spinning = false;
let selectedIdxTeam = -1;
let selectedIdxPlayer = -1;
let history = JSON.parse(localStorage.getItem('clubHistory') || '[]');

let lastModalTeam = null;
let modalRevealState = { logo: false, name: false, stadium: false, league: false };

/* -------------------- DOM refs -------------------- */
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
const optLeague = document.getElementById('optLeague');

const currentText = document.getElementById('currentText');
const currentLogo = document.getElementById('currentLogo');

const historyEl = document.getElementById('history');

/* Mode toggles + view containers */
const modeTeamBtn = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');
const teamView = document.getElementById('teamView');
const playerView = document.getElementById('playerView');

/* Team wheel canvas (left) - do NOT move or remove */
const wheel = document.getElementById('wheel');
const fx = document.getElementById('fx');

/* Player wheel canvas (right) may be created dynamically */
let wheelPlayer = document.getElementById('wheelPlayer') || null;
let fxPlayer = document.getElementById('fxPlayer') || null;

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

/* -------------------- Constants & Utils -------------------- */
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;
const isModalOpen = () => backdrop && backdrop.style.display === 'flex';

const PERF = {
  hideLogosThreshold: 80,
  hideTextThreshold: 140,
  minTextWidth: 44,
  minLogoBox: 28
};

const LEAGUE_LABELS = {
  AUT: "Austrian Bundesliga", BEL: "Jupiler Pro League", BUL: "efbet Liga", CRO: "SuperSport HNL",
  CZE: "Fortuna Liga", DEN: "Superliga", EPL: "Premier League", L1:  "Ligue 1", BUN: "Bundesliga",
  GRE: "Super League 1", ISR: "Ligat ha'Al", SA:  "Serie A", NED: "Eredivisie", NOR: "Eliteserien",
  POL: "PKO BP Ekstraklasa", POR: "Liga Portugal", ROU: "SuperLiga", RUS: "Premier Liga",
  SCO: "Scottish Premiership", SRB: "Super liga Srbije", LLA: "LaLiga", SWE: "Allsvenskan",
  SUI: "Super League", TUR: "Süper Lig", UKR: "Ukrainian Premier League"
};

const TOP5 = ['EPL','SA','BUN','L1','LLA'];

/* -------------------- Image cache & loader -------------------- */
const IMG_CACHE = new Map();
function createInlinePlaceholder(size = 256) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#071022"/><g transform="translate(${size/2},${size/2})"><circle r="${Math.round(size*0.33)}" fill="#0d2a55" opacity="0.9"/><circle r="${Math.round(size*0.28)}" fill="#071022"/></g></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function getLogo(url, onLoad) {
  if (!url) return null;
  const cached = IMG_CACHE.get(url);
  if (cached && cached.img) return cached.img;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    IMG_CACHE.set(url, { img, ok: true });
    onLoad && onLoad(null, img);
    requestAnimationFrame(() => { drawWheel(); drawPlayerWheel(); });
  };
  img.onerror = () => {
    IMG_CACHE.delete(url);
    const placeholder = new Image();
    placeholder.src = createInlinePlaceholder(256);
    IMG_CACHE.set(url, { img: placeholder, ok: false });
    onLoad && onLoad(null, placeholder);
    requestAnimationFrame(() => { drawWheel(); drawPlayerWheel(); });
  };
  img.src = url;
  IMG_CACHE.set(url, { img, ok: false });
  return img;
}

/* -------------------- Helpers for public paths & player image resolution (ADDED) -------------------- */

// --- helpers for public paths ---
const FALLBACK_SILHOUETTE = '/players/silhouette-player.png';

function resolvePublicUrl(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/')) return p;
  return '/' + p; // treat as /public/<p>
}
function slugifyName(n) {
  return String(n || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

// Map special cases: filename doesn’t match the person’s name
const PLAYER_IMAGE_MAP = {
  'bukayo saka': '/saka.png',       // file at public/saka.png
  // add more if needed:
  // 'kai havertz': '/havertz.png'
};

function imageForPlayerName(name) {
  const key = String(name || '').trim().toLowerCase();
  if (PLAYER_IMAGE_MAP[key]) return PLAYER_IMAGE_MAP[key];

  const slug = slugifyName(name);
  // try /players/<slug>.png (if you keep images under public/players/)
  // and then /<slug>.png (if you drop them straight in /public)
  const candidates = [
    `/players/${slug}.png`,
    `/${slug}.png`,
  ];
  // We can optimistically return the first; draw will swap to fallback if it 404s
  return candidates[0];
}

// --- prefer /data/players.json ---
async function tryFetchPlayers() {
  const candidates = [
    '/data/players.json',                           // your file
    '/players/players.json',                        // alt location (if you later move it)
    new URL('./players/players.json', location.href).toString()
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return { res, url };
    } catch {}
  }
  return { res: null, url: null };
}

// --- normalize players to the “team-shaped” structure the wheel expects ---
async function loadPlayers() {
  const { res } = await tryFetchPlayers();
  if (!res) throw new Error('players.json not found');
  const raw = await res.json();

  // optional: build club→league map from TEAMS to inherit league_code automatically
  const teamNameToLeague = {};
  TEAMS.forEach(t => {
    if (t?.team_name && t?.league_code) {
      teamNameToLeague[t.team_name.trim().toLowerCase()] = t.league_code;
    }
  });

  PLAYERS = (raw || []).map(p => {
    const name = p.name || p.player_name || p.full_name || p.displayName || 'Player';
    // If your JSON later contains image fields, prefer them; else derive from name
    const fromJson = p.image_url || p.image || p.file || p.file_url || '';
    const img = fromJson ? resolvePublicUrl(fromJson) : imageForPlayerName(name);

    // derive league from club when possible
    const league_code =
      p.league_code ||
      teamNameToLeague[String((p.club || p.current_club || p.team || '').toLowerCase()).trim()] ||
      'PLAYER';

    return {
      // shape compatible with draw code
      team_name: name,                 // wheel uses team_name as “label”
      name,                            // keep actual name too
      logo_url: img,                   // wheel treats this as the image
      image_url: img,                  // for lists/modals
      primary_color: '#163058',
      league_code,
      stadium: '',                     // not used for players
      club: p.club || null,
      meta: p
    };
  });

  renderPlayerListPreview();
  requestAnimationFrame(drawPlayerWheel);
  return PLAYERS;
}

/* -------------------- Color & typography helpers -------------------- */
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

/* -------------------- Show-option helpers -------------------- */
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
  } catch (e) { /* fallback */ }
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

/* -------------------- Data provider helpers -------------------- */
function getFiltered() {
  if (!chipsWrap) return TEAMS.slice();
  const active = Array.from(chipsWrap.querySelectorAll('input:checked')).map(i => i.value);
  if (active.length === 0) return TEAMS.slice();
  return TEAMS.filter(t => active.includes(t.league_code));
}
function getFilteredPlayers() {
  if (!PLAYERS || PLAYERS.length === 0) return [];
  const active = Array.from(chipsWrap.querySelectorAll('input:checked')).map(i => i.value);
  if (active.length === 0) return PLAYERS.slice();
  return PLAYERS.filter(p => {
    if (p.league_code && active.includes(p.league_code)) return true;
    if (p.meta && (p.meta.club || p.meta.team)) {
      const club = (p.meta.club || p.meta.team).toString().trim().toLowerCase();
      return TEAMS.some(t => t.team_name && t.team_name.toLowerCase().includes(club) && active.includes(t.league_code));
    }
    return false;
  });
}

/* -------------------- UI helpers -------------------- */
function updateSelectionBanner() {
  const N = (MODE === 'player') ? (getFilteredPlayers().length) : getFiltered().length;
  if (perfTip) perfTip.textContent = `${N} ${MODE === 'player' ? 'players' : 'teams'} selected`;
}

/* -------------------- Canvas creation & sizing -------------------- */
function ensurePlayerCanvas() {
  if (wheelPlayer && fxPlayer) return;
  if (!playerView) return;
  wheelPlayer = document.getElementById('wheelPlayer');
  fxPlayer = document.getElementById('fxPlayer');
  if (!wheelPlayer) {
    const wrap = document.createElement('div');
    wrap.className = 'wheel-wrap player-wheel-wrap';
    playerView.insertAdjacentElement('afterbegin', wrap);
    wheelPlayer = document.createElement('canvas');
    wheelPlayer.id = 'wheelPlayer';
    wheelPlayer.className = 'wheel-canvas';
    wrap.appendChild(wheelPlayer);
    fxPlayer = document.createElement('canvas');
    fxPlayer.id = 'fxPlayer';
    fxPlayer.className = 'wheel-fx';
    wrap.appendChild(fxPlayer);
  }
}

function centerSpinFabForCanvas(canvas) {
  try {
    if (!spinFab || !canvas) return;
    const parent = canvas.parentElement || canvas.offsetParent || document.body;
    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.position === 'static') parent.style.position = 'relative';
    const rect = canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const cx = (rect.left - parentRect.left) + rect.width / 2;
    const cy = (rect.top - parentRect.top) + rect.height / 2;
    spinFab.style.position = 'absolute';
    spinFab.style.left = `${Math.round(cx)}px`;
    spinFab.style.top = `${Math.round(cy)}px`;
    spinFab.style.transform = 'translate(-50%,-50%)';
    spinFab.style.zIndex = '5';
  } catch (e) { /* ignore */ }
}

function sizeCanvas() {
  // Team wheel (existing)
  if (wheel) {
    const rect = (wheel.parentElement || wheel).getBoundingClientRect();
    const cssSize = clamp(300, Math.round(rect.width || 640), 1200);
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    wheel.width = Math.round(cssSize * DPR);
    wheel.height = Math.round(cssSize * DPR);
    fx.width = wheel.width; fx.height = wheel.height;
    wheel.style.width = cssSize + 'px'; wheel.style.height = cssSize + 'px';
    fx.style.width = cssSize + 'px'; fx.style.height = cssSize + 'px';
  }

  // Player wheel (if created)
  if (playerView) ensurePlayerCanvas();
  if (wheelPlayer) {
    const rect = (wheelPlayer.parentElement || wheelPlayer).getBoundingClientRect();
    const cssSize = clamp(300, Math.round(rect.width || 640), 1200);
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    wheelPlayer.width = Math.round(cssSize * DPR);
    wheelPlayer.height = Math.round(cssSize * DPR);
    fxPlayer.width = wheelPlayer.width; fxPlayer.height = wheelPlayer.height;
    wheelPlayer.style.width = cssSize + 'px'; wheelPlayer.style.height = cssSize + 'px';
    fxPlayer.style.width = cssSize + 'px'; fxPlayer.style.height = cssSize + 'px';
  }

  // Keep spinFab centered on the active canvas
  if (MODE === 'team') centerSpinFabForCanvas(wheel);
  else if (MODE === 'player') centerSpinFabForCanvas(wheelPlayer || wheel);
}

/* -------------------- Wheel drawing helpers -------------------- */
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

function drawOnCanvas(canvas, fxCanvas, data, currentAngle, selectedIdx, isPlayerMode) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const W = canvas.width / DPR;
  const H = canvas.height / DPR;
  const N = data.length;

  if (N === 0) {
    drawGradientIdle(ctx, W, H);
    return;
  }

  const bothTextOn = !!_readCheckboxLike(optName) && !!_readCheckboxLike(optStadium);
  const hideTextThresholdDyn  = bothTextOn ? 55 : PERF.hideTextThreshold;
  const hideLogosThresholdDyn = bothTextOn ? Math.min(55, PERF.hideLogosThreshold) : PERF.hideLogosThreshold;

  const hideLogos = N >= hideLogosThresholdDyn;
  const hideText  = N >= hideTextThresholdDyn;

  ctx.imageSmoothingEnabled = !hideText;
  ctx.imageSmoothingQuality = hideText ? 'low' : 'high';
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2, H/2);
  ctx.rotate(mod(currentAngle, TAU));

  const radius = Math.min(W, H) * 0.48;
  const sliceAngle = TAU / N;

  // wedges
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const a0 = i * sliceAngle;
    const a1 = (i + 1) * sliceAngle;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, a0, a1);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // selected rim stroke
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

  // content: text + logos/images
  const show = getShowOptions();

  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const a0 = i * sliceAngle;
    const a1 = (i + 1) * sliceAngle;
    const aMid = (a0 + a1) / 2;
    const sliceArc = radius * (a1 - a0);
    const nameTargetPx    = clamp(12, 0.20 * sliceArc, 24);
    const stadiumTargetPx = clamp(9,  0.14 * sliceArc, 18);
    const logoSize        = clamp(28, 0.40 * sliceArc, 64);
    const logoHalf = logoSize / 2;
    const pad = 10;
    const fg = textColorFor(t.primary_color);
    const lum = luminance(t.primary_color);

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

    const xLogo = sign * (radius * 0.74);
    const xText = sign * (radius * 0.42);
    const logoInner = xLogo - sign * (logoHalf + pad);
    const xBoxLeft = Math.min(xText, logoInner);
    const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

    const nameField = isPlayerMode ? (t.name || t.team_name) : t.team_name;
    const canShowName    = !hideText && show.name && nameField && maxTextWidth >= PERF.minTextWidth;
    const canShowStadium = !hideText && show.stadium && t.stadium && maxTextWidth >= PERF.minTextWidth;
    const canShowLogo    = !hideLogos && show.logo && ((isPlayerMode && t.image_url) || t.logo_url) && (logoHalf * 2) >= PERF.minLogoBox;

    if (canShowName || canShowStadium) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const heavy = (lum >= 0.35 && lum <= 0.45);
      const strokeCol = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.65)';
      const fillCol = fg;

      let nameFit = { text: '', fontPx: 0 };
      let stadFit = { text: '', fontPx: 0 };

      if (canShowName) {
        nameFit = fitSingleLine(ctx, String(nameField || ''), {
          maxWidth: maxTextWidth,
          targetPx: nameTargetPx,
          minPx: 9,
          maxPx: 24,
          weight: heavy ? 900 : 800
        });
      }

      const stadTarget = (canShowName && nameFit.fontPx) ? Math.max(8, Math.round(nameFit.fontPx * 0.82)) : stadiumTargetPx;
      if (canShowStadium) {
        stadFit = fitSingleLine(ctx, t.stadium || '', {
          maxWidth: maxTextWidth,
          targetPx: stadTarget,
          minPx: 8,
          maxPx: 20,
          weight: 700
        });
      }

      const gap = (canShowName && canShowStadium) ? 3 : 0;
      const totalH = (canShowName ? nameFit.fontPx : 0) + (canShowStadium ? stadFit.fontPx : 0) + gap;
      let yCursor = -totalH / 2;

      if (canShowName) {
        yCursor += nameFit.fontPx / 2;
        ctx.font = `${heavy ? 900 : 800} ${nameFit.fontPx}px Inter, system-ui, sans-serif`;
        ctx.lineWidth = Math.max(1, Math.round(nameFit.fontPx / 10));
        ctx.strokeStyle = strokeCol;
        ctx.fillStyle = fillCol;
        ctx.strokeText(nameFit.text, xBoxLeft, yCursor);
        ctx.fillText(nameFit.text, xBoxLeft, yCursor);
        yCursor += nameFit.fontPx / 2 + gap;
      }

      if (canShowStadium) {
        yCursor += stadFit.fontPx / 2;
        ctx.font = `700 ${stadFit.fontPx}px Inter, system-ui, sans-serif`;
        ctx.lineWidth = Math.max(1, Math.round(stadFit.fontPx / 10));
        ctx.fillStyle = fillCol;
        ctx.save(); ctx.globalAlpha = 0.92;
        ctx.strokeText(stadFit.text, xBoxLeft, yCursor);
        ctx.fillText(stadFit.text, xBoxLeft, yCursor);
        ctx.restore();
      }

      ctx.restore();
    }

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

      const imgUrl = (isPlayerMode) ? (t.image_url || t.logo_url) : t.logo_url;
      const img = getLogo(imgUrl || FALLBACK_SILHOUETTE, () => requestAnimationFrame(() => { drawOnCanvas(canvas, fxCanvas, data, currentAngle, selectedIdx, isPlayerMode); }));
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

    ctx.restore(); // wedge clip
  }

  ctx.restore();
}

/* Wrapper to draw team wheel */
function drawWheel() {
  drawOnCanvas(wheel, fx, getFiltered(), currentAngleTeam, selectedIdxTeam, false);
  updateSelectionBanner();
}

/* Wrapper to draw player wheel (if created) */
function drawPlayerWheel() {
  if (!wheelPlayer) return;
  drawOnCanvas(wheelPlayer, fxPlayer, getFilteredPlayers(), currentAnglePlayer, selectedIdxPlayer, true);
  updateSelectionBanner();
}

/* -------------------- Result & spin logic (separate state per wheel) -------------------- */
function setResultTeam(idx) {
  const data = getFiltered();
  const t = data[idx];
  selectedIdxTeam = idx;
  drawWheel();
  const leagueLabel = LEAGUE_LABELS[t?.league_code] || t?.league_code || '';
  if (currentText) currentText.textContent = `${t?.team_name || 'Team'} · ${leagueLabel}`;
  if (currentLogo) currentLogo.src = t?.logo_url || '';
  if (t) {
    history.unshift(t);
    if (history.length > 50) history = history.slice(0,50);
    saveHistory();
    renderHistory();
    openModal(t);
  }
}

function setResultPlayer(idx) {
  const data = getFilteredPlayers();
  const t = data[idx];
  selectedIdxPlayer = idx;
  drawPlayerWheel();
  const leagueLabel = (t && (t.league_code && (LEAGUE_LABELS[t.league_code] || t.league_code))) || '';
  if (currentText) currentText.textContent = `${t?.name || t?.team_name || 'Player'} · ${leagueLabel}`;
  if (currentLogo) currentLogo.src = t?.image_url || t?.logo_url || '';
  if (t) {
    history.unshift(t);
    if (history.length > 50) history = history.slice(0,50);
    saveHistory();
    renderHistory();
    openModal(t);
  }
}

function spinTeam() {
  if (spinning) return;
  const data = getFiltered();
  if (!data.length) {
    if (currentText) currentText.textContent = 'Please select at least one league.';
    return;
  }
  spinning = true;
  lockUI(true);
  if (spinBtn) spinBtn.disabled = true;
  if (spinFab) spinFab.disabled = true;
  selectedIdxTeam = -1;
  const N = data.length; const slice = TAU / N;
  const extraTurns  = 6 + Math.floor(Math.random()*3);
  const finalOffset = Math.random() * TAU;
  const targetAngle = TAU * extraTurns + finalOffset;
  const start = performance.now(); const duration = 3200;
  const easeOutCubic = x => 1 - Math.pow(1-x, 3);
  function anim(now){
    const p = clamp(0, (now - start) / duration, 1);
    currentAngleTeam = targetAngle * easeOutCubic(p);
    drawWheel();
    if (p < 1) requestAnimationFrame(anim);
    else {
      const theta = mod(currentAngleTeam, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;
      const centerAngle = idx * slice + slice/2;
      const snapDelta = mod(centerAngle - offset, TAU);
      currentAngleTeam = mod(currentAngleTeam + snapDelta, TAU);
      spinning = false; lockUI(false);
      const hasAny = getFiltered().length > 0;
      if (spinBtn) spinBtn.disabled = !hasAny;
      if (spinFab) spinFab.disabled = !hasAny;
      selectedIdxTeam = idx;
      drawWheel();
      setResultTeam(idx);
    }
  }
  requestAnimationFrame(anim);
}

function spinPlayer() {
  if (spinning) return;
  if (!PLAYERS) {
    loadPlayers().then(() => spinPlayer()).catch(() => { if (currentText) currentText.textContent = 'No players available.'; });
    return;
  }
  const data = getFilteredPlayers();
  if (!data.length) {
    if (currentText) currentText.textContent = 'Please select at least one league (or show all players).';
    return;
  }
  spinning = true;
  lockUI(true);
  if (spinBtn) spinBtn.disabled = true;
  if (spinFab) spinFab.disabled = true;
  selectedIdxPlayer = -1;
  const N = data.length; const slice = TAU / N;
  const extraTurns  = 6 + Math.floor(Math.random()*3);
  const finalOffset = Math.random() * TAU;
  const targetAngle = TAU * extraTurns + finalOffset;
  const start = performance.now(); const duration = 3200;
  const easeOutCubic = x => 1 - Math.pow(1-x, 3);
  function anim(now){
    const p = clamp(0, (now - start) / duration, 1);
    currentAnglePlayer = targetAngle * easeOutCubic(p);
    drawPlayerWheel();
    if (p < 1) requestAnimationFrame(anim);
    else {
      const theta = mod(currentAnglePlayer, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;
      const centerAngle = idx * slice + slice/2;
      const snapDelta = mod(centerAngle - offset, TAU);
      currentAnglePlayer = mod(currentAnglePlayer + snapDelta, TAU);
      spinning = false; lockUI(false);
      const hasAny = getFilteredPlayers().length > 0;
      if (spinBtn) spinBtn.disabled = !hasAny;
      if (spinFab) spinFab.disabled = !hasAny;
      selectedIdxPlayer = idx;
      drawPlayerWheel();
      setResultPlayer(idx);
    }
  }
  requestAnimationFrame(anim);
}

/* -------------------- UI Lock -------------------- */
const INTERACTIVE_SELECTOR = 'button, input, select, textarea, [role="button"]';
function lockUI(lock) {
  document.body.classList.toggle('ui-locked', !!lock);
  const els = document.querySelectorAll(INTERACTIVE_SELECTOR);
  els.forEach(el => {
    if (lock) {
      if (!el.dataset.lockSaved) { el.dataset.lockSaved = '1'; el.dataset.prevDisabled = el.disabled ? '1' : '0'; }
      el.disabled = true; el.setAttribute('aria-disabled', 'true');
    } else {
      if (el.dataset.lockSaved === '1') {
        const prev = el.dataset.prevDisabled === '1';
        el.disabled = prev; if (!prev) el.removeAttribute('aria-disabled');
        delete el.dataset.lockSaved; delete el.dataset.prevDisabled;
      }
    }
  });
}

/* -------------------- Modal / reveal helpers (unchanged) -------------------- */
function ensureRevealStyles() {
  if (document.getElementById('reveal-style')) return;
  const s = document.createElement('style'); s.id = 'reveal-style';
  s.textContent = `
    .reveal-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;margin-left:10px;padding:8px 12px;border-radius:10px;border:1px solid rgba(90,161,255,.6);background:#152036;color:#fff;font-weight:800;letter-spacing:.03em;cursor:pointer;user-select:none;z-index:3;position:relative;white-space:nowrap}
    #mHead + .reveal-btn{display:inline-block;margin-left:0}
    .reveal-wrap{position:relative;display:inline-block;z-index:0}
    .reveal-overlay{position:absolute;inset:0;border-radius:inherit;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:transparent;pointer-events:none;z-index:2}
  `; document.head.appendChild(s);
}
function removeExistingRevealBtn(id){ const old=document.getElementById(id); if(old) old.remove(); }
function ensureWrapped(el){ if(!el||!el.parentElement) return null; if(el.parentElement.classList.contains('reveal-wrap')) return el.parentElement; const wrap=document.createElement('span'); wrap.className='reveal-wrap'; el.parentElement.insertBefore(wrap, el); wrap.appendChild(el); return wrap; }
function addOverlay(el){ const wrap=ensureWrapped(el); if(!wrap) return; if(!wrap.querySelector('.reveal-overlay')){ const ov=document.createElement('span'); ov.className='reveal-overlay'; wrap.appendChild(ov); } }
function removeOverlay(el){ if(!el||!el.parentElement) return; const wrap=el.parentElement; if(wrap.classList.contains('reveal-wrap')){ const ov=wrap.querySelector('.reveal-overlay'); if(ov) ov.remove(); } }
function blurElement(el){ if(!el) return; el.style.setProperty('filter','blur(14px) saturate(0.9)','important'); el.style.setProperty('-webkit-filter','blur(14px) saturate(0.9)','important'); el.style.pointerEvents='none'; addOverlay(el); }
function unblurElement(el){ if(!el) return; el.style.removeProperty('filter'); el.style.removeProperty('-webkit-filter'); el.style.pointerEvents=''; removeOverlay(el); el.setAttribute('aria-hidden','false'); }
function placeButtonAfter(el,btn){ const host=el?.parentElement?.classList.contains('reveal-wrap') ? el.parentElement : el; if (host?.insertAdjacentElement) host.insertAdjacentElement('afterend', btn); }
function applyRevealByKey(key, el, enabled, btnId, labelText) {
  if (!el) return; removeExistingRevealBtn(btnId); const revealed = !!modalRevealState[key];
  if (enabled || revealed) { unblurElement(el); return; }
  blurElement(el);
  const btn = document.createElement('button'); btn.id = btnId; btn.type = 'button'; btn.className = 'reveal-btn'; btn.textContent = `Show ${labelText}`;
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); modalRevealState[key] = true; unblurElement(el); btn.remove(); }, { passive: false });
  placeButtonAfter(el, btn);
}
function updateModalRevealFromToggles() {
  if (!isModalOpen() || !lastModalTeam) return;
  applyRevealByKey('logo',    mLogo,    !!(optLogo && (optLogo.checked || optLogo.getAttribute && optLogo.getAttribute('aria-checked') === 'true')),    'revealLogoBtn',    'logo');
  applyRevealByKey('name',    mHead,    !!(optName && (optName.checked || optName.getAttribute && optName.getAttribute('aria-checked') === 'true')),    'revealNameBtn',    'name');
  applyRevealByKey('stadium', mStadium, !!(optStadium && (optStadium.checked || optStadium.getAttribute && optStadium.getAttribute('aria-checked') === 'true')), 'revealStadiumBtn', 'stadium');
  applyRevealByKey('league',  mSub,     !!(optLeague && (optLeague.checked || optLeague.getAttribute && optLeague.getAttribute('aria-checked') === 'true')),  'revealLeagueBtn',  'league');
}

/* -------------------- Player list preview (small helper) -------------------- */
function renderPlayerListPreview(limit = 200) {
  if (!playerView || !PLAYERS) return;
  // Find or create a preview area in playerView
  let preview = playerView.querySelector('.player-list-preview');
  if (!preview) {
    preview = document.createElement('div'); preview.className = 'player-list-preview';
    preview.style.padding = '12px';
    playerView.appendChild(preview);
  }
  preview.innerHTML = '';
  const list = getFilteredPlayers().slice(0, limit);
  list.forEach(p => {
    const row = document.createElement('div'); row.className = 'player-row';
    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.marginBottom = '6px';
    const img = document.createElement('img'); img.src = p.image_url || FALLBACK_SILHOUETTE; img.alt = p.name || 'Player'; img.width = 28; img.height = 28; img.style.borderRadius='50%'; img.style.marginRight='8px';
    const txt = document.createElement('div'); txt.textContent = p.name || p.team_name || 'Player';
    row.appendChild(img); row.appendChild(txt);
    preview.appendChild(row);
  });
}

/* -------------------- Chips / helper functions -------------------- */
function makeChip(code, checked) {
  const full = LEAGUE_LABELS[code] || code;
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `<input type="checkbox" value="${code}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${full}"><span class="chip-text" title="${full}">${full}</span>`;
  return label;
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
function visibleCodes() {
  const codes = Array.from(chipsTop.querySelectorAll('input[type="checkbox"]')).map(i => i.value);
  if (!chipsMore.hidden) codes.push(...Array.from(chipsMore.querySelectorAll('input[type="checkbox"]')).map(i => i.value));
  return codes;
}
function setCheckedCodes(codes = []) {
  const set = new Set(codes);
  chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => {
    i.checked = set.has(i.value);
    i.setAttribute('aria-checked', i.checked ? 'true' : 'false');
  });
  selectedIdxTeam = -1;
  selectedIdxPlayer = -1;
  drawWheel();
  drawPlayerWheel();
  const hasAny = getFiltered().length > 0;
  if (spinBtn) spinBtn.disabled = !hasAny;
  if (spinFab) spinFab.disabled = !hasAny;
  if (!hasAny && currentText) currentText.textContent = 'Please select at least one league.';
  updateSelectionBanner();
}

/* -------------------- History helpers -------------------- */
function saveHistory() { localStorage.setItem('clubHistory', JSON.stringify(history)); }
function renderHistory() {
  historyEl.innerHTML = '';
  if (!history || history.length === 0) {
    historyEl.setAttribute('aria-live', 'polite');
    historyEl.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
    return;
  }
  history.forEach(item => {
    const div = document.createElement('div'); div.className = 'item';
    const i = document.createElement('img'); i.src = item.logo_url || item.image_url || ''; i.alt = `${item.team_name || item.name || 'Item'} image`; i.className = 'history-logo'; i.width = 38; i.height = 38;
    i.onerror = () => { i.src = ''; i.alt = 'No image'; };
    const s = document.createElement('span'); const full = LEAGUE_LABELS[item.league_code] || item.league_code;
    s.textContent = `${item.team_name || item.name} (${full})`;
    div.append(i, s); historyEl.append(div);
  });
}

/* -------------------- Modal open/close (preserve reveal) -------------------- */
function openModal(team){
  ensureRevealStyles();
  lastModalTeam = team;
  modalRevealState = { logo: false, name: false, stadium: false, league: false };
  const leagueLabel = LEAGUE_LABELS[team.league_code] || team.league_code;
  if (mHead)   mHead.textContent = team.team_name || team.name || '—';
  if (mSub)    mSub.textContent = leagueLabel;
  if (mLogo)   { mLogo.setAttribute('decoding','sync'); mLogo.setAttribute('loading','eager'); mLogo.src = (MODE === 'player' ? (team.image_url || team.logo_url) : team.logo_url) || ''; mLogo.alt = (team.team_name || team.name || 'Image'); }
  if (mStadium) mStadium.textContent = team.stadium || '—';
  backdrop.style.display = 'flex';
  requestAnimationFrame(() => { modalEl.classList.add('show'); updateModalRevealFromToggles(); });
}
function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=> { backdrop.style.display='none'; }, 150); }

/* -------------------- Event wiring -------------------- */
function setupEventListeners() {
  if (modeTeamBtn) modeTeamBtn.addEventListener('click', () => { setMode('team'); });
  if (modePlayerBtn) modePlayerBtn.addEventListener('click', () => { setMode('player'); });

  chipsWrap?.addEventListener('change', () => {
    if (spinning) return;
    selectedIdxTeam = -1; selectedIdxPlayer = -1;
    drawWheel(); drawPlayerWheel();
    const len = getFiltered().length;
    if (spinBtn) spinBtn.disabled = len === 0;
    if (spinFab) spinFab.disabled = len === 0;
    if (len === 0 && currentText) currentText.textContent = 'Please select at least one league.';
    updateSelectionBanner();
  });

  toggleMore?.addEventListener('click', () => {
    if (spinning) return;
    const hidden = chipsMore.hidden;
    if (hidden) { chipsMore.hidden = false; toggleMore.textContent = 'Show fewer leagues'; toggleMore.setAttribute('aria-expanded', 'true'); }
    else { chipsMore.hidden = true; toggleMore.textContent = 'Show more leagues'; toggleMore.setAttribute('aria-expanded', 'false'); }
  });

  qpAll?.addEventListener('click', () => { if (spinning) return; setCheckedCodes(visibleCodes()); });
  qpNone?.addEventListener('click', () => { if (spinning) return; setCheckedCodes([]); });
  qpTop5?.addEventListener('click', () => { if (spinning) return; setCheckedCodes(TOP5.filter(c => visibleCodes().includes(c))); });

  const onWheelToggleChange = () => {
    if (spinning) return;
    drawWheel(); drawPlayerWheel();
    if (isModalOpen()) updateModalRevealFromToggles();
  };
  optName?.addEventListener('change', onWheelToggleChange);
  optLogo?.addEventListener('change', onWheelToggleChange);
  optStadium?.addEventListener('change', onWheelToggleChange);
  optLeague?.addEventListener('change', onWheelToggleChange);

  if (spinBtn) spinBtn.addEventListener('click', () => { if (MODE === 'player') spinPlayer(); else spinTeam(); });
  if (spinFab) spinFab.addEventListener('click', () => { if (MODE === 'player') spinPlayer(); else spinTeam(); });

  resetHistoryBtn?.addEventListener('click', () => { if (!spinning) { history = []; saveHistory(); renderHistory(); } });
  mClose?.addEventListener('click', () => { if (!spinning) closeModal(); });
  backdrop?.addEventListener('click', e => { if(!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(!spinning && e.key==='Escape' && isModalOpen()) closeModal(); });

  let resizeTO;
  window.addEventListener('resize', () => { clearTimeout(resizeTO); resizeTO = setTimeout(() => { sizeCanvas(); drawWheel(); drawPlayerWheel(); }, 120); }, { passive: true });
}

/* -------------------- Boot -------------------- */
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

fetch(`./teams.json?v=${Date.now()}`)
  .then(res => res.json())
  .then(data => {
    TEAMS = data || [];
    ensureRevealStyles();
    renderChips();
    renderHistory();
    sizeCanvas();
    setCheckedCodes(['EPL']);   // default
    drawWheel();
    setupEventListeners();
    // Create player canvas now (hidden until player mode) so it sizes correctly in some layouts
    ensurePlayerCanvas();
    sizeCanvas();
    drawPlayerWheel();
  })
  .catch(err => {
    console.error('Failed to load teams.json', err);
    if (currentText) currentText.textContent = 'Failed to load teams.';
  });

/* -------------------- Expose debug helpers -------------------- */
window.__fs = { drawWheel, drawPlayerWheel, spinTeam, spinPlayer, setMode, TEAMS, PLAYERS, getFiltered, getFilteredPlayers, loadPlayers };
