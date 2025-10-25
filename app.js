// Football Club Spinner — unified TEAM/PLAYER app.js
// - TEAM: Logo / Name / Stadium / League (league never shown if you uncheck it)
// - PLAYER: Image / Name / Jersey Number / Nationality (+ filter by club)
// - All/None/TopX work per-mode (Top5 leagues for TEAM, Top6 clubs for PLAYER)
// - Modal “Show X” buttons appear right next to the blurred element
// - Content suppression: >50 slices hides all content for legibility

/* =========================
   Global state
   ========================= */
let TEAMS = [];
let PLAYERS = [];
let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';
const ENABLE_PLAYER = true;

let currentAngle = 0; // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

let lastModalTeam = null;
let modalRevealState = { logo: false, name: false, stadium: false, league: false };

/* =========================
   DOM
   ========================= */
const chipsWrap = document.getElementById('chips');
const chipsTop  = document.getElementById('chipsTop');
const chipsMore = document.getElementById('chipsMore');
const toggleMore= document.getElementById('toggleMore');

const qpAll  = document.getElementById('qpAll');
const qpNone = document.getElementById('qpNone');
const qpTop5 = document.getElementById('qpTop5');

const spinBtn  = document.getElementById('spinBtn');
const spinFab  = document.getElementById('spinFab');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName    = document.getElementById('optName');
const optLogo    = document.getElementById('optLogo');
const optSub1    = document.getElementById('optStadium'); // TEAM: Stadium | PLAYER: Jersey Number
const optSub2    = document.getElementById('optLeague');  // TEAM: League  | PLAYER: Nationality
const lblName    = document.getElementById('lblName');
const lblLogo    = document.getElementById('lblLogo');
const lblSub1    = document.getElementById('lblSub1');
const lblSub2    = document.getElementById('lblSub2');

const teamView      = document.getElementById('teamView');
const playerView    = document.getElementById('playerView');
const playerListEl  = document.getElementById('playerList');
const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

const wheel    = document.getElementById('wheel');
const fx       = document.getElementById('fx');
const perfTip  = document.getElementById('perfTip');

const historyEl   = document.getElementById('history');
const currentLogo = document.getElementById('currentLogo');
const currentText = document.getElementById('currentText');

// Modal
const backdrop = document.getElementById('backdrop');
const modalEl  = document.getElementById('modal');
const mClose   = document.getElementById('mClose');
const mHead    = document.getElementById('mHead');
const mSub     = document.getElementById('mSub');
const mLogo    = document.getElementById('mLogo');
const mStadium = document.getElementById('mStadium');

/* =========================
   Constants
   ========================= */
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;

const TEAM_SUPPRESS_THRESHOLD   = 50;
const PLAYER_SUPPRESS_THRESHOLD = 50;

const TEAM_TOP5 = ['EPL','SA','BUN','L1','LLA'];                // quick pick
const PLAYER_TOP6_CLUBS = [18, 9, 14, 8, 19, 6];  // CHE, MCI, MUN, LIV, ARS, TOT (Sportmonks IDs)

// Safety map for PL IDs → names
const PL_TEAM_MAP = {
  1:"West Ham United",3:"Sunderland",6:"Tottenham Hotspur",8:"Liverpool FC",9:"Manchester City",
  11:"Fulham FC",13:"Everton FC",14:"Manchester United",15:"Aston Villa",18:"Chelsea FC",
  19:"Arsenal FC",20:"Newcastle United",27:"Burnley FC",29:"Wolverhampton Wanderers",
  51:"Crystal Palace",52:"AFC Bournemouth",63:"Nottingham Forest",71:"Leeds United",
  78:"Brighton & Hove Albion",236:"Brentford"
};

