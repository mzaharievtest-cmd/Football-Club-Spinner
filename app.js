/* Core state from your latest (trimmed to additions that matter here) */
let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';

let TEAMS = []; let TEAM_BY_ID = new Map(); let CLUB_BY_ID = new Map();
let PLAYERS = []; let TOTAL_TEAMS = 0; let TOTAL_PLAYERS = 0;

let currentAngle = 0, spinning = false, selectedIdx = -1;

/* DOM */
const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

const qpAll = document.getElementById('qpAll');
const qpNone= document.getElementById('qpNone');
const qpTopBtn = document.getElementById('qpTop');

const chipsWrap = document.getElementById('chips');
const chipsTop  = document.getElementById('chipsTop');
const chipsMore = document.getElementById('chipsMore');
const toggleMore= document.getElementById('toggleMore');

const optA = document.getElementById('optA'); // Logo / Image
const optB = document.getElementById('optB'); // Name
const optC = document.getElementById('optC'); // Stadium / Jersey
const optD = document.getElementById('optD'); // League / Nationality
const optE = document.getElementById('optE'); // Team label (player modal extra)
const lblA = document.getElementById('lblA');
const lblB = document.getElementById('lblB');
const lblC = document.getElementById('lblC');
const lblD = document.getElementById('lblD');
const lblE = document.getElementById('lblE');

const spinBtn = document.getElementById('spinBtn');
const spinFab = document.getElementById('spinFab');
const perfTip = document.getElementById('perfTip');
const wheel   = document.getElementById('wheel');
const fx      = document.getElementById('fx');
const luckBadge = document.getElementById('luckBadge');

const historyEl = document.getElementById('history');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const backdrop = document.getElementById('backdrop');
const modalEl  = document.getElementById('modal');
const mClose   = document.getElementById('mClose');
const mHead = document.getElementById('mHead'); const mSub = document.getElementById('mSub');
const mLogo = document.getElementById('mLogo');
const rowStadium = document.getElementById('rowStadium');
const mStadium   = document.getElementById('mStadium');
const rowClub    = document.getElementById('rowClub'); const mClub = document.getElementById('mClub');
const rowJersey  = document.getElementById('rowJersey'); const mJersey = document.getElementById('mJersey');
const rowNat     = document.getElementById('rowNat'); const mNat = document.getElementById('mNat');

/* Modes dropdown */
const modesBtn  = document.getElementById('modesBtn');
const modesMenu = document.getElementById('modesMenu');

/* History */
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];
const saveHistory = () => localStorage.setItem('clubHistory', JSON.stringify(history));

/* Utils */
const TAU = Math.PI*2;
const POINTER_ANGLE = ((-Math.PI/2)+TAU)%TAU;
const clamp = (a,x,b)=>Math.max(a,Math.min(b,x));
const mod   = (x,m)=>((x%m)+m)%m;

/* --------- MODES / PRESETS --------- */
function setMode(next){
  MODE = (next === 'player') ? 'player' : 'team';
  localStorage.setItem('fsMode', MODE);

  // header tab styling
  const teamActive = MODE==='team';
  modeTeamBtn.setAttribute('aria-selected', teamActive);
  modePlayerBtn.setAttribute('aria-selected', !teamActive);
  modeTeamBtn.classList.toggle('mode-btn-active', teamActive);
  modePlayerBtn.classList.toggle('mode-btn-active', !teamActive);

  // labels for chips
  if (MODE==='player'){
    lblA.textContent='Image';
    lblB.textContent='Name';
    lblC.textContent='Jersey Number';
    lblD.textContent='Nationality';
    lblE.textContent='Team';
    document.getElementById('filter-title').textContent='Select Teams';
    qpAll && (qpAll.textContent='All Premier League teams');
    qpTopBtn && (qpTopBtn.textContent='Top 6 Premier League Teams');
  } else {
    lblA.textContent='Logo';
    lblB.textContent='Name';
    lblC.textContent='Stadium';
    lblD.textContent='League';
    lblE.textContent=''; // hidden use in player modal
    document.getElementById('filter-title').textContent='Select Leagues';
    qpAll && (qpAll.textContent='All Leagues');
    qpTopBtn && (qpTopBtn.textContent='Top 5 Leagues');
  }

  renderChips();
  updatePerfBanner();
  drawWheel();
}

