// Three fresh ways to present the HOR crew ROSTER (the per-person list with
// Remind / Review & approve). Editorial (Cargo) palette + type. Pure SVG.
// Output: /tmp/roster_R1|R2|R3.svg
import { writeFileSync } from 'node:fs';

const NAVY='#1C1B3A', TERRA='#C65A1A', TERRA_T='#B14E16', MUT='#8B8478', FAINT='#AEB4C2', INK2='#4B4A66';
const HAIR='#ECEAE3', HAIR2='#F0F1F5', LINE='#E6E8EF';
const GREEN='#3F7A52', GREEN_D='#5C9B6A', GREEN_T='#EAF2EC', INDIGO='#4A4AB0', INDIGO_D='#6C6CCF', INDIGO_T='#ECECF8';
const PAGE='#F8FAFC', CARD='#FFFFFF', FIELD='#FAFAF8', PILL='#FBEFE9';
const SERIF="'DM Serif Display','DM Serif Text',Georgia,serif";
const SANS="'Inter','Plus Jakarta Sans',system-ui,sans-serif";
const W=1080, P=40, RIGHT=W-P;
const esc=(s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function txt(x,y,s,{size=14,fill=NAVY,weight=400,family=SANS,anchor='start',spacing,italic}={}){
  const a=[`x="${x}"`,`y="${y}"`,`font-size="${size}"`,`fill="${fill}"`,`font-weight="${weight}"`,`font-family="${family}"`,`text-anchor="${anchor}"`];
  if(spacing)a.push(`letter-spacing="${spacing}"`); if(italic)a.push(`font-style="italic"`);
  return `<text ${a.join(' ')}>${esc(s)}</text>`;
}
const rect=(x,y,w,h,{fill='none',stroke,sw=1,rx=0}={})=>{const a=[`x="${x}"`,`y="${y}"`,`width="${w}"`,`height="${h}"`,`rx="${rx}"`,`fill="${fill}"`];if(stroke){a.push(`stroke="${stroke}"`,`stroke-width="${sw}"`);}return `<rect ${a.join(' ')}/>`;};
const line=(x1,y1,x2,y2,c=LINE,w=1)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`;
const dot=(cx,cy,r,fill)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const initials=(n)=>n.split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();

function btn(xRight,cy,label,kind){
  const bw=label.length*7+(kind==='primary'?28:24); const x=xRight-bw;
  let s;
  if(kind==='primary'){ s=rect(x,cy-15,bw,30,{fill:TERRA,rx:8})+txt(x+bw/2,cy+4,label,{size:13,weight:600,fill:'#fff',anchor:'middle'}); }
  else { s=rect(x,cy-15,bw,30,{fill:'#fff',stroke:'#E5E7EB',rx:8})+txt(x+bw/2,cy+4,label,{size:13,weight:600,fill:NAVY,anchor:'middle'}); }
  return s;
}
function remindedTag(xRight,cy){ const lab='Reminded'; const wpx=lab.length*7+22; return `<path d="M ${xRight-wpx} ${cy} l 4 4 l 7 -8" fill="none" stroke="${GREEN_D}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`+txt(xRight,cy+4,lab,{size:12.5,weight:600,fill:GREEN_D,anchor:'end'}); }

// crew data — 4 needing action, 6 confirmed
const CREW=[
  {name:'Chief Engineer', role:'Head of House', dept:'Interior', st:'submitted', logged:31, unlogged:0},
  {name:'Claire Dubois', role:'Chief Stewardess', dept:'Interior', st:'open', logged:12, unlogged:19},
  {name:'Marco Rossi', role:'Second Steward/ess', dept:'Interior', st:'open', logged:12, unlogged:19},
  {name:'Lauren Moody', role:'Captain', dept:'Bridge', st:'open', logged:19, unlogged:12},
  {name:'Emma Larsen', role:'Third Steward/ess', dept:'Interior', st:'confirmed', logged:31, unlogged:0},
  {name:'Sophie van Dijk', role:'Laundry Stewardess', dept:'Interior', st:'confirmed', logged:31, unlogged:0},
  {name:'James Taylor', role:'Bosun', dept:'Deck', st:'confirmed', logged:31, unlogged:0},
  {name:'Tom Bennett', role:'Deckhand', dept:'Deck', st:'confirmed', logged:31, unlogged:0},
  {name:'Anders Lindqvist', role:'Head Chef', dept:'Galley', st:'confirmed', logged:31, unlogged:0},
  {name:'Sara Nilsson', role:'Chief Stewardess', dept:'Interior', st:'confirmed', logged:31, unlogged:0},
];
const DAYS=31;
const STMETA={ open:{label:'Not started',c:TERRA_T,dot:TERRA,tint:PILL}, submitted:{label:'Awaiting approval',c:INDIGO,dot:INDIGO_D,tint:INDIGO_T}, confirmed:{label:'Confirmed',c:GREEN,dot:GREEN_D,tint:GREEN_T} };

function header(title,sub){
  let s=''; let y=54;
  s+=dot(P+3,y-4,3,TERRA)+txt(P+14,y,'HOURS OF REST',{size:10,weight:700,spacing:1.6,fill:TERRA});
  s+=txt(RIGHT,y,'MAY 2026 · SIGN-OFF ROSTER',{size:10,weight:700,spacing:1.4,fill:MUT,anchor:'end'});
  y=100; s+=txt(P,y,title,{size:26,family:SERIF,fill:NAVY});
  y=126; s+=txt(P,y,sub,{size:13,fill:INK2});
  y=150; s+=txt(P,y,'9 of 10 signed off · 1 awaiting approval',{size:12,fill:MUT});
  return s;
}
function sectionLabel(y,label,withRemindAll){
  let s=txt(P,y,label,{size:10,weight:700,spacing:1.5,fill:MUT});
  if(withRemindAll){ const b='Send reminders to all (3)'; const bw=b.length*6.8+34; s+=rect(RIGHT-bw,y-17,bw,28,{fill:TERRA,rx:8})+`<path d="M ${RIGHT-bw+16} ${y-8} a 4 4 0 0 1 8 0 c 0 4 1 5 2 6 h -12 c 1 -1 2 -2 2 -6 z" fill="#fff"/>`+txt(RIGHT-bw/2+8,y+2,b,{size:12.5,weight:600,fill:'#fff',anchor:'middle'}); }
  return s;
}
function wrap(inner,h){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="${SANS}">`
    +rect(0,0,W,h,{fill:PAGE})+rect(20,20,W-40,h-40,{fill:CARD,stroke:HAIR,rx:16})+inner+`</svg>`;
}

/* ─────────── R1 · LEDGER — columnar table with a “logged this month” bar ─────────── */
{
  let s=header('R1 · Ledger — coverage at a glance',
    'A scannable table. A “logged this month” bar per crew shows who’s actually behind, not just who hasn’t signed.');
  const cLog=560, cLogW=130, cStatus=820, cAction=RIGHT;
  let y=196;
  // column header row
  s+=txt(P+24,y,'CREW',{size:10,weight:700,spacing:1.2,fill:FAINT});
  s+=txt(cLog,y,'LOGGED THIS MONTH',{size:10,weight:700,spacing:1.2,fill:FAINT});
  s+=txt(cStatus,y,'STATUS',{size:10,weight:700,spacing:1.2,fill:FAINT,anchor:'end'});
  s+=line(P,y+12,RIGHT,y+12,LINE);
  const row=(c,yy)=>{
    const m=STMETA[c.st]; let r='';
    r+=dot(P+6,yy,4.5,m.dot);
    r+=txt(P+24,yy+4,c.name,{size:14.5,weight:600,fill:c.st==='confirmed'?'#3a3950':NAVY});
    r+=txt(P+24,yy+21,`${c.role} · ${c.dept}`,{size:11.5,fill:MUT});
    // logged bar
    const bx=cLog, bw=cLogW; const pct=c.logged/DAYS;
    const barC = c.st==='confirmed'?GREEN_D : (pct<0.6?TERRA:MUT);
    r+=rect(bx,yy-3,bw,6,{fill:'#EFEDE6',rx:3})+rect(bx,yy-3,Math.max(4,bw*pct),6,{fill:barC,rx:3});
    r+=txt(bx+bw+12,yy+4,`${c.logged}/${DAYS}`,{size:11.5,weight:600,fill:MUT});
    // status
    r+=txt(cStatus,yy+4,m.label,{size:12.5,weight:600,fill:m.c,anchor:'end'});
    // action
    if(c.st==='open') r+=btn(cAction,yy,'Remind','ghost');
    else if(c.st==='submitted') r+=btn(cAction,yy,'Review & approve','primary');
    return r;
  };
  y+=22;
  // needs action (4) then confirmed (6), with a quiet sub-rule between
  const order=[...CREW];
  let first=true;
  for(let i=0;i<order.length;i++){
    const c=order[i]; y+=46;
    if(i===4){ // divider into confirmed block
      s+=txt(P+24,y-6,'SIGNED OFF',{size:9.5,weight:700,spacing:1.4,fill:FAINT}); y+=22;
    }
    s+=row(c,y);
    s+=line(P,y+22,RIGHT,y+22,HAIR2);
  }
  let fy=y+58;
  s+=txt(P,fy,'The hook',{size:10,weight:700,spacing:1.2,fill:MUT}); fy+=22;
  s+=txt(P,fy,'• The logged bar surfaces who’s genuinely behind (Claire/Marco at 12/31) vs. just unsigned.',{size:13,fill:INK2}); fy+=22;
  s+=txt(P,fy,'• Reads like a register — fast to scan top-to-bottom; action lives in one right-hand column.',{size:13,fill:INK2});
  writeFileSync('/tmp/roster_R1.svg',wrap(s,fy+40));
}

/* ─────────── R2 · INITIALS + PILLS — warmer, status as a rounded pill ─────────── */
{
  let s=header('R2 · Initials & status pills — human and warm',
    'A tinted initials disc carries the status colour; the status itself is a rounded pill. Less ledger, more crew.');
  let y=190;
  s+=sectionLabel(y,'NEEDS ACTION',true); y+=12;
  const row=(c,yy)=>{
    const m=STMETA[c.st]; let r='';
    // initials disc tinted by status
    r+=`<circle cx="${P+19}" cy="${yy+2}" r="19" fill="${m.tint}"/>`;
    r+=txt(P+19,yy+7,initials(c.name),{size:13,weight:700,fill:m.c,anchor:'middle'});
    r+=txt(P+50,yy-2,c.name,{size:14.5,weight:600,fill:NAVY});
    r+=txt(P+50,yy+16,`${c.role} · ${c.dept}`,{size:11.5,fill:MUT});
    // status pill (filled for confirmed/awaiting, soft outline for not started)
    const lab=m.label; const pw=lab.length*6.6+26; const px=RIGHT-200-pw;
    if(c.st==='confirmed'){ r+=rect(px,yy-11,pw,24,{fill:GREEN_T,rx:12})+`<path d="M ${px+12} ${yy+1} l 4 4 l 7 -8" fill="none" stroke="${GREEN}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`+txt(px+26,yy+5,lab,{size:11.5,weight:600,fill:GREEN}); }
    else if(c.st==='submitted'){ r+=rect(px,yy-11,pw,24,{fill:INDIGO_T,rx:12})+dot(px+14,yy+1,4,INDIGO_D)+txt(px+26,yy+5,lab,{size:11.5,weight:600,fill:INDIGO}); }
    else { r+=rect(px,yy-11,pw,24,{fill:'#fff',stroke:'#EAD9CD',rx:12})+dot(px+14,yy+1,4,TERRA)+txt(px+26,yy+5,lab,{size:11.5,weight:600,fill:TERRA_T});
           r+=txt(RIGHT-200,yy+5,`${c.unlogged}d unlogged`,{size:10.5,fill:FAINT,italic:true,anchor:'end'}); }
    // action
    if(c.st==='open') r+=btn(RIGHT,yy,'Remind','ghost');
    else if(c.st==='submitted') r+=btn(RIGHT,yy,'Review & approve','primary');
    return r;
  };
  for(const c of CREW.slice(0,4)){ y+=50; s+=row(c,y); s+=line(P+50,y+24,RIGHT,y+24,HAIR2); }
  y+=46; s+=txt(P,y,'COMPLETE',{size:10,weight:700,spacing:1.5,fill:MUT});
  for(const c of CREW.slice(4)){ y+=50; s+=row(c,y); s+=line(P+50,y+24,RIGHT,y+24,HAIR2); }
  let fy=y+58;
  s+=txt(P,fy,'The hook',{size:10,weight:700,spacing:1.2,fill:MUT}); fy+=22;
  s+=txt(P,fy,'• Status reads instantly from colour — disc + pill — without parsing text.',{size:13,fill:INK2}); fy+=22;
  s+=txt(P,fy,'• Warmer / more “crew” than a ledger; the pill language stays editorial (rounded, tinted, no badges).',{size:13,fill:INK2});
  writeFileSync('/tmp/roster_R2.svg',wrap(s,fy+40));
}