const LEAGUE_LABELS = {
  AUT: "Austrian Bundesliga", BEL: "Jupiler Pro League", BUL: "efbet Liga", CRO: "SuperSport HNL",
  CZE: "Fortuna Liga", DEN: "Superliga", EPL: "Premier League", L1: "Ligue 1", BUN: "Bundesliga",
  GRE: "Super League 1", ISR: "Ligat ha'Al", SA: "Serie A", NED: "Eredivisie", NOR: "Eliteserien",
  POL: "PKO BP Ekstraklasa", POR: "Liga Portugal", ROU: "SuperLiga", RUS: "Premier Liga",
  SCO: "Scottish Premiership", SRB: "Super liga Srbije", LLA: "LaLiga", SWE: "Allsvenskan",
  SUI: "Super League", TUR: "Süper Lig", UKR: "Ukrainian Premier League", PLAYER: "Players"
};

/* =========================
   Utils
   ========================= */
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;

const IMG_CACHE = new Map();
function getLogo(url, onLoad) {
  if (!url) return null;
  const c = IMG_CACHE.get(url);
  if (c) return c.img;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  img.onload = () => onLoad && onLoad();
  img.onerror = () => onLoad && onLoad();
  IMG_CACHE.set(url, { img });
  return img;
}

function textColorFor(hex) {
  if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#', '');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}

function ensureRevealStyles() {
  if (document.getElementById('reveal-style')) return;
  const s = document.createElement('style');
  s.id = 'reveal-style';
  s.textContent = `
    .reveal-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;padding:8px 12px;border-radius:10px;border:1px solid rgba(90,161,255,.6);background:#152036;color:#fff;font-weight:800;letter-spacing:.03em;cursor:pointer;user-select:none;position:relative;white-space:nowrap}
    .reveal-wrap{position:relative;display:inline-block}
    .reveal-overlay{position:absolute;inset:0;border-radius:inherit;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:transparent;pointer-events:none}
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
function blurElement(el){ if(!el) return; el.style.setProperty('filter','blur(14px) saturate(0.9)','important'); el.style.pointerEvents='none'; addOverlay(el); }
function unblurElement(el){ if(!el) return; el.style.removeProperty('filter'); el.style.pointerEvents=''; removeOverlay(el); el.setAttribute('aria-hidden','false'); }

function applyRevealByKey(key, el, enabled, btnId, labelText) {
  if (!el) return;
  removeExistingRevealBtn(btnId);
  const revealed = !!modalRevealState[key];
  if (enabled || revealed) { unblurElement(el); return; }
  blurElement(el);
  const btn = document.createElement('button');
  btn.id = btnId; btn.type='button'; btn.className='reveal-btn';
  btn.textContent = `Show ${labelText}`;
  btn.addEventListener('click', (e)=>{ e.preventDefault(); modalRevealState[key]=true; unblurElement(el); btn.remove(); });
  // place right after the element (or wrapper)
  const host = el.parentElement?.classList?.contains('reveal-wrap') ? el.parentElement : el;
  host.insertAdjacentElement('afterend', btn);
}

function updateModalRevealFromToggles() {
  if (!isModalOpen() || !lastModalTeam) return;
  if (MODE === 'team') {
    applyRevealByKey('logo',    mLogo, !!optLogo?.checked,  'revealLogoBtn',    'logo');
    applyRevealByKey('name',    mHead, !!optName?.checked,  'revealNameBtn',    'name');
    applyRevealByKey('stadium', mStadium, !!optSub1?.checked, 'revealStadiumBtn', 'stadium');
    applyRevealByKey('league',  mSub,  !!optSub2?.checked,  'revealLeagueBtn',  'league');
  } else {
    // PLAYER: image/name/jersey/nationality
    applyRevealByKey('logo',    mLogo, !!optLogo?.checked,  'revealImageBtn',     'image');
    applyRevealByKey('name',    mHead, !!optName?.checked,  'revealPlayerNameBtn','name');
    applyRevealByKey('stadium', mStadium, !!optSub1?.checked, 'revealJerseyBtn',  'jersey number');
    applyRevealByKey('league',  mSub,  !!optSub2?.checked,  'revealNatBtn',       'nationality');
  }
}

function isModalOpen(){ return backdrop && backdrop.style.display === 'flex'; }

/* =========================
   Mode labels
   ========================= */
function wireShowOnWheelLabels() {
  if (MODE === 'team') {
    lblName && (lblName.textContent = 'Name');
    lblLogo && (lblLogo.textContent = 'Logo');
    lblSub1 && (lblSub1.textContent = 'Stadium');
    lblSub2 && (lblSub2.textContent = 'League');
  } else {
    lblName && (lblName.textContent = 'Name');
    lblLogo && (lblLogo.textContent = 'Image');
    lblSub1 && (lblSub1.textContent = 'Jersey Number');
    lblSub2 && (lblSub2.textContent = 'Nationality');
  }
}

/* =========================
   Chips & Quick picks (mode-aware)
   ========================= */
function makeChip(code, checked) {
  const full = LEAGUE_LABELS[code] || code;
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${code}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${full}">
    <span class="chip-text" title="${full}">${full}</span>`;
  return label;
}
function buildClubMapFromPlayers() {
  const map = {};
  TEAMS.forEach(t => { if (t?.team_id && t?.team_name) map[t.team_id] = t.team_name; });
  Object.keys(PL_TEAM_MAP).forEach(k => { if (!map[k]) map[k] = PL_TEAM_MAP[k]; });
  (PLAYERS||[]).forEach(p => {
    if (p.meta?.club_id && p.meta?.club_name && !map[p.meta.club_id]) map[p.meta.club_id] = p.meta.club_name;
  });
  return map;
}
function renderChips() {
  chipsTop.innerHTML=''; chipsMore.innerHTML='';
  if (MODE === 'team') {
    const codes = [...new Set(TEAMS.map(t => t.league_code))].sort();
    const top = TEAM_TOP5.filter(c => codes.includes(c));
    const rest= codes.filter(c => !top.includes(c));
    top.forEach(c => chipsTop.appendChild(makeChip(c, c==='EPL')));
    rest.forEach(c => chipsMore.appendChild(makeChip(c, false)));
    toggleMore.textContent = 'Show more leagues';
    chipsMore.hidden = true;
  } else {
    const clubMap = buildClubMapFromPlayers();
    const ids = Object.keys(clubMap).map(Number).sort((a,b)=>clubMap[a].localeCompare(clubMap[b]));
    const top = PLAYER_TOP6_CLUBS.filter(id => ids.includes(id));
    const rest= ids.filter(id => !top.includes(id));
    const makeClub = (id, chk=false) => {
      const label = document.createElement('label');
      label.className='chip';
      label.innerHTML = `<input type="checkbox" value="club:${id}" ${chk?'checked aria-checked="true"':''}>
        <span class="chip-text">${clubMap[id]||('Club '+id)}</span>`;
      return label;
    };
    top.forEach(id => chipsTop.appendChild(makeClub(id, true)));
    rest.forEach(id => chipsMore.appendChild(makeClub(id, false)));
    toggleMore.textContent = 'Show more Premier League clubs';
    chipsMore.hidden = true;
  }
}
function visibleCodes() {
  const list=[];
  chipsTop.querySelectorAll('input[type="checkbox"]').forEach(i=>list.push(i.value));
  if (!chipsMore.hidden) chipsMore.querySelectorAll('input[type="checkbox"]').forEach(i=>list.push(i.value));
  return list;
}
function setCheckedCodes(values=[]) {
  const want = new Set(values);
  chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => {
    const on = want.has(i.value);
    i.checked = on;
    i.setAttribute('aria-checked', on ? 'true':'false');
  });
  selectedIdx = -1;
  drawWheel();
  updateSpinAvailability();
  updateSelectionBanner();
}
function wireQuickPicks() {
  qpAll.onclick  = () => { if (spinning) return; setCheckedCodes(visibleCodes()); qpAll.classList.add('active'); qpNone.classList.remove('active'); qpTop5.classList.remove('active'); };
  qpNone.onclick = () => { if (spinning) return; setCheckedCodes([]); qpAll.classList.remove('active'); qpNone.classList.add('active'); qpTop5.classList.remove('active'); };
  qpTop5.onclick = () => {
    if (spinning) return;
    if (MODE==='team') {
      const want = TEAM_TOP5.filter(c => visibleCodes().includes(c));
      setCheckedCodes(want);
    } else {
      const want = PLAYER_TOP6_CLUBS.map(id=>`club:${id}`).filter(v=>visibleCodes().includes(v));
      setCheckedCodes(want);
    }
    qpAll.classList.remove('active'); qpNone.classList.remove('active'); qpTop5.classList.add('active');
  };
}