/* Apply presets from the dropdown */
function applyPreset(key){
  // defaults
  optA.checked = optB.checked = optC.checked = optD.checked = optE.checked = false;
  luckBadge.hidden = true;

  switch(key){
    /* Guess Team */
    case 'team-logo':     setMode('team');   optA.checked = true; break;
    case 'team-stadium':  setMode('team');   optC.checked = true; break;
    case 'team-league':   setMode('team');   optD.checked = true; luckBadge.hidden = false; break;

    /* Guess Stadium (team mode, different reveal) */
    case 'stadium-name':  setMode('team');   optB.checked = true; break;
    case 'stadium-logo':  setMode('team');   optA.checked = true; break;

    /* Guess Player */
    case 'player-jersey': setMode('player'); optC.checked = true; break;
    case 'player-nation': setMode('player'); optD.checked = true; break;
    case 'player-photo':  setMode('player'); optA.checked = true; break;

    /* Free Spin: keep our sane defaults */
    default:
    case 'free-spin':
      if (MODE==='player'){ setMode('player'); optA.checked=true; }
      else { setMode('team'); optA.checked=true; }
  }

  // redraw with new show-on-wheel state
  selectedIdx = -1;
  updatePerfBanner();
  drawWheel();

  // close menu
  modesMenu.classList.remove('open');
  modesBtn.setAttribute('aria-expanded','false');
}

/* menu interactions */
if (modesBtn && modesMenu){
  modesBtn.addEventListener('click', ()=>{
    const open = !modesMenu.classList.contains('open');
    modesMenu.classList.toggle('open', open);
    modesBtn.setAttribute('aria-expanded', String(open));
  });
  modesMenu.addEventListener('click', (e)=>{
    const btn = e.target.closest('.modes-item');
    if (!btn) return;
    const preset = btn.dataset.preset;
    applyPreset(preset);
  });
  document.addEventListener('click', (e)=>{
    if (!modesMenu.contains(e.target) && e.target!==modesBtn){
      modesMenu.classList.remove('open');
      modesBtn.setAttribute('aria-expanded','false');
    }
  });
}

/* ---------- Data chips, wheel, modal, events ----------
   (unchanged logic; condensed to keep this file readable) */

/* Chips helpers */
function makeChip(value, text, checked){
  const label = document.createElement('label');
  label.className='chip';
  label.innerHTML = `<input type="checkbox" value="${value}" ${checked?'checked':''}><span class="chip-text">${text}</span>`;
  return label;
}
function activeCodes(){
  const arr=[]; chipsWrap.querySelectorAll('input[type="checkbox"]:checked').forEach(i=>arr.push(i.value)); return arr;
}
function getCurrentData(){
  const active = new Set(activeCodes());
  if (active.size===0) return [];
  if (MODE==='player'){
    return PLAYERS.filter(p =>
      active.has(String(p.club_id)) &&
      p.image_url && String(p.image_url).trim().length>4 &&
      !/placeholder\.png$/i.test(p.image_url)
    );
  }
  return TEAMS.filter(t=>active.has(t.league_code));
}
function visibleCodesAll(){
  const out=[]; chipsTop.querySelectorAll('input[type="checkbox"]').forEach(i=>out.push(i.value));
  chipsMore.querySelectorAll('input[type="checkbox"]').forEach(i=>out.push(i.value)); return out;
}
const TOP5=['EPL','SA','BUN','L1','LLA'];
const PL_TOP6=['19','18','8','9','14','6'];
const FALLBACK_TEAMS={'6':'Tottenham Hotspur','8':'Liverpool','9':'Manchester City','18':'Chelsea','19':'Arsenal','14':'Manchester United','78':'Brighton & Hove Albion','236':'Brentford'};
const LEAGUE_LABELS={EPL:"Premier League",L1:"Ligue 1",BUN:"Bundesliga",SA:"Serie A",LLA:"LaLiga"};

function leagueLabel(c){return LEAGUE_LABELS[c]||c;}

