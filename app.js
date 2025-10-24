// Football Club Spinner — app.js (PLAYER mode fixed)
// - TEAM mode unchanged
// - PLAYER mode shows player name + image on the wheel
// - Player filters are PL teams (Chelsea, Man City, Man Utd, Liverpool shown first,
//   with “Show more Premier League clubs” to reveal the rest)
// - “Hide all wheel content when more than 2 leagues are selected” applies to TEAM mode only

let TEAMS = [];
let PLAYERS = [];
let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';

let currentAngle = 0;
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// -------------------- DOM --------------------
const chipsWrap   = document.getElementById('chips');
const chipsTop    = document.getElementById('chipsTop');
const chipsMore   = document.getElementById('chipsMore');
const toggleMore  = document.getElementById('toggleMore');

const spinBtn     = document.getElementById('spinBtn');
const spinFab     = document.getElementById('spinFab');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName     = document.getElementById('optName');
const optLogo     = document.getElementById('optLogo');
const optStadium  = document.getElementById('optStadium'); // doubles as Jersey number in PLAYER mode
const optLeague   = document.getElementById('optLeague');  // doubles as Nationality in PLAYER mode

const currentText = document.getElementById('currentText');
const currentLogo = document.getElementById('currentLogo');
const historyEl   = document.getElementById('history');

// Mode switch
const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');
const teamView      = document.getElementById('teamView');
const playerView    = document.getElementById('playerView');
const playerListEl  = document.getElementById('playerList');

modeTeamBtn?.addEventListener('click',  () => setMode('team'));
modePlayerBtn?.addEventListener('click', () => setMode('player'));

// canvases
const wheel = document.getElementById('wheel');
const fx    = document.getElementById('fx');

// -------------------- Constants/labels --------------------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;

const PERF = {
  hideLogosThreshold: 80,
  hideTextThreshold: 140,
  minTextWidth: 44,
  minLogoBox: 28
};

// “Hide all content when >2 leagues selected” — TEAM mode only
const TEAM_MAX_VISIBLE_LEAGUES_FOR_CONTENT = 2;

// League labels
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
  UKR: "Ukrainian Premier League",
  PLAYER: "Players"
};

const TOP5 = ['EPL','SA','BUN','L1','LLA'];