/* =========================
   Data accessors
   ========================= */
function getCurrentData() {
  const active = Array.from(chipsWrap.querySelectorAll('#chips input:checked')).map(i => i.value);
  if (MODE==='player') {
    if (!PLAYERS.length) return [];
    if (!active.length) return PLAYERS;
    const ids = new Set(active.filter(v=>v.startsWith('club:')).map(v=>+v.split(':')[1]));
    return PLAYERS.filter(p => ids.has(+p.meta?.club_id || +p.club_id || 0));
  }
  return TEAMS.filter(t => active.includes(t.league_code));
}
function updateSpinAvailability() {
  const n = getCurrentData().length;
  spinBtn && (spinBtn.disabled = n === 0);
  spinFab && (spinFab.disabled = n === 0);
}
function updateSelectionBanner() {
  const N = getCurrentData().length;
  perfTip.textContent = `${N} ${MODE==='player'?'players':'teams'} selected`;
}

/* =========================
   Canvas sizing
   ========================= */
function sizeCanvas() {
  const rect = (wheel.parentElement || wheel).getBoundingClientRect();
  const cssSize = clamp(300, Math.round(rect.width || 640), 1200);
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  wheel.width  = Math.round(cssSize * DPR);
  wheel.height = Math.round(cssSize * DPR);
  fx.width = wheel.width; fx.height = wheel.height;
  wheel.style.width = cssSize + 'px'; wheel.style.height = cssSize + 'px';
  fx.style.width = cssSize + 'px'; fx.style.height = cssSize + 'px';
}