function renderChips(){
  chipsTop.innerHTML=''; chipsMore.innerHTML='';
  if (MODE==='player'){
    const ids=[...new Set(PLAYERS.map(p=>String(p.club_id)))];
    const nameFor=id=>CLUB_BY_ID.get(id)||FALLBACK_TEAMS[id]||`Team #${id}`;
    const top6 = PL_TOP6.filter(id=>ids.includes(id)).sort((a,b)=>nameFor(a).localeCompare(nameFor(b)));
    const rest = ids.filter(id=>!PL_TOP6.includes(id)).sort((a,b)=>nameFor(a).localeCompare(nameFor(b)));
    const defSel=new Set(['19']); // Arsenal only
    top6.forEach(id=>chipsTop.appendChild(makeChip(id,nameFor(id),defSel.has(id))));
    rest.forEach(id=>chipsMore.appendChild(makeChip(id,nameFor(id),defSel.has(id))));
    qpAll && (qpAll.textContent='All Premier League teams');
    qpTopBtn && (qpTopBtn.textContent='Top 6 Premier League Teams');
    toggleMore.textContent='Show more Premier League teams'; chipsMore.hidden=true; toggleMore.setAttribute('aria-expanded','false');
  } else {
    const codes=[...new Set(TEAMS.map(t=>t.league_code))];
    const top=TOP5.filter(c=>codes.includes(c));
    const more=codes.filter(c=>!top.includes(c)).sort();
    top.forEach(c=>chipsTop.appendChild(makeChip(c,leagueLabel(c),c==='EPL')));
    more.forEach(c=>chipsMore.appendChild(makeChip(c,leagueLabel(c),false)));
    qpAll && (qpAll.textContent='All Leagues');
    qpTopBtn && (qpTopBtn.textContent='Top 5 Leagues');
    toggleMore.textContent='Show more leagues'; chipsMore.hidden=true; toggleMore.setAttribute('aria-expanded','false');
  }
  updatePerfBanner(); drawWheel();
}

/* Perf meter */
function updatePerfBanner(){
  const n=getCurrentData().length;
  const total=(MODE==='player')?(TOTAL_PLAYERS||1):(TOTAL_TEAMS||1);
  perfTip.style.setProperty('--pct', Math.max(0,Math.min(1,n/total)));
  perfTip.querySelector('.meter-text').textContent = `${n} ${MODE==='player'?'players loaded':'teams ready to spin'}`;
  const disabled = n===0; spinBtn.disabled=disabled; spinFab.disabled=disabled;
}