// -------------------- Image cache --------------------
const IMG_CACHE = new Map();
function getLogo(url, onLoad) {
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

// -------------------- Utils for players --------------------
const FALLBACK_SILHOUETTE = '/players/silhouette-player.png';
function resolvePublicUrl(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/')) return p;
  return '/' + p;
}
function slugifyName(n) {
  return String(n || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
const PLAYER_IMAGE_MAP = {}; // optional overrides by lowercased name

function imageForPlayerName(name) {
  const key = String(name || '').trim().toLowerCase();
  if (PLAYER_IMAGE_MAP[key]) return PLAYER_IMAGE_MAP[key];
  return `/players/${slugifyName(name)}.png`;
}

async function fetchJsonNoCache(url){
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.json();
}

async function loadPlayers() {
  // preferred path: /data/players.json; fallback: /players/players.json
  let data = [];
  try { data = await fetchJsonNoCache('/data/players.json'); }
  catch {
    data = await fetchJsonNoCache('/players/players.json');
  }

  // build quick team → league map from TEAMS to tag players
  const teamToLeague = {};
  TEAMS.forEach(t => {
    if (t?.team_name && t?.league_code) {
      teamToLeague[t.team_name.trim().toLowerCase()] = t.league_code;
    }
  });

  PLAYERS = data.map(p => {
    const name = p.name || p.player_name || 'Player';
    const img  = resolvePublicUrl(p.image_url || p.image || imageForPlayerName(name)) || FALLBACK_SILHOUETTE;

    // in players.json we expect club/team name in p.team or p.club
    const club = p.team || p.club || '';
    // league for filtering banner (defaults to EPL to keep things visible)
    const league_code =
      p.league_code ||
      teamToLeague[String(club).trim().toLowerCase()] ||
      'EPL';

    return {
      // wheel fields
      team_name: name,         // reused to draw name
      logo_url: img,           // image on slice
      primary_color: '#163058',
      stadium: '',

      // extra player info
      name,
      image_url: img,
      club,
      league_code,
      jersey_number: p.jersey_number ?? p.number ?? null,
      nationality_name: (p.nationality && (p.nationality.name || p.nationality)) || p.country || ''
    };
  });

  // Small preview list right-side (optional)
  if (playerListEl) {
    playerListEl.innerHTML = '';
    PLAYERS.slice(0, 80).forEach(pl => {
      const el = document.createElement('div');
      el.className = 'player-item';
      el.innerHTML = `<img src="${pl.image_url}" alt="${pl.name}" width="40" height="40" style="border-radius:10px;object-fit:cover;margin-right:8px"> ${pl.name}`;
      playerListEl.appendChild(el);
    });
  }
}

// -------------------- Mode & filters --------------------
function setMode(next) {
  if (next === MODE) return;
  MODE = next;
  localStorage.setItem('fsMode', MODE);

  modeTeamBtn?.classList.toggle('mode-btn-active', MODE === 'team');
  modePlayerBtn?.classList.toggle('mode-btn-active', MODE === 'player');
  modeTeamBtn?.setAttribute('aria-pressed', MODE === 'team' ? 'true':'false');
  modePlayerBtn?.setAttribute('aria-pressed', MODE === 'player' ? 'true':'false');

  teamView?.classList.toggle('hidden', MODE === 'player');
  playerView?.classList.toggle('hidden', MODE === 'team');

  // relabel the two secondary toggles for PLAYER mode
  const stadiumLabel = chipsWrap?.querySelector('label[for="optStadium"] .chip-text');
  const leagueLabel  = chipsWrap?.querySelector('label[for="optLeague"] .chip-text');
  if (MODE === 'player') {
    if (stadiumLabel) stadiumLabel.textContent = 'Number';
    if (leagueLabel)  leagueLabel.textContent  = 'Nationality';
    // render team chips for Premier League
    renderPlayerTeamChips();
  } else {
    if (stadiumLabel) stadiumLabel.textContent = 'Stadium';
    if (leagueLabel)  leagueLabel.textContent  = 'League';
    renderLeagueChips();
  }

  selectedIdx = -1;
  sizeCanvas();
  drawWheel();
  updateSpinAvailability();
}

function getCurrentData() {
  const activeValues = Array.from(document.querySelectorAll('#chips input:checked')).map(i => i.value);
  if (MODE === 'player') {
    // activeValues are team names in PLAYER mode
    const all = activeValues.length ? PLAYERS.filter(p => activeValues.includes(p.club)) : PLAYERS;
    return all;
  }
  // TEAM mode: activeValues are league codes
  return TEAMS.filter(t => activeValues.includes(t.league_code));
}

function updateSpinAvailability() {
  const n = getCurrentData().length;
  if (spinBtn) spinBtn.disabled = n === 0;
  if (spinFab) spinFab.disabled = n === 0;
}

// -------------------- Chips --------------------
function makeChip(value, text, checked=false) {
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${value.replace(/"/g,'&quot;')}" ${checked ? 'checked aria-checked="true"' : ''}>
    <span class="chip-text">${text}</span>
  `;
  return label;
}

function renderLeagueChips() {
  // Build from TEAMS -> unique league codes
  const codes = [...new Set(TEAMS.map(t => t.league_code))];
  const topCodes  = TOP5.filter(c => codes.includes(c));
  const moreCodes = codes.filter(c => !topCodes.includes(c)).sort();

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  topCodes.forEach(code => chipsTop.appendChild(makeChip(code, LEAGUE_LABELS[code] || code, code === 'EPL')));
  moreCodes.forEach(code => chipsMore.appendChild(makeChip(code, LEAGUE_LABELS[code] || code)));

  // Show-more label (generic)
  toggleMore.textContent = 'Show more leagues';
  chipsMore.hidden = true;
}

function renderPlayerTeamChips() {
  // Use only Premier League teams from TEAMS as “team chips”
  const plTeams = TEAMS.filter(t => t.league_code === 'EPL');
  // put the big four first
  const favourites = new Set(['Chelsea FC','Manchester City','Manchester United','Liverpool FC','Liverpool']);
  const favs = plTeams.filter(t => [...favourites].some(n => (t.team_name || '').toLowerCase().startsWith(n.toLowerCase())));
  const rest = plTeams.filter(t => !favs.includes(t)).sort((a,b)=>a.team_name.localeCompare(b.team_name));

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';
  favs.forEach(t => chipsTop.appendChild(makeChip(t.team_name, t.team_name, true)));
  rest.forEach(t => chipsMore.appendChild(makeChip(t.team_name, t.team_name)));

  toggleMore.textContent = 'Show more Premier League clubs';
  chipsMore.hidden = true;
}

// -------------------- History --------------------
function saveHistory(){ localStorage.setItem('clubHistory', JSON.stringify(history)); }
function resetHistory(){ history = []; saveHistory(); renderHistory(); }
function renderHistory() {
  historyEl.innerHTML = '';
  if (!history.length) {
    const div = document.createElement('div');
    div.className = 'item';
    div.textContent = 'Spin the wheel to start';
    historyEl.appendChild(div);
    return;
  }
  history.forEach(item => {
    const div = document.createElement('div'); div.className = 'item';
    const img = document.createElement('img'); img.src = item.logo_url || ''; img.alt = '';
    const span = document.createElement('span'); span.textContent = item.team_name || '';
    div.append(img, span); historyEl.append(div);
  });
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

// -------------------- Drawing --------------------
function drawGradientIdle(ctx, W, H) {
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,W,H);

  ctx.save(); ctx.translate(W/2, H/2);
  const radius = Math.min(W, H) * 0.48;
  const g = ctx.createRadialGradient(0,0, radius*0.1, 0,0, radius);
  g.addColorStop(0.00, '#1A2C5A');
  g.addColorStop(0.35, '#21386F');
  g.addColorStop(0.65, '#0E2A57');
  g.addColorStop(1.00, '#0B1B38');

  ctx.beginPath(); ctx.arc(0,0, radius, 0, TAU); ctx.fillStyle = g; ctx.fill();

  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let i=1;i<=5;i++){ ctx.beginPath(); ctx.arc(0,0, radius*(i/5), 0, TAU); ctx.stroke(); }
  ctx.restore();
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

function drawWheel(){
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

  // TEAM mode may suppress content if >2 leagues selected
  let suppressContent = false;
  if (MODE === 'team') {
    const activeCodes = Array.from(chipsWrap.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
    const uniq = new Set(activeCodes);
    if (uniq.size > TEAM_MAX_VISIBLE_LEAGUES_FOR_CONTENT) suppressContent = true;
  }

  // When both text lines are enabled, tighten thresholds
  const bothTextOn = !!optName?.checked && !!optStadium?.checked;
  const hideTextThresholdDyn  = bothTextOn ? 55 : PERF.hideTextThreshold;
  const hideLogosThresholdDyn = bothTextOn ? Math.min(55, PERF.hideLogosThreshold) : PERF.hideLogosThreshold;
  const hideLogos = suppressContent || (N >= hideLogosThresholdDyn);
  const hideText  = suppressContent || (N >= hideTextThresholdDyn);

  ctx.imageSmoothingEnabled = !hideText;
  ctx.imageSmoothingQuality = hideText ? 'low' : 'high';

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

  // Selected rim
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

  // Content
  if (!hideText || !hideLogos) {
    for (let i = 0; i < N; i++) {
      const t = data[i] || {};

      const a0 = i * sliceAngle;
      const a1 = (i + 1) * sliceAngle;
      const aMid = (a0 + a1) / 2;
      const sliceArc = radius * (a1 - a0);

      // For PLAYER mode: second line is jersey number (if enabled); we never draw league on wheel
      const secondaryText =
        (MODE === 'player' && optStadium?.checked)
          ? (t.jersey_number ? `#${t.jersey_number}` : '')
          : (MODE === 'team' && optStadium?.checked ? t.stadium : '');

      const nameTargetPx    = clamp(12, 0.20 * sliceArc, 24);
      const stadiumTargetPx = clamp(9,  0.14 * sliceArc, 18);
      let   logoSize        = clamp(28, 0.40 * sliceArc, 64);
      const logoHalf = logoSize / 2;
      const pad = 10;

      const fg  = textColorFor(t.primary_color);
      const lum = luminance(t.primary_color);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0,0);
      ctx.arc(0,0, radius - 1, a0, a1);
      ctx.closePath();
      ctx.clip();

      ctx.rotate(aMid);
      const needFlip = Math.cos(aMid) < 0;
      if (needFlip) ctx.rotate(Math.PI);
      const sign = needFlip ? -1 : 1;

      const xLogo = sign * (radius * 0.74);
      const xText = sign * (radius * 0.42);
      const logoInner = xLogo - sign * (logoHalf + pad);
      const xBoxLeft = Math.min(xText, logoInner);
      const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

      const showName = !hideText && optName?.checked && t.team_name && maxTextWidth >= PERF.minTextWidth;
      const showLogo = !hideLogos && optLogo?.checked && t.logo_url && (logoHalf * 2) >= PERF.minLogoBox;
      const showSecond = !hideText && secondaryText && maxTextWidth >= PERF.minTextWidth;

      // Name + second line
      if (showName || showSecond) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const heavy = (lum >= 0.35 && lum <= 0.45);
        const strokeCol = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.65)';
        const fillCol = fg;

        let nameFit = { text: '', fontPx: 0 };
        let secFit  = { text: '', fontPx: 0 };

        if (showName) {
          nameFit = fitSingleLine(ctx, t.team_name || '', {
            maxWidth: maxTextWidth,
            targetPx: nameTargetPx,
            minPx: 9, maxPx: 24, weight: heavy ? 900 : 800
          });
        }
        if (showSecond) {
          const secTarget = nameFit.fontPx ? Math.max(8, Math.round(nameFit.fontPx * 0.82)) : stadiumTargetPx;
          secFit = fitSingleLine(ctx, secondaryText, {
            maxWidth: maxTextWidth, targetPx: secTarget, minPx: 8, maxPx: 20, weight: 700
          });
        }

        const gap = (showName && showSecond) ? 3 : 0;
        const totalH = (showName ? nameFit.fontPx : 0) + (showSecond ? secFit.fontPx : 0) + gap;
        let y = -totalH / 2;

        if (showName) {
          y += nameFit.fontPx / 2;
          ctx.font = `${heavy ? 900 : 800} ${nameFit.fontPx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = Math.max(1, Math.round(nameFit.fontPx / 10));
          ctx.fillStyle = fillCol;
          ctx.strokeText(nameFit.text, xBoxLeft, y);
          ctx.fillText(nameFit.text, xBoxLeft, y);
          y += nameFit.fontPx / 2 + gap;
        }
        if (showSecond) {
          y += secFit.fontPx / 2;
          ctx.font = `700 ${secFit.fontPx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = Math.max(1, Math.round(secFit.fontPx / 10));
          ctx.fillStyle = fillCol;
          ctx.save(); ctx.globalAlpha = 0.92;
          ctx.strokeText(secFit.text, xBoxLeft, y);
          ctx.fillText(secFit.text, xBoxLeft, y);
          ctx.restore();
        }
        ctx.restore();
      }

      // Logo
      if (showLogo) {
        ctx.save();
        ctx.translate(xLogo, 0);
        if (N < PERF.hideLogosThreshold) {
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 4; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 2;
        }
        ctx.beginPath(); ctx.arc(0, 0, logoHalf, 0, TAU); ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();

        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, logoHalf - 1, 0, TAU); ctx.closePath(); ctx.clip();

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

      ctx.restore();
    }
  }

  ctx.restore();
  updateSelectionBanner();
}

function updateSelectionBanner() {
  const N = getCurrentData().length;
  const tip = document.getElementById('perfTip');
  if (tip) tip.textContent = `${N} ${MODE === 'player' ? 'players' : 'teams'} selected`;
}

// -------------------- Spin / Result --------------------
function setResult(idx){
  const data = getCurrentData();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  const label = t.team_name || '';
  if (currentText) currentText.textContent = label;
  if (currentLogo) currentLogo.src = t.logo_url || "";

  history.unshift(t);
  if (history.length > 50) history = history.slice(0,50);
  saveHistory();
  renderHistory();
}

function spin(){
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) {
    if (currentText) currentText.textContent = 'Please select at least one filter.';
    return;
  }

  spinning = true;
  document.body.classList.add('ui-locked');
  spinBtn.disabled = true;
  spinFab.disabled = true;
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

      // snap
      const centerAngle = idx * slice + slice/2;
      const snapDelta = mod(centerAngle - offset, TAU);
      currentAngle = mod(currentAngle + snapDelta, TAU);

      spinning = false;
      document.body.classList.remove('ui-locked');
      const hasAny = getCurrentData().length > 0;
      spinBtn.disabled = !hasAny;
      spinFab.disabled = !hasAny;

      selectedIdx = idx;
      drawWheel();
      setResult(idx);
    }
  }
  requestAnimationFrame(anim);
}