/* =========================
   Drawing
   ========================= */
function drawGradientIdle(ctx, W, H) {
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2,H/2);
  const radius = Math.min(W,H)*0.48;
  const g = ctx.createRadialGradient(0,0,radius*0.1, 0,0,radius);
  g.addColorStop(0,'#1A2C5A'); g.addColorStop(0.35,'#21386F'); g.addColorStop(0.65,'#0E2A57'); g.addColorStop(1,'#0B1B38');
  ctx.beginPath(); ctx.arc(0,0,radius,0,TAU); ctx.fillStyle=g; ctx.fill();
  ctx.lineWidth=1; ctx.strokeStyle='rgba(255,255,255,0.06)';
  for(let i=1;i<=5;i++){ ctx.beginPath(); ctx.arc(0,0,radius*(i/5),0,TAU); ctx.stroke(); }
  ctx.restore();
}

function drawWheel() {
  const data = getCurrentData();
  const N = data.length;
  const ctx = wheel.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const W = wheel.width / DPR;
  const H = wheel.height / DPR;

  if (N === 0) { drawGradientIdle(ctx, W, H); updateSelectionBanner(); return; }
  updateSelectionBanner();

  const suppress = (MODE==='team') ? (N >= TEAM_SUPPRESS_THRESHOLD) : (N >= PLAYER_SUPPRESS_THRESHOLD);

  ctx.imageSmoothingEnabled = !suppress;
  ctx.imageSmoothingQuality = suppress ? 'low':'high';

  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2,H/2);

  const angleDraw = mod(currentAngle, TAU);
  ctx.rotate(angleDraw);

  const radius = Math.min(W,H)*0.48;
  const sliceAngle = TAU / N;

  // Fill wedges
  for (let i=0;i<N;i++) {
    const t = data[i] || {};
    const a0 = i*sliceAngle, a1=(i+1)*sliceAngle;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,radius,a0,a1); ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff'; ctx.fill();
  }

  // Content
  if (!suppress) {
    for (let i=0;i<N;i++) {
      const t = data[i] || {};
      const a0 = i*sliceAngle, a1=(i+1)*sliceAngle, aMid=(a0+a1)/2;
      const sliceArc = radius*(a1-a0);

      let nameText, sub1Text, sub2Text, imageUrl;
      if (MODE==='team') {
        nameText = t.team_name || '';
        sub1Text = t.stadium || '';
        sub2Text = (LEAGUE_LABELS[t.league_code] || t.league_code || '');
        imageUrl = t.logo_url || '';
      } else {
        nameText = t.name || t.team_name || '';
        sub1Text = (t.meta?.jersey_number ? `#${t.meta.jersey_number}` : '');
        sub2Text = t.meta?.nationality || '';
        imageUrl = t.image_url || t.logo_url || '';
      }

      // Options
      const showName = !!optName?.checked;
      const showLogo = !!optLogo?.checked;
      const showS1   = !!optSub1?.checked;
      const showS2   = !!optSub2?.checked;

      // Team: if league must never show, just gate it here (comment next line if you want it toggleable)
      if (MODE==='team') { /* sub2 controlled by toggle; you said allowed via toggle */ }

      ctx.save();
      // clip to slice
      ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,radius-1,a0,a1); ctx.closePath(); ctx.clip();

      // rotate upright
      ctx.rotate(aMid);
      const needFlip = Math.cos(aMid) < 0;
      if (needFlip) ctx.rotate(Math.PI);
      const sign = needFlip ? -1 : 1;

      const pad=10;
      const xLogo = sign*(radius*0.74);
      const xText = sign*(radius*0.42);
      const logoSize = clamp(28, 0.40 * sliceArc, 64);
      const logoHalf = logoSize/2;
      const logoInner = xLogo - sign*(logoHalf+pad);
      const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

      const fg = textColorFor(t.primary_color);

      // Logo / Image
      if (showLogo && imageUrl) {
        ctx.save(); ctx.translate(xLogo,0);
        ctx.beginPath(); ctx.arc(0,0,logoHalf,0,TAU); ctx.closePath();
        ctx.fillStyle='rgba(255,255,255,.07)'; ctx.fill();
        ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.stroke();

        ctx.save(); ctx.beginPath(); ctx.arc(0,0,logoHalf-1,0,TAU); ctx.closePath(); ctx.clip();
        const img = getLogo(imageUrl, ()=>requestAnimationFrame(drawWheel));
        if (img && img.complete) {
          const box = Math.max(4, 2*(logoHalf-1));
          const iw = img.naturalWidth || box, ih = img.naturalHeight || box;
          const s = Math.min(box/iw, box/ih);
          ctx.drawImage(img,-iw*s/2,-ih*s/2,iw*s,ih*s);
        } else {
          ctx.fillStyle='rgba(255,255,255,.12)';
          const ph=(logoHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph);
        }
        ctx.restore(); ctx.restore();
      }

      // Texts
      ctx.save();
      ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillStyle=fg;
      let cursorY = 0, lines = [];

      if (showName && nameText)      lines.push({text:nameText, weight:800, max:24});
      if (showS1 && sub1Text)        lines.push({text:sub1Text, weight:700, max:18});
      if (showS2 && sub2Text)        lines.push({text:sub2Text, weight:700, max:16});

      // measure simple fit (single-line)
      const gap = lines.length > 1 ? 3 : 0;
      let sizes = [], totalH = 0;
      lines.forEach((ln, idx) => {
        let px = clamp(9, 0.2*sliceArc*(idx?0.8:1), ln.max);
        const tmp = px;
        const ctxFont = `${ln.weight} ${px}px Inter, system-ui, sans-serif`;
        ctx.font = ctxFont;
        while (px>9 && ctx.measureText(ln.text).width > maxTextWidth) {
          px -= 1; ctx.font = `${ln.weight} ${px}px Inter, system-ui, sans-serif`;
        }
        sizes.push(px); totalH += px; if (idx===0 && lines.length>1) totalH += gap;
      });

      cursorY = -totalH/2;
      lines.forEach((ln, idx) => {
        const px = sizes[idx]; cursorY += px/2;
        ctx.font = `${ln.weight} ${px}px Inter, system-ui, sans-serif`;
        ctx.strokeStyle='rgba(12,16,28,.65)'; ctx.lineWidth=Math.max(1, Math.round(px/10));
        ctx.strokeText(ln.text, xText, cursorY);
        ctx.fillText(ln.text, xText, cursorY);
        cursorY += px/2 + (idx===0 && lines.length>1 ? gap : 0);
      });

      ctx.restore();
      ctx.restore();
    }
  }

  ctx.restore();
}

