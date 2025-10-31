/* Football Spinner app — modes, sub-variants, wheel + modal + reveal
   Keeps your existing IDs/classes; adds mode/subbar + reveal + confetti & cheer.
*/

/* --------------------------
   DOM Helpers
---------------------------*/
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* --------------------------
   Elements
---------------------------*/
const wheelCanvas = $('#wheel');
const fxCanvas    = $('#fx');
const ctx         = wheelCanvas.getContext('2d');
const fxctx       = fxCanvas.getContext('2d');

const spinBtn  = $('#spinBtn');
const spinFab  = $('#spinFab');
const revealBtn= $('#revealBtn');

const historyEl= $('#history');
const perfTip  = $('#perfTip');

const resultCard = $('#resultCard');
const resultImg  = $('#resultImg');
const resultTitle= $('#resultTitle');
const resultSub  = $('#resultSub');

const backdrop = $('#backdrop');
const modal    = $('#modal');
const mHead    = $('#mHead');
const mSub     = $('#mSub');
const mLogo    = $('#mLogo');
const rowStadium = $('#rowStadium');
const rowClub    = $('#rowClub');
const rowJersey  = $('#rowJersey');
const rowNat     = $('#rowNat');
const mStadium = $('#mStadium');
const mClub    = $('#mClub');
const mJersey  = $('#mJersey');
const mNat     = $('#mNat');
const mClose   = $('#mClose');

const modeTeamBtn    = $('#modeTeam');
const modeStadiumBtn = $('#modeStadium');
const modePlayerBtn  = $('#modePlayer');
const modeFreeBtn    = $('#modeFree');
const subBar         = $('#subBar');

/* --------------------------
   Data (small demo set)
   You can replace these with your real datasets.
---------------------------*/
const TEAMS = [
  { name: 'Arsenal',     crest: 'public/crests/arsenal.png',  stadium:'Emirates Stadium' },
  { name: 'Barcelona',   crest: 'public/crests/barcelona.png',stadium:'Olympic Stadium' },
  { name: 'Inter',       crest: 'public/crests/inter.png',    stadium:'San Siro' },
  { name: 'Bayern',      crest: 'public/crests/bayern.png',   stadium:'Allianz Arena' },
  { name: 'PSG',         crest: 'public/crests/psg.png',      stadium:'Parc des Princes' }
];

const STADIUMS = [
  { stadium:'Emirates Stadium', team:'Arsenal',   image:'public/stadiums/emirates.jpg' },
  { stadium:'San Siro',         team:'Inter',     image:'public/stadiums/sansiro.jpg' },
  { stadium:'Allianz Arena',    team:'Bayern',    image:'public/stadiums/allianz.jpg' },
  { stadium:'Parc des Princes', team:'PSG',       image:'public/stadiums/parc.jpg' }
];

const PLAYERS = [
  { name:'Bukayo Saka', club:'Arsenal',    number:7,  nat:'England',   flag:'public/flags/gb.png',  photo:'public/players/saka.jpg',   crest:'public/crests/arsenal.png' },
  { name:'Lautaro Martínez', club:'Inter', number:10, nat:'Argentina', flag:'public/flags/ar.png',  photo:'public/players/lautaro.jpg', crest:'public/crests/inter.png'  },
  { name:'Kylian Mbappé', club:'PSG',      number:7,  nat:'France',    flag:'public/flags/fr.png',  photo:'public/players/mbappe.jpg',  crest:'public/crests/psg.png'    },
];

/* --------------------------
   Mode & Variant state
---------------------------*/
const MODES = {
  team: {
    label: 'Guess Team',
    variants: [
      { key:'team_logo',     label:'By Logo' },
      { key:'team_stadium',  label:'By Stadium (+ League)' }
    ]
  },
  stadium: {
    label: 'Guess Stadium',
    variants: [
      { key:'stadium_name',  label:'By Team Name' },
      { key:'stadium_logo',  label:'By Logo' }
    ]
  },
  player: {
    label: 'Guess Player',
    variants: [
      { key:'player_photo',  label:'By Photo' },
      { key:'player_combo',  label:'By Club + Flag + Number' }
    ]
  }
};