/* Wheel drawing (same visuals you had; kept condensed) */
const PERF={hideTextThreshold:50,minTextWidth:44,minLogoBox:26};
function drawIdle(ctx,W,H){
  ctx.clearRect(0,0,W,H); ctx.save(); ctx.translate(W/2,H/2);
  const r=Math.min(W,H)*0.48;
  const g=ctx.createRadialGradient(0,0,r*.1,0,0,r);
  g.addColorStop(0,'#1A2C5A'); g.addColorStop(.35,'#21386F'); g.addColorStop(.65,'#0E2A57'); g.addColorStop(1,'#0B1B38');
  ctx.beginPath(); ctx.arc(0,0,r,0,TAU); ctx.fillStyle=g; ctx.fill(); ctx.restore();
}
function drawWheel(){
  const data=getCurrentData(); const N=data.length;
  const ctx=wheel.getContext('2d'); const DPR=Math.max(1,window.devicePixelRatio||1);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const W=wheel.width/DPR,H=wheel.height/DPR;
  updatePerfBanner(); if(N===0){drawIdle(ctx,W,H);return;}
  const hideAll = N>=PERF.hideTextThreshold; ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2,H/2); ctx.rotate(mod(currentAngle,TAU));
  const r=Math.min(W,H)*0.48, slice=TAU/N;

  // wedges
  for(let i=0;i<N;i++){ ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,r,i*slice,(i+1)*slice); ctx.closePath(); ctx.fillStyle=data[i].primary_color||'#243e6b'; ctx.fill(); }

  if (!hideAll){
    const minW=PERF.minTextWidth;
    for(let i=0;i<N;i++){
      const t=data[i], a0=i*slice, a1=(i+1)*slice, aMid=(a0+a1)/2, arcLen=r*(a1-a0);
      const canLogo = (MODE==='team') ? (optA.checked && !!t.logo_url) : (optA.checked && !!t.image_url);
      const canName = optB.checked && !!t.team_name;
      ctx.save(); ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,r-1,a0,a1); ctx.closePath(); ctx.clip();
      ctx.rotate(aMid); const needFlip=Math.cos(aMid)<0; if(needFlip) ctx.rotate(Math.PI);
      const sign = needFlip?-1:1;
      const logoSize=clamp(PERF.minLogoBox,0.38*arcLen,62), logoHalf=logoSize/2, pad=10;
      const xLogo=sign*(r*0.74), xText=sign*(r*0.42), logoInner=xLogo - sign*(logoHalf+pad);
      const maxWidth=Math.max(minW, Math.abs(logoInner-xText));
      if (canName && maxWidth>=minW){
        ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.font=`800 ${Math.min(22,0.22*arcLen)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle='#fff'; ctx.fillText(t.team_name, Math.min(xText,logoInner), 0);
      }
      if (canLogo){
        ctx.save(); ctx.translate(xLogo,0); ctx.beginPath(); ctx.arc(0,0,logoHalf,0,TAU); ctx.fillStyle='rgba(255,255,255,.08)'; ctx.fill();
        ctx.clip(); const img = new Image(); img.src = (MODE==='team'?t.logo_url:t.image_url)||''; img.onload=()=>requestAnimationFrame(drawWheel);
        if (img.complete) ctx.drawImage(img,-logoHalf,-logoHalf,logoSize,logoSize);
        ctx.restore();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

/* Spin */
function spin(){
  if (spinning) return; const data=getCurrentData(); if(!data.length) return;
  spinning=true; document.body.classList.add('ui-locked'); spinBtn.disabled=spinFab.disabled=true;
  const N=data.length, slice=TAU/N, target=TAU*(6+Math.floor(Math.random()*3))+Math.random()*TAU;
  const start=performance.now(), dur=3200, ease=x=>1-Math.pow(1-x,3);
  function step(now){
    const p=clamp(0,(now-start)/dur,1); currentAngle = target*ease(p); drawWheel();
    if(p<1) requestAnimationFrame(step); else{
      const theta=mod(currentAngle,TAU), offset=mod(POINTER_ANGLE-theta,TAU);
      const idx=Math.floor(offset/slice)%N, center=idx*slice+slice/2, delta=mod(center-offset,TAU);
      currentAngle=mod(currentAngle+delta,TAU); spinning=false; document.body.classList.remove('ui-locked');
      spinBtn.disabled=spinFab.disabled=false; selectedIdx=idx; drawWheel(); showResult(idx);
    }
  }
  requestAnimationFrame(step);
}
function showResult(idx){
  const item=getCurrentData()[idx]; if(!item) return;
  history.unshift({ type: MODE, item }); if (history.length>50) history.length=50; saveHistory(); renderHistory(); openModal(item);
}

/* History render */
function renderHistory(){
  historyEl.innerHTML=''; const vis=history.filter(h=>h.type===MODE);
  if(!vis.length){
    const empty=document.createElement('div'); empty.className='item'; empty.textContent='Your journey starts with a spin!'; historyEl.appendChild(empty); return;
  }
  vis.forEach(({item})=>{
    const row=document.createElement('div'); row.className='item';
    const img=document.createElement('img'); img.width=38; img.height=38;
    img.src=(MODE==='player'?item.image_url:item.logo_url)||''; img.alt=item.team_name||'';
    const span=document.createElement('span'); span.textContent=item.team_name||'';
    row.append(img,span); historyEl.append(row);
  });
}

/* Modal (same show/hide rules as before; simplified) */
function openModal(item){
  const show = (row,on)=>{ row.hidden=!on; row.style.display = on?'':'none'; };

  if (MODE==='player'){
    mHead.textContent=item.team_name||'—'; mSub.textContent=''; mLogo.src=item.image_url||'';
    show(rowStadium,false); show(rowClub,true); show(rowJersey,true); show(rowNat,true);
    mClub.textContent = CLUB_BY_ID.get(String(item.club_id)) || '—';
    mJersey.textContent = item.jersey ? `#${item.jersey}`:'—';
    mNat.textContent = item.nationality || '—';
  } else {
    mHead.textContent=item.team_name||'—'; mSub.textContent = leagueLabel(item.league_code)||''; mLogo.src=item.logo_url||'';
    show(rowStadium,true); show(rowClub,false); show(rowJersey,false); show(rowNat,false);
    mStadium.textContent=item.stadium||'—';
  }

  backdrop.style.display='flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));
}
function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=>backdrop.style.display='none',150); }