/* =========================
   Result / modal / spin
   ========================= */
function preloadModalLogo(url, cb) {
  if (!url) { cb && cb(); return; }
  const img = getLogo(url, () => done());
  let called = false;
  function done(){ if (called) return; called = true; cb && cb(); }
  if (img) {
    try { if (img.complete) { done(); } else if (typeof img.decode === 'function') { img.decode().then(done).catch(done); } }
    catch { done(); }
  } else done();
}

function openModal(item) {
  ensureRevealStyles();
  lastModalTeam = item;
  modalRevealState = { logo:false, name:false, stadium:false, league:false };

  if (MODE==='team') {
    mHead.textContent = item.team_name || '—';
    mSub.textContent  = LEAGUE_LABELS[item.league_code] || item.league_code || '';
    mLogo.src = item.logo_url || '';
    mLogo.alt = (item.team_name||'Club')+' logo';
    mStadium.textContent = item.stadium || '—';
  } else {
    const nm  = item.name || item.team_name || 'Player';
    const nat = item.meta?.nationality || '';
    const jer = item.meta?.jersey_number ? `#${item.meta.jersey_number}` : '';
    mHead.textContent = nm;
    mSub.textContent  = nat;
    mLogo.src = item.image_url || item.logo_url || '';
    mLogo.alt = nm;
    mStadium.textContent = jer || '—';
  }

  backdrop.style.display='flex';
  requestAnimationFrame(()=>{ modalEl.classList.add('show'); updateModalRevealFromToggles(); });
}
function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=>{ backdrop.style.display='none'; },150); }