// -------------------- Events --------------------
function setupEventListeners() {
  chipsWrap.addEventListener('change', () => {
    if (spinning) return;
    selectedIdx = -1;
    drawWheel();
    updateSpinAvailability();
    if (getCurrentData().length === 0 && currentText) currentText.textContent = 'Please select at least one filter.';
    updateSelectionBanner();
  });

  toggleMore.addEventListener('click', () => {
    if (spinning) return;
    const hidden = chipsMore.hidden;
    chipsMore.hidden = !hidden;
    toggleMore.setAttribute('aria-expanded', hidden ? 'true' : 'false');
    toggleMore.textContent = hidden
      ? (MODE === 'player' ? 'Show fewer clubs' : 'Show fewer leagues')
      : (MODE === 'player' ? 'Show more Premier League clubs' : 'Show more leagues');
  });

  const onWheelToggleChange = () => {
    if (spinning) return;
    drawWheel(); // also updates player secondary line
  };
  optName?.addEventListener('change', onWheelToggleChange);
  optLogo?.addEventListener('change', onWheelToggleChange);
  optStadium?.addEventListener('change', onWheelToggleChange);
  optLeague?.addEventListener('change', onWheelToggleChange);

  spinBtn.onclick = spin;
  spinFab.onclick = spin;

  resetHistoryBtn.addEventListener('click', () => { if (!spinning) resetHistory(); });

  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => { sizeCanvas(); drawWheel(); }, 120);
  }, { passive: true });
}

// -------------------- Boot --------------------
fetch(`./teams.json?v=${Date.now()}`)
  .then(res => res.json())
  .then(async data => {
    TEAMS = data;
    renderHistory();
    sizeCanvas();

    // TEAM mode default: EPL checked
    renderLeagueChips();
    setCheckedCodes(['EPL']);

    setupEventListeners();

    // reflect saved mode choice
    if (MODE === 'player') {
      // ensure players loaded before rendering chips/wheel
      await loadPlayers();
      renderPlayerTeamChips();
    }
    setMode(MODE); // re-applies labels & chips

    drawWheel();
    updateSpinAvailability();
  })
  .catch(err => {
    console.error('Failed to load teams.json', err);
    if (currentText) currentText.textContent = 'Failed to load teams.';
  });

// Helpers to (re)apply chip checks
function setCheckedCodes(values = []) {
  const set = new Set(values);
  chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => {
    i.checked = set.has(i.value);
    i.setAttribute('aria-checked', i.checked ? 'true' : 'false');
  });
  selectedIdx = -1;
  drawWheel();
  updateSpinAvailability();
}