/* Data loading */
async function loadTeams(){
  const res=await fetch('./teams.json?v='+Date.now()); TEAMS=await res.json();
  TEAM_BY_ID.clear(); CLUB_BY_ID.clear(); TEAMS.forEach(t=>{const id=String(t.team_id); TEAM_BY_ID.set(id,t); CLUB_BY_ID.set(id,t.team_name);});
  TOTAL_TEAMS=TEAMS.length;
}
async function loadPlayers(){
  const res=await fetch('/data/players.json',{cache:'no-store'}); const raw=await res.json();
  PLAYERS=(raw||[]).map(p=>{
    const clubId=String(p.club_id ?? p.team_id ?? ''); const team=TEAM_BY_ID.get(clubId);
    return { team_name:p.name||p.player_name||'Player', image_url:p.image_url||'', club_id:clubId,
             league_code:team?.league_code||'EPL', nationality:p.nationality||'', jersey:String(p.jersey_number??p.number??''),
             primary_color: team?.primary_color || '#163058' };
  });
  TOTAL_PLAYERS=PLAYERS.length;
  for (const id of new Set(PLAYERS.map(p=>String(p.club_id)))){
    if(!CLUB_BY_ID.has(id)) CLUB_BY_ID.set(id, FALLBACK_TEAMS[id] || `Team #${id}`);
  }
}

/* Events */
function wire(){
  modeTeamBtn.addEventListener('click',()=> setMode('team'));
  modePlayerBtn.addEventListener('click',()=> setMode('player'));

  spinBtn.onclick=spin; spinFab.onclick=spin;
  resetHistoryBtn.onclick=()=>{history=[];saveHistory();renderHistory();}

  toggleMore.addEventListener('click', ()=>{
    const hidden=chipsMore.hidden; chipsMore.hidden=!hidden;
    toggleMore.textContent = hidden ? (MODE==='player'?'Show fewer teams':'Show fewer leagues')
                                    : (MODE==='player'?'Show more Premier League teams':'Show more leagues');
    toggleMore.setAttribute('aria-expanded', String(!hidden));
  });

  qpAll && (qpAll.onclick=()=>{ const all=visibleCodesAll(); chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i=>i.checked=all.includes(i.value)); updatePerfBanner(); drawWheel(); });
  qpNone && (qpNone.onclick=()=>{ chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i=>i.checked=false); updatePerfBanner(); drawWheel(); });
  qpTopBtn && (qpTopBtn.onclick=()=>{
    if (MODE==='player'){ const allow=new Set(PL_TOP6); chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i=>i.checked=allow.has(i.value)); }
    else { const allow=new Set(TOP5); chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i=>i.checked=allow.has(i.value)); }
    updatePerfBanner(); drawWheel();
  });

  chipsWrap.addEventListener('change', ()=>{ if(!spinning){ selectedIdx=-1; updatePerfBanner(); drawWheel(); }});
  [optA,optB,optC,optD,optE].forEach(o=>o&&o.addEventListener('change', ()=>{ if(!spinning){ selectedIdx=-1; drawWheel(); }}));

  mClose && (mClose.onclick=closeModal);
  backdrop && backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

  // canvas sizing
  const resize=()=>{ const rect=(wheel.parentElement||wheel).getBoundingClientRect(); const size=clamp(300,Math.round(rect.width||640),1200); const DPR=Math.max(1,devicePixelRatio||1);
    wheel.width=size*DPR; wheel.height=size*DPR; wheel.style.width=size+'px'; wheel.style.height=size+'px';
    fx.width=wheel.width; fx.height=wheel.height;
    const wr=wheel.parentElement.getBoundingClientRect(); const cr=wheel.getBoundingClientRect();
    spinFab.style.left=((cr.left+cr.width/2)-wr.left)+'px'; spinFab.style.top=((cr.top+cr.height/2)-wr.top)+'px';
    drawWheel();
  };
  window.addEventListener('resize', ()=>{ clearTimeout(window.__rs); window.__rs=setTimeout(resize,120); }, {passive:true});
  resize();
}

/* Boot */
(async function init(){
  await loadTeams(); await loadPlayers();
  setMode(MODE); renderChips(); renderHistory(); wire();

  // Start with “Free spin” defaults but keep current MODE
  applyPreset('free-spin');
})();