function setResult(idx) {
  const data = getCurrentData();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  if (MODE==='team') {
    history.unshift({ team_name:t.team_name, logo_url:t.logo_url, league_code:t.league_code });
  } else {
    history.unshift({ team_name:(t.name||t.team_name)+' (Players)', logo_url:t.image_url || t.logo_url, league_code:'PLAYER' });
  }
  if (history.length>50) history = history.slice(0,50);
  localStorage.setItem('clubHistory', JSON.stringify(history));
  renderHistory();

  const url = MODE==='team' ? t.logo_url : (t.image_url || t.logo_url);
  if (url) preloadModalLogo(url, ()=>openModal(t)); else openModal(t);
}

function renderHistory() {
  historyEl.innerHTML='';
  if (!history.length) {
    historyEl.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
    return;
  }
  history.forEach(h => {
    const div = document.createElement('div'); div.className='item';
    const i = document.createElement('img'); i.src = h.logo_url || ''; i.alt=''; i.onerror=()=>{i.src='';};
    const s = document.createElement('span'); s.textContent = h.team_name;
    div.append(i,s); historyEl.append(div);
  });
}

function lockUI(lock) {
  document.body.classList.toggle('ui-locked', !!lock);
  const els = document.querySelectorAll('button, input, select, textarea, [role="button"]');
  els.forEach(el => { el.disabled = !!lock; if (lock) el.setAttribute('aria-disabled','true'); else el.removeAttribute('aria-disabled'); });
}