let currentMode = 'team';
let currentVariant = 'team_logo';

let slices = [];           // current wheel entries (strings or drawable items)
let spinning = false;
let lastResult = null;     // { item, angle, label, img?, meta? }
let animationRAF = null;

/* --------------------------
   Build top subbar
---------------------------*/
function renderSubBar() {
  subBar.innerHTML = '';
  const defs = MODES[currentMode].variants;
  defs.forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'subbtn';
    btn.textContent = v.label;
    btn.setAttribute('data-variant', v.key);
    btn.setAttribute('aria-pressed', v.key === currentVariant ? 'true' : 'false');
    btn.addEventListener('click', () => setVariant(v.key));
    subBar.appendChild(btn);
  });
}

function setMode(modeKey) {
  currentMode = modeKey;
  // default to first variant for that mode if variant not compatible
  const first = MODES[modeKey].variants[0].key;
  if (!MODES[modeKey].variants.find(v => v.key === currentVariant)) {
    currentVariant = first;
  }
  // update pressed states
  modeTeamBtn.setAttribute('aria-pressed', modeKey === 'team');
  modeStadiumBtn.setAttribute('aria-pressed', modeKey === 'stadium');
  modePlayerBtn.setAttribute('aria-pressed', modeKey === 'player');
  modeFreeBtn.setAttribute('aria-pressed', 'false');

  renderSubBar();
  rebuildWheelData();
}

function setVariant(variantKey) {
  currentVariant = variantKey;
  renderSubBar();
  rebuildWheelData();
}

/* --------------------------
   Wheel data according to variant
---------------------------*/
function rebuildWheelData() {
  // Compute slices + perf tip label
  switch (currentVariant) {
    case 'team_logo': {
      slices = TEAMS.map(t => ({ label: t.name, img: t.crest, meta: {stadium:t.stadium, type:'team'} }));
      setWheelLabels('Club crests'); break;
    }
    case 'team_stadium': {
      slices = TEAMS.map(t => ({ label: t.stadium, meta: {team:t.name, type:'team_stadium'} }));
      setWheelLabels('Stadium names'); break;
    }
    case 'stadium_name': {
      slices = STADIUMS.map(s => ({ label: s.team, meta:{stadium:s.stadium, type:'stadium_team'} }));
      setWheelLabels('Team names'); break;
    }
    case 'stadium_logo': {
      // Using crest via team match
      slices = STADIUMS.map(s => {
        const team = TEAMS.find(t => t.name === s.team);
        return { label: s.team, img: team?.crest, meta:{stadium:s.stadium, type:'stadium_logo'} };
      });
      setWheelLabels('Club crests'); break;
    }
    case 'player_photo': {
      slices = PLAYERS.map(p => ({ label: p.name, img:p.photo, meta:{club:p.club, number:p.number, nat:p.nat, flag:p.flag, crest:p.crest, type:'player_photo'} }));
      setWheelLabels('Player photos'); break;
    }
    case 'player_combo': {
      slices = PLAYERS.map(p => ({ label: `${p.club} · #${p.number}`, small:[p.crest, p.flag], meta:{name:p.name, nat:p.nat, type:'player_combo'} }));
      setWheelLabels('Club + Flag + Number'); break;
    }
    default:
      slices = [];
  }

  // update perf tip
  const n = slices.length;
  perfTip.style.setProperty('--pct', Math.min(1, n/64));
  perfTip.querySelector('.meter-text').textContent = `${n} items`;

  drawWheel(0); // reset drawing
  lastResult = null;
  revealBtn.disabled = true;
  resultCard.hidden = true;
}