/* ─────────── R3 · BY DEPARTMENT — grouped the way sign-off actually flows ─────────── */
{
  let s=header('R3 · By department — grouped for the HoD',
    'Crew sit under their department (the unit a HoD signs off). Each group shows its own done/total.');
  const depts=['Bridge','Deck','Interior','Galley'];
  let y=188;
  const row=(c,yy)=>{
    const m=STMETA[c.st]; let r='';
    r+=dot(P+22,yy,4.5,m.dot);
    r+=txt(P+40,yy+4,c.name,{size:14,weight:600,fill:NAVY});
    r+=txt(P+40,yy+20,c.role,{size:11,fill:MUT});
    r+=txt(820,yy+4,m.label,{size:12.5,weight:600,fill:m.c,anchor:'end'});
    if(c.st==='open'){ r+=txt(820,yy+20,`${c.unlogged} days unlogged`,{size:10.5,fill:FAINT,italic:true,anchor:'end'}); r+=btn(RIGHT,yy,'Remind','ghost'); }
    else if(c.st==='submitted') r+=btn(RIGHT,yy,'Review & approve','primary');
    return r;
  };
  for(const d of depts){
    const members=CREW.filter(c=>c.dept===d);
    const done=members.filter(c=>c.st==='confirmed').length;
    y+=40;
    s+=txt(P,y,d.toUpperCase(),{size:10,weight:700,spacing:1.5,fill:done===members.length?MUT:TERRA});
    s+=line(P+d.length*8+20,y-4,RIGHT-70,y-4,LINE);
    s+=txt(RIGHT,y,`${done}/${members.length} signed`,{size:10,weight:600,spacing:0.5,fill:MUT,anchor:'end'});
    for(const c of members){ y+=44; s+=row(c,y); s+=line(P+18,y+20,RIGHT,y+20,HAIR2); }
    y+=8;
  }
  let fy=y+44;
  s+=txt(P,fy,'The hook',{size:10,weight:700,spacing:1.2,fill:MUT}); fy+=22;
  s+=txt(P,fy,'• Mirrors how sign-off delegates — a HoD clears their own department; the Captain sees all.',{size:13,fill:INK2}); fy+=22;
  s+=txt(P,fy,'• Per-group done/total shows exactly which department is holding up the close.',{size:13,fill:INK2});
  writeFileSync('/tmp/roster_R3.svg',wrap(s,fy+40));
}