function spin() {
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) return;

  spinning = true; lockUI(true);
  spinBtn.disabled=true; spinFab.disabled=true; selectedIdx = -1;

  const N = data.length, slice = TAU/N;
  const extraTurns = 6 + Math.floor(Math.random()*3);
  const targetAngle = TAU*extraTurns + Math.random()*TAU;

  const start=performance.now(), duration=3200, easeOut=x=>1-Math.pow(1-x,3);

  function anim(now){
    const p = clamp(0,(now-start)/duration,1);
    currentAngle = targetAngle*easeOut(p);
    drawWheel();
    if (p<1) requestAnimationFrame(anim);
    else {
      const theta = mod(currentAngle, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;

      // snap
      const centerAngle = idx*slice + slice/2;
      const snapDelta = mod(centerAngle - offset, TAU);
      currentAngle = mod(currentAngle + snapDelta, TAU);

      spinning=false; lockUI(false);
      const hasAny = getCurrentData().length>0; spinBtn.disabled=!hasAny; spinFab.disabled=!hasAny;
      selectedIdx = idx; drawWheel(); setResult(idx);
    }
  }
  requestAnimationFrame(anim);
}

/* =========================
   Events
   ========================= */
function setupEventListeners() {
  chipsWrap.addEventListener('change', () => { if (spinning) return; selectedIdx=-1; drawWheel(); updateSpinAvailability(); updateSelectionBanner(); });

  toggleMore.addEventListener('click', () => {
    if (spinning) return;
    const hidden = chipsMore.hidden;
    chipsMore.hidden = !hidden;
    toggleMore.textContent = hidden
      ? (MODE==='team' ? 'Show fewer leagues' : 'Show fewer clubs')
      : (MODE==='team' ? 'Show more leagues' : 'Show more Premier League clubs');
  });

  const onWheelToggleChange = () => { if (spinning) return; drawWheel(); if (isModalOpen()) updateModalRevealFromToggles(); };
  optName?.addEventListener('change', onWheelToggleChange);
  optLogo?.addEventListener('change', onWheelToggleChange);
  optSub1?.addEventListener('change', onWheelToggleChange);
  optSub2?.addEventListener('change', onWheelToggleChange);

  spinBtn.onclick = spin; spinFab.onclick = spin;
  resetHistoryBtn.onclick = () => { if (spinning) return; history=[]; localStorage.setItem('clubHistory','[]'); renderHistory(); };

  mClose.onclick = () => { if (!spinning) closeModal(); };
  backdrop.addEventListener('click', (e) => { if (!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', (e)=>{ if(!spinning && e.key==='Escape' && isModalOpen()) closeModal(); });

  let resizeTO;
  window.addEventListener('resize', () => { clearTimeout(resizeTO); resizeTO=setTimeout(()=>{ sizeCanvas(); drawWheel(); }, 120); }, { passive:true });

  modeTeamBtn?.addEventListener('click', ()=>setMode('team'));
  modePlayerBtn?.addEventListener('click',()=>setMode('player'));
}

/* =========================
   Player loader (public JSON)
   ========================= */
const FALLBACK_SILHOUETTE = '/players/silhouette-player.png';
function resolvePublicUrl(p){ if(!p) return ''; if(/^https?:\/\//i.test(p)) return p; if(p.startsWith('/')) return p; return '/'+p; }
async function tryFetchPlayers(){
  const candidates = ['/data/players.json','/players/players.json', new URL('./players/players.json', location.href).toString()];
  for (const url of candidates) { try{ const res=await fetch(url,{cache:'no-store'}); if(res.ok) return {res,url}; }catch{} }
  return {res:null,url:null};
}

async function loadPlayers() {
  const { res } = await tryFetchPlayers();
  if (!res) throw new Error('players.json not found');
  const raw = await res.json();

  const clubMap = {};
  TEAMS.forEach(t => { if (t.team_id && t.team_name) clubMap[t.team_id] = t.team_name; });
  Object.keys(PL_TEAM_MAP).forEach(k => { if (!clubMap[k]) clubMap[k] = PL_TEAM_MAP[k]; });

  PLAYERS = (raw || []).map(p => {
    const name = p.name || p.player_name || 'Player';
    const img  = resolvePublicUrl(p.image_url || p.image || p.file || FALLBACK_SILHOUETTE);
    const club_id = +p.club_id || +p.meta?.club_id || 0;
    const club_name = p.club || p.meta?.club_name || clubMap[club_id] || 'Unknown Team';
    return {
      team_name: name, logo_url: img, league_code: 'PLAYER',
      primary_color:'#163058', stadium:'',
      name, image_url: img,
      meta: {
        club_id, club_name,
        nationality: p.nationality || p.meta?.nationality || '',
        jersey_number: p.jersey_number || p.meta?.jersey_number || ''
      }
    };
  });

  if (playerListEl) {
    playerListEl.innerHTML = '';
    PLAYERS.slice(0,60).forEach(pl => {
      const el=document.createElement('div'); el.className='player-item';
      el.innerHTML = `<img src="${pl.image_url}" alt="${pl.name}" width="40" height="40" style="border-radius:10px;object-fit:cover;margin-right:8px"> ${pl.name}`;
      playerListEl.appendChild(el);
    });
  }
  requestAnimationFrame(drawWheel);
  return PLAYERS;
}

/* =========================
   Mode switch
   ========================= */
function setMode(next) {
  if (next === MODE) return;
  if (next === 'player' && !ENABLE_PLAYER) return;

  MODE = next; localStorage.setItem('fsMode', MODE);
  modeTeamBtn?.classList.toggle('mode-btn-active', MODE==='team');
  modePlayerBtn?.classList.toggle('mode-btn-active', MODE==='player');
  modeTeamBtn?.setAttribute('aria-pressed', MODE==='team'?'true':'false');
  modePlayerBtn?.setAttribute('aria-pressed', MODE==='player'?'true':'false');

  teamView?.classList.toggle('hidden', MODE==='player');
  playerView?.classList.toggle('hidden', MODE==='team');

  wireShowOnWheelLabels();
  renderChips();

  selectedIdx = -1;

  if (MODE==='player') {
    loadPlayers().then(()=>{ sizeCanvas(); drawWheel(); updateSpinAvailability(); })
                 .catch(err => { console.warn('players.json unavailable; reverting to TEAM', err); MODE='team'; setMode('team'); });
  } else {
    drawWheel(); updateSpinAvailability();
  }
}

/* =========================
   Boot
   ========================= */
fetch(`./teams.json?v=${Date.now()}`)
  .then(res => res.json())
  .then(data => {
    TEAMS = data || [];
    ensureRevealStyles();
    wireShowOnWheelLabels();
    renderChips();
    wireQuickPicks();
    renderHistory();
    sizeCanvas();
    // default: EPL-only first
    setCheckedCodes(['EPL']);
    drawWheel();
    setupEventListeners();
    // reflect saved mode
    if (MODE==='player') setMode('player');
  })
  .catch(err => {
    console.error('Failed to load teams.json', err);
    if (currentText) currentText.textContent = 'Failed to load teams.';
    sizeCanvas(); drawWheel(); setupEventListeners();
  });