/* --------------------------
   Drawing the wheel
---------------------------*/
function drawWheel(rotation = 0) {
  const { width, height } = wheelCanvas;
  ctx.clearRect(0,0,width,height);
  const R = Math.min(width, height)/2 - 6;
  const cx = width/2, cy = height/2;

  const N = Math.max(1, slices.length);
  const anglePer = (Math.PI*2)/N;

  // background
  ctx.save();
  ctx.translate(cx,cy);
  ctx.rotate(rotation);

  for (let i=0;i<N;i++){
    const start = i*anglePer;
    const end   = start+anglePer;

    // wedge fill (alternating football colors)
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,R,start,end);
    ctx.closePath();
    const even = i%2===0;
    const grad = ctx.createLinearGradient(0, -R, 0, R);
    grad.addColorStop(0, even ? '#0b2a14' : '#0a1f3a');  // deep green / deep blue
    grad.addColorStop(1, even ? '#134d2a' : '#12335a');  // brighter
    ctx.fillStyle = grad;
    ctx.fill();

    // border
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // label / image
    const item = slices[i];
    const mid = start + anglePer/2;

    ctx.save();
    ctx.rotate(mid);
    ctx.translate(R*0.68, 0);
    ctx.rotate(Math.PI/2);

    if (item.img){
      // draw image (logo/photo)
      // cached loading
      drawImageCenter(ctx, item.img, 74);
      // text under image
      ctx.fillStyle = '#eaf0fb';
      ctx.font = '700 14px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      wrapText(ctx, item.label, 0, 56, 120, 16);
    } else {
      // text only
      ctx.fillStyle = '#eaf0fb';
      ctx.font = '800 16px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      wrapText(ctx, item.label, 0, 0, 140, 18);
    }

    // optional small icons (for player_combo)
    if (item.small && item.small.length){
      ctx.translate(0, 56);
      const size = 28, gap = 6;
      const totalW = item.small.length*size + (item.small.length-1)*gap;
      let x = -totalW/2 + size/2;
      item.small.forEach(src=>{
        drawImageCenter(ctx, src, size, x, 0, 6);
        x += size + gap;
      });
    }

    ctx.restore();
  }

  // center cap
  ctx.beginPath();
  ctx.arc(0,0,26,0,Math.PI*2);
  ctx.fillStyle = '#0b1530';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(100,168,255,.55)';
  ctx.stroke();

  ctx.restore();
}

const imageCache = new Map();
function loadImage(src){
  if (!src) return Promise.resolve(null);
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise(res=>{
    const img = new Image();
    img.onload = ()=>res(img);
    img.onerror = ()=>res(null);
    img.src = src;
  });
  imageCache.set(src,p);
  return p;
}

function drawImageCenter(ctx, src, size=72, dx=0, dy=0, radius=12){
  // draw async-ish: schedule then no-op if not ready
  const draw = (img) => {
    if (!img) return;
    ctx.save();
    // rounded rect clip
    const w=size, h=size;
    roundedRectPath(ctx, dx-w/2, dy-h/2, w, h, radius);
    ctx.clip();
    ctx.drawImage(img, dx-w/2, dy-h/2, w, h);
    ctx.restore();
    // border
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    roundedRectPath(ctx, dx-size/2, dy-size/2, size, size, radius);
    ctx.stroke();
    ctx.restore();
  };

  const cached = imageCache.get(src);
  if (cached && cached.then){
    cached.then(draw);
  } else {
    loadImage(src).then(draw);
  }
}

function roundedRectPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lineH){
  const words = String(text).split(' ');
  let line = '';
  let yy = y;
  for (let i=0;i<words.length;i++){
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW){
      ctx.fillText(line, x, yy);
      line = words[i];
      yy += lineH;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, yy);
}

/* --------------------------
   Spin logic
---------------------------*/
function spin(){
  if (spinning || !slices.length) return;
  spinning = true;
  revealBtn.disabled = true;
  resultCard.hidden = true;

  // target slice
  const targetIndex = Math.floor(Math.random()*slices.length);
  const N = slices.length;
  const anglePer = (Math.PI*2)/N;
  // pointer points "up" => rotation so that mid of slice hits pointer at 0 rad
  const targetAngle = (Math.PI*2) - (targetIndex*anglePer + anglePer/2);

  const start = performance.now();
  const duration = 2800 + Math.random()*900; // ms
  const extraTurns = Math.PI*4 + Math.PI*2*Math.random(); // extra rotations

  function frame(now){
    const t = Math.min(1, (now-start)/duration);
    const ease = 1 - Math.pow(1-t, 3); // easeOutCubic
    const rot = ease*(targetAngle + extraTurns);
    drawWheel(rot);

    if (t < 1){
      animationRAF = requestAnimationFrame(frame);
    } else {
      spinning = false;
      const item = slices[targetIndex];
      lastResult = { index:targetIndex, item };
      revealBtn.disabled = false;
      addHistory(item);
      // optional subtle thump
      thump();
    }
  }
  cancelAnimationFrame(animationRAF);
  animationRAF = requestAnimationFrame(frame);
}