/* ─────── R1d · LEDGER, grouped: status blocks → departments inside ───────────
   Top split by status (Awaiting approval / Not started / Confirmed). Within each
   block, crew are grouped under their department. The per-row status text is
   dropped (the block header carries it); the dot keeps the colour. ───────────── */
{
  let s=header('R1 · Ledger — by status, then department',
    'Three status blocks; inside each, crew group under their department. The “logged” bar still flags who’s behind.');
  const cLog=560, cLogW=130, cAction=RIGHT;
  const DEPT_RANK={Bridge:0,Deck:1,Engineering:2,Interior:3,Galley:4};
  const deptSort=(a,b)=>(DEPT_RANK[a]??9)-(DEPT_RANK[b]??9);

  // column header
  let y=198;
  s+=txt(P+24,y,'CREW',{size:10,weight:700,spacing:1.2,fill:FAINT});
  s+=txt(cLog,y,'LOGGED THIS MONTH',{size:10,weight:700,spacing:1.2,fill:FAINT});
  s+=line(P,y+12,RIGHT,y+12,LINE);
  y+=12;

  const row=(c,yy)=>{
    const m=STMETA[c.st]; let r='';
    r+=dot(P+6,yy,4.5,m.dot);
    r+=txt(P+24,yy+4,c.name,{size:14.5,weight:600,fill:c.st==='confirmed'?'#3a3950':NAVY});
    r+=txt(P+24,yy+21,c.role,{size:11.5,fill:MUT});
    const bx=cLog,bw=cLogW,pct=c.logged/DAYS;
    const barC=c.st==='confirmed'?GREEN_D:(pct<0.6?TERRA:MUT);
    r+=rect(bx,yy-3,bw,6,{fill:'#EFEDE6',rx:3})+rect(bx,yy-3,Math.max(4,bw*pct),6,{fill:barC,rx:3});
    r+=txt(bx+bw+12,yy+4,`${c.logged}/${DAYS}`,{size:11.5,weight:600,fill:MUT});
    if(c.st==='open'){ r+=txt(cLog-30,yy+4,`${c.unlogged}d unlogged`,{size:10.5,fill:FAINT,italic:true,anchor:'end'}); r+=btn(cAction,yy,'Remind','ghost'); }
    else if(c.st==='submitted') r+=btn(cAction,yy,'Review & approve','primary');
    else { r+=`<path d="M ${cAction-20} ${yy} l 4 4 l 8 -9" fill="none" stroke="${GREEN_D}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`+txt(cAction,yy+4,'',{}); }
    return r;
  };

  const blocks=[
    {st:'submitted', label:'AWAITING APPROVAL', remindAll:false},
    {st:'open',      label:'NOT STARTED',       remindAll:true},
    {st:'confirmed', label:'CONFIRMED',         remindAll:false},
  ];
  for(const b of blocks){
    const members=CREW.filter(c=>c.st===b.st);
    if(!members.length) continue;
    const m=STMETA[b.st];
    y+=42;
    // status block header — coloured tracked-caps + count, hairline, optional remind-all
    s+=dot(P+6,y-4,4,m.dot);
    s+=txt(P+22,y,`${b.label} · ${members.length}`,{size:11,weight:700,spacing:1.4,fill:m.c});
    if(b.remindAll){ const t='Send reminders to all ('+members.length+')'; const bw=t.length*6.6+30; s+=rect(RIGHT-bw,y-16,bw,26,{fill:TERRA,rx:8})+txt(RIGHT-bw/2,y+2,t,{size:12,weight:600,fill:'#fff',anchor:'middle'}); }
    s+=line(P,y+12,RIGHT,y+12,'#EDEBE4');
    // departments inside
    const depts=[...new Set(members.map(c=>c.dept))].sort(deptSort);
    for(const d of depts){
      y+=30;
      s+=txt(P+24,y,d.toUpperCase(),{size:9.5,weight:700,spacing:1.4,fill:FAINT});
      for(const c of members.filter(c=>c.dept===d)){ y+=42; s+=row(c,y); s+=line(P+18,y+21,RIGHT,y+21,HAIR2); }
    }
  }
  let fy=y+56;
  s+=txt(P,fy,'The structure',{size:10,weight:700,spacing:1.2,fill:MUT}); fy+=22;
  s+=txt(P,fy,'• Status answers “what needs doing”; department answers “whose” — the two levels you sort by.',{size:13,fill:INK2}); fy+=22;
  s+=txt(P,fy,'• Per-row status text drops out (the block says it); the coloured dot + logged bar still carry the detail.',{size:13,fill:INK2});
  writeFileSync('/tmp/roster_R1_dept.svg',wrap(s,fy+40));
}

console.log('wrote /tmp/roster_R1.svg, R2, R3, R1_dept');
