// HOR breach-reason flow mocks — two views:
//  1) hor_crew_gate.svg  — crew submission: cannot "Send for sign-off" until every
//     breach day has a reason (the gate lives here, not at the Captain).
//  2) hor_master.svg     — Captain approval: reasons already present, breaches
//     described in full (figures, not just "Daily"), decision = Approve / Send back.
// Pure SVG, editorial (Cargo) palette.
import { writeFileSync } from 'node:fs';

const NAVY='#1C1B3A', TERRA='#C65A1A', TERRA_T='#B14E16', MUT='#8B8478', FAINT='#AEB4C2', INK2='#4B4A66';
const HAIR='#ECEAE3', HAIR2='#F0F1F5', LINE='#E6E8EF';
const GREEN='#3F7A52';
const WARN_BG='#FBF1E3', BREACH_BG='#FBE3DA';
const PAGE='#F8FAFC', CARD='#FFFFFF', FIELD='#FAFAF8';
const SERIF="'DM Serif Display','DM Serif Text',Georgia,serif";
const SANS="'Inter','Plus Jakarta Sans',system-ui,sans-serif";
const W=920;
const esc=(s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function txt(x,y,s,{size=14,fill=NAVY,weight=400,family=SANS,anchor='start',spacing,italic}={}){
  const a=[`x="${x}"`,`y="${y}"`,`font-size="${size}"`,`fill="${fill}"`,`font-weight="${weight}"`,`font-family="${family}"`,`text-anchor="${anchor}"`];
  if(spacing)a.push(`letter-spacing="${spacing}"`); if(italic)a.push(`font-style="italic"`);
  return `<text ${a.join(' ')}>${esc(s)}</text>`;
}
const rect=(x,y,w,h,{fill='none',stroke,sw=1,rx=0,dash}={})=>{const a=[`x="${x}"`,`y="${y}"`,`width="${w}"`,`height="${h}"`,`rx="${rx}"`,`fill="${fill}"`];if(stroke){a.push(`stroke="${stroke}"`,`stroke-width="${sw}"`);}if(dash)a.push(`stroke-dasharray="${dash}"`);return `<rect ${a.join(' ')}/>`;};
const line=(x1,y1,x2,y2,c=LINE,w=1)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`;
const dot=(cx,cy,r,fill)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const check=(x,y,c)=>`<path d="M ${x} ${y} l 4 4 l 8 -9" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const wd=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const wdOf=(d)=> wd[(new Date(2026,4,d).getDay()+6)%7];
function chip(x,y,label,{bg='#EFEDEA',stroke='#E2DFD7',tc=NAVY}={}){ const w=label.length*5.9+22; return {svg:rect(x,y-13,w,22,{fill:bg,stroke,rx:11})+txt(x+w/2,y+3,label,{size:10.5,weight:600,fill:tc,anchor:'middle'}),w}; }
function frame(h){ return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="${SANS}">`+rect(0,0,W,h,{fill:PAGE})+rect(20,20,W-40,h-40,{fill:CARD,stroke:HAIR,rx:14}); }

// breach descriptors — figures, so the breach explains itself
const BREACHES=[
  {d:7,  rules:[['Daily rest 9h · 10h min']],                          reason:'Guest trip — extended service'},
  {d:16, rules:[['Daily rest 9h · 10h min'],['7-day rest 71h · 77h min']], reason:'Charter operations'},
  {d:25, rules:[['Daily rest 9h · 10h min']],                          reason:null}, // crew: not yet entered
];

/* ───────── 1 · CREW SUBMISSION GATE ───────── */
{
  let s=''; let y=62;
  s+=txt(48,y,'BEFORE YOU SEND',{size:10,weight:700,spacing:1.6,fill:TERRA});
  s+=txt(48,y+30,'Sign off May 2026',{size:22,family:SERIF,fill:NAVY}); y+=30;
  s+=txt(48,y+24,'Each breach day needs a reason before this can go to the Captain for sign-off.',{size:12.5,fill:MUT}); y+=24;
  // gate banner
  y+=24; s+=rect(40,y-20,840,40,{fill:'#FCEFE9',rx:10});
  s+=`<circle cx="64" cy="${y}" r="9" fill="none" stroke="${TERRA}" stroke-width="1.6"/>`+txt(64,y+4,'!',{size:12,weight:700,fill:TERRA,anchor:'middle'});
  s+=txt(82,y+4,'2 of 3 breach days still need a reason.',{size:13,weight:600,fill:TERRA_T});
  y+=44;
  // breach rows, each with a reason field
  for(const b of BREACHES){
    const filled=!!b.reason;
    s+=line(48,y,872,y,HAIR2); y+=30;
    s+=dot(56,y-4,4.5,TERRA);
    s+=txt(72,y,`${wdOf(b.d)} ${b.d} May 2026`,{size:14,weight:600,fill:NAVY});
    let cx=220; for(const r of b.rules){ const c=chip(cx,y,r[0]); s+=c.svg; cx+=c.w+8; }
    y+=34;
    // reason field
    if(filled){
      s+=rect(72,y-18,720,34,{fill:FIELD,stroke:'#E5E7EB',rx:9});
      s+=txt(86,y+3,b.reason,{size:12.5,fill:NAVY});
      s+=check(812,y-3,GREEN)+txt(848,y+3,'Added',{size:11.5,weight:600,fill:GREEN,anchor:'end'});
    } else {
      s+=rect(72,y-18,720,34,{fill:'#fff',stroke:TERRA,sw:1.4,rx:9});
      s+=txt(86,y+3,'Add a reason…  (e.g. Charter operations)',{size:12.5,fill:FAINT,italic:true});
      s+=txt(848,y+3,'Required',{size:11.5,weight:700,fill:TERRA,anchor:'end'});
    }
    y+=30;
  }
  s+=line(48,y,872,y,HAIR2); y+=40;
  // disabled send + progress
  s+=rect(48,y-22,200,38,{fill:'#EDEBE4',rx:10}); s+=txt(148,y+3,'Send for sign-off',{size:13.5,weight:600,fill:'#9A958A',anchor:'middle'});
  s+=txt(264,y+3,'Locked — 1 of 3 reasons added',{size:12,fill:MUT});
  y+=44; s+=txt(48,y,'CREW · the gate lives here. The submission is blocked until every breach has a reason.',{size:12,fill:INK2});
  const h=y+20; writeFileSync('/tmp/hor_crew_gate.svg', frame(h)+s+'</svg>');
}

/* ───────── 2 · CAPTAIN APPROVAL ───────── */
{
  // descriptor chips — figures for every MLC rule, incl. broken rest + 14h stretch
  const descChips=(b)=>{
    const out=[];
    if(b.daily!=null)  out.push(`Daily rest ${b.daily}h · 10h min`);
    if(b.weekly!=null) out.push(`7-day rest ${b.weekly}h · 77h min`);
    if(b.periods!=null)out.push(`Broken rest · ${b.periods} blocks (max 2)`);
    if(b.longest!=null)out.push(`Broken rest · longest ${b.longest}h (need 6h)`);
    if(b.stretch!=null)out.push(`On duty ${b.stretch}h straight · 14h max`);
    return out;
  };
  // four breach days, one per rule type (+ a multi-rule day), reasons present
  const MB=[
    {d:7,  daily:9,            reason:'Guest trip — extended service'},
    {d:16, daily:9, weekly:71, reason:'Charter operations'},
    {d:25, periods:3,          reason:'Turnaround / provisioning'},   // 13h total but broken
    {d:27, stretch:16,         reason:'Drill / safety operations'},   // 11h total but 14h+ on duty
  ];
  const breachSet=new Set(MB.map(b=>b.d));

  let s=''; let y=62;
  s+=txt(48,y,'FOR APPROVAL',{size:10,weight:700,spacing:1.6,fill:TERRA});
  s+=txt(48,y+30,'Review May 2026',{size:22,family:SERIF,fill:NAVY}); y+=30;
  s+=txt(48,y+24,'Submitted by Chief Engineer on 17/06/2026 · 96% compliant · 4 breach days.',{size:12.5,fill:MUT}); y+=24;
  // heat strip — note 25 & 27 sit ABOVE the 10h line yet are still breaches
  const HOURS={1:12,2:12,3:24,4:12,5:12,6:12,7:9,8:12,9:12,10:24,11:12,12:12,13:12,14:12,15:12,16:9,17:24,18:12,19:12,20:12,21:12,22:12,23:12,24:24,25:13,26:12,27:11,28:12,29:12,30:12,31:24};
  const gx=56,gw=812,top=y+44,areaH=78,maxH=24; const bw=(gw-30*4)/31; const yFor=(h)=>top+areaH-(h/maxH)*areaH;
  for(const hh of [10,24]){ const yy=yFor(hh); s+=line(gx,yy,gx+gw,yy,hh===10?'#E7C9BC':'#EFEDE6',1); s+=txt(gx-8,yy+4,`${hh}h`,{size:9,fill:hh===10?TERRA:FAINT,anchor:'end'}); }
  for(let d=1;d<=31;d++){ const x=gx+(d-1)*(bw+4); const isB=breachSet.has(d); const fill=isB?TERRA:'#BCCFBD'; const yy=yFor(HOURS[d]); s+=rect(x,yy,bw,top+areaH-yy,{fill,rx:2}); if(!isB)s+=rect(x,yy,bw,2.5,{fill:'#6FA67E',rx:1.5}); if(isB)s+=dot(x+bw/2,top+areaH+8,2.6,TERRA); if(d%5===0||d===1)s+=txt(x+bw/2,top+areaH+22,String(d),{size:9,fill:FAINT,anchor:'middle'}); }
  y=top+areaH+44;
  s+=check(50,y-4,GREEN)+txt(70,y,'All 4 breach days have a reason.',{size:12.5,weight:600,fill:GREEN});
  s+=txt(872,y,'Approve, or Send back for changes.',{size:12,fill:MUT,anchor:'end'});
  y+=10; s+=line(48,y,872,y,HAIR2);
  for(const b of MB){
    const chips=descChips(b);
    y+=52;
    s+=dot(56,y-8,4.5,TERRA);
    s+=txt(72,y,`${wdOf(b.d)} ${b.d} May`,{size:14,weight:600,fill:NAVY});
    let cx=200; for(const c of chips){ const ch=chip(cx,y-8,c); s+=ch.svg; cx+=ch.w+8; }
    s+=txt(72,y+18,`Reason — ${b.reason}`,{size:12,fill:MUT,italic:true});
    s+=line(48,y+28,872,y+28,HAIR2);
  }
  y+=56; s+=txt(48,y,'CAPTAIN · every MLC rule reads in full — incl. broken rest & 14h stretch, which can breach even when daily',{size:12,fill:INK2});
  y+=18; s+=txt(48,y,'hours look fine (25th & 27th sit above the 10h line but are still flagged). Decision is sign-off only.',{size:12,fill:INK2});
  const h=y+20; writeFileSync('/tmp/hor_master.svg', frame(h)+s+'</svg>');
}
console.log('wrote /tmp/hor_crew_gate.svg, /tmp/hor_master.svg');