function addHistory(item){
  const div = document.createElement('div');
  div.className = 'item';
  const img = document.createElement('img');
  img.alt = '';
  if (item.img) img.src = item.img; else img.style.visibility='hidden';
  const span = document.createElement('span');
  span.textContent = item.label;
  div.append(img, span);
  historyEl.prepend(div);
}

function thump(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type='sine'; o.frequency.value = 140;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.18);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime+0.2);
  }catch{}
}

/* --------------------------
   Reveal + Modal
---------------------------*/
function reveal(){
  if (!lastResult) return;
  const { item } = lastResult;

  // Fill the small result card under the wheel
  resultImg.src = item.img || '';
  resultImg.style.visibility = item.img ? 'visible':'hidden';
  resultTitle.textContent = item.label;

  // context-dependent subtitle
  let sub = '';
  switch (currentVariant){
    case 'team_logo': sub = item.meta?.stadium ? `Stadium: ${item.meta.stadium}` : ''; break;
    case 'team_stadium': sub = item.meta?.team ? `Team: ${item.meta.team}` : ''; break;
    case 'stadium_name': sub = item.meta?.stadium ? `Stadium: ${item.meta.stadium}` : ''; break;
    case 'stadium_logo': sub = item.meta?.stadium ? `Stadium: ${item.meta.stadium}` : ''; break;
    case 'player_photo': sub = `${item.meta?.club ?? ''} · #${item.meta?.number ?? ''} · ${item.meta?.nat ?? ''}`; break;
    case 'player_combo': sub = `${item.meta?.name ?? ''} · ${item.meta?.nat ?? ''}`; break;
  }
  resultSub.textContent = sub.trim();
  resultCard.hidden = false;

  // Show modal with richer info (FIX: ensure visible)
  showModalFor(item);

  // Effects
  confetti();
  cheer();
}

function showModalFor(item){
  // Header + sub
  mHead.textContent = item.label;
  mSub.textContent = MODES[currentMode].label;

  // Image
  if (item.img){ mLogo.src = item.img; mLogo.style.display='block'; }
  else { mLogo.removeAttribute('src'); mLogo.style.display='none'; }

  // Rows visibility
  rowStadium.style.display = 'none';
  rowClub.style.display    = 'none';
  rowJersey.style.display  = 'none';
  rowNat.style.display     = 'none';

  switch (currentVariant){
    case 'team_logo':
      if (item.meta?.stadium){ rowStadium.style.display='flex'; mStadium.textContent=item.meta.stadium; }
      break;
    case 'team_stadium':
      if (item.meta?.team){ rowClub.style.display='flex'; mClub.textContent=item.meta.team; }
      break;
    case 'stadium_name':
    case 'stadium_logo':
      if (item.meta?.stadium){ rowStadium.style.display='flex'; mStadium.textContent=item.meta.stadium; }
      break;
    case 'player_photo':
      if (item.meta?.club){ rowClub.style.display='flex'; mClub.textContent=item.meta.club; }
      if (item.meta?.number!=null){ rowJersey.style.display='flex'; mJersey.textContent = `#${item.meta.number}`; }
      if (item.meta?.nat){ rowNat.style.display='flex'; mNat.textContent = item.meta.nat; }
      break;
    case 'player_combo':
      if (item.meta?.name){ mHead.textContent = item.meta.name; }
      if (item.meta?.name){ rowClub.style.display='flex'; mClub.textContent = item.label.split(' · ')[0]; }
      if (item.meta?.nat){ rowNat.style.display='flex'; mNat.textContent = item.meta.nat; }
      break;
  }

  // VISIBILITY FIX: use hidden attr on #backdrop
  backdrop.hidden = false;
  // animate modal
  requestAnimationFrame(()=> modal.classList.add('show'));
}

mClose.addEventListener('click', closeModal);
backdrop.addEventListener('click', (e)=>{
  if (e.target === backdrop) closeModal();
});
function closeModal(){
  modal.classList.remove('show');
  setTimeout(()=>{ backdrop.hidden = true; }, 160);
}

/* --------------------------
   FX: Confetti + Cheer
---------------------------*/
function confetti(){
  const W = fxCanvas.width, H = fxCanvas.height;
  const pieces = 90;
  const particles = [];
  for(let i=0;i<pieces;i++){
    particles.push({
      x: W/2, y: H*0.2,
      vx: (Math.random()-0.5)*6,
      vy: 2+Math.random()*3,
      g: 0.12 + Math.random()*0.06,
      life: 60+Math.random()*40,
      hue: Math.random()<0.33?120:(Math.random()<0.5?210:45) // green/blue/gold
    });
  }

  let frame = 0;
  function tick(){
    fxctx.clearRect(0,0,W,H);
    particles.forEach(p=>{
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.life--;
      fxctx.save();
      fxctx.translate(p.x,p.y);
      fxctx.rotate(p.x*0.05);
      fxctx.fillStyle = `hsl(${p.hue} 80% 60%)`;
      fxctx.fillRect(-2,-4,4,8);
      fxctx.restore();
    });
    particles.filter(p=>p.life>0);
    frame++;
    if (frame < 80) requestAnimationFrame(tick);
    else fxctx.clearRect(0,0,W,H);
  }
  tick();
}

function cheer(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const noise = ctx.createBuffer(1, ctx.sampleRate*1.1, ctx.sampleRate);
    const data = noise.getChannelData(0);
    // pinkish crowd noise
    for (let i=0;i<data.length;i++){
      data[i] = (Math.random()*2-1) * (1 - i/data.length) * 0.3;
    }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const gain = ctx.createGain(); gain.gain.value = 0.35;
    src.connect(gain).connect(ctx.destination);
    src.start(0);
  }catch{}
}

/* --------------------------
   Hook up buttons
---------------------------*/
spinBtn.addEventListener('click', spin);
spinFab.addEventListener('click', spin);
revealBtn.addEventListener('click', reveal);

// Top modes
modeTeamBtn.addEventListener('click', ()=> setMode('team'));
modeStadiumBtn.addEventListener('click', ()=> setMode('stadium'));
modePlayerBtn.addEventListener('click', ()=> setMode('player'));
modeFreeBtn.addEventListener('click', ()=>{
  // "Free Spin" = spin with whatever slices are currently built
  modeTeamBtn.setAttribute('aria-pressed','false');
  modeStadiumBtn.setAttribute('aria-pressed','false');
  modePlayerBtn.setAttribute('aria-pressed','false');
  modeFreeBtn.setAttribute('aria-pressed','true');
  // do not change variant/slices; just spin
  spin();
});

/* --------------------------
   Init
---------------------------*/
function setWheelLabels(desc){
  $('#wheel-title').textContent = `Wheel — ${desc}`;
}
function resizeCanvas(){
  // keep square, adapt DPR
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  const display = Math.min(820, wheelCanvas.clientWidth || 640);
  wheelCanvas.width = display * DPR;
  wheelCanvas.height= display * DPR;
  fxCanvas.width = wheelCanvas.width;
  fxCanvas.height= wheelCanvas.height;
  wheelCanvas.style.maxWidth = '820px';
  wheelCanvas.style.width = '100%';
  drawWheel(0);
}
window.addEventListener('resize', resizeCanvas);

// modal start state — ensure hidden attribute is respected
backdrop.hidden = true;

// initial mode
setMode('team'); // also builds subbar & slices
resizeCanvas();
drawWheel(0);
