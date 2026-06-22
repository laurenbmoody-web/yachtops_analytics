// Three redesign directions for the HOR approval calendar ("Review May 2026").
// Addresses: disliked cream card bg, hard-to-read flat 16-wide grid, and the
// confusing "2026-05-07 · 9h rest" tooltip. Pure SVG. Editorial (Cargo) palette.
// Output: /tmp/cal_C1|C2|C3.svg
import { writeFileSync } from 'node:fs';

const NAVY='#1C1B3A', TERRA='#C65A1A', MUT='#8B8478', FAINT='#AEB4C2', INK2='#4B4A66';
const HAIR='#ECEAE3', HAIR2='#F0F1F5', LINE='#E6E8EF';
const GREEN='#3F7A52', AMBER='#B98A2E';
const COMP_BG='#F4F3EE', WARN_BG='#FBF1E3', BREACH_BG='#FBE3DA';
const PAGE='#F8FAFC', CARD='#FFFFFF';
const SERIF="'DM Serif Display','DM Serif Text',Georgia,serif";
const SANS="'Inter','Plus Jakarta Sans',system-ui,sans-serif";
const W=920;
const esc=(s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function txt(x,y,s,{size=14,fill=NAVY,weight=400,family=SANS,anchor='start',spacing,italic}={}){
  const a=[`x="${x}"`,`y="${y}"`,`font-size="${size}"`,`fill="${fill}"`,`font-weight="${weight}"`,`font-family="${family}"`,`text-anchor="${anchor}"`];
  if(spacing)a.push(`letter-spacing="${spacing}"`); if(italic)a.push(`font-style="italic"`);
  return `<text ${a.join(' ')}>${esc(s)}</text>`;
}
const rect=(x,y,w,h,{fill='none',stroke,sw=1,rx=0}={})=>{const a=[`x="${x}"`,`y="${y}"`,`width="${w}"`,`height="${h}"`,`rx="${rx}"`,`fill="${fill}"`];if(stroke){a.push(`stroke="${stroke}"`,`stroke-width="${sw}"`);}return `<rect ${a.join(' ')}/>`;};
const line=(x1,y1,x2,y2,c=LINE,w=1,dash)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"${dash?` stroke-dasharray="${dash}"`:''}/>`;
const dot=(cx,cy,r,fill)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;

// ── data: May 2026 rest hours per day ──────────────────────────────────────
const HOURS={1:12,2:12,3:24,4:12,5:12,6:12,7:9,8:12,9:12,10:24,11:12,12:12,13:10,14:12,15:12,16:9,17:24,18:12,19:12,20:12,21:12,22:12,23:12,24:24,25:9,26:12,27:12,28:12,29:12,30:12,31:24};
const REASON={7:'guest ops',16:'guest ops',25:'guest ops'};
const stOf=(h)=> h<10?'breach' : h<11?'warning':'compliant';
const DAYS=31, YEAR=2026, MON=4; // May = month index 4
const WD=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const monShort=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const firstCol=(new Date(YEAR,MON,1).getDay()+6)%7; // Mon-start offset
const wdOf=(d)=> WD[(new Date(YEAR,MON,d).getDay()+6)%7];

function shell(extraH){
  const h=150+extraH;
  let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="${SANS}">`;
  s+=rect(0,0,W,h,{fill:PAGE});
  s+=rect(20,20,W-40,h-40,{fill:CARD,stroke:HAIR,rx:14}); // clean WHITE card (was cream #FBFAF8)
  s+=txt(48,62,'FOR APPROVAL',{size:10,weight:700,spacing:1.6,fill:TERRA});
  s+=txt(48,92,'Review May 2026',{size:22,family:SERIF,fill:NAVY});
  s+=txt(48,118,'Submitted by Chief Engineer on 17/06/2026  ·  90% compliant  ·  3 breach days.',{size:12.5,fill:MUT});
  return {s,h};
}
function legend(x,y){
  let s=''; const items=[['Compliant',COMP_BG,NAVY],['Marginal',WARN_BG,AMBER],['Breach',BREACH_BG,TERRA]];
  for(const [lab,bg,tc] of items){ s+=rect(x,y-9,11,11,{fill:bg,rx:3}); s+=txt(x+17,y,lab,{size:11,fill:INK2}); x+=lab.length*6.4+44; }
  return s;
}

/* ───── C1 · Proper week grid (Mon–Sun), hours labelled with “h” ───── */
{
  const gx=48, gw=824, cols=7, colW=gw/cols, rowH=52, gap=7;
  const rows=Math.ceil((firstCol+DAYS)/cols);
  const top=176;
  let s='';
  // weekday header
  for(let i=0;i<7;i++) s+=txt(gx+i*colW+colW/2,top-6,WD[i].toUpperCase(),{size:9,weight:700,spacing:1,fill:FAINT,anchor:'middle'});
  for(let d=1;d<=DAYS;d++){
    const idx=firstCol+d-1; const r=Math.floor(idx/cols), c=idx%cols;
    const x=gx+c*colW, y=top+r*(rowH+gap);
    const st=stOf(HOURS[d]); const bg= st==='breach'?BREACH_BG : st==='warning'?WARN_BG : COMP_BG;
    const hc= st==='breach'?TERRA : st==='warning'?AMBER : NAVY;
    s+=rect(x,y,colW-8,rowH,{fill:bg,rx:8});
    s+=txt(x+9,y+16,String(d),{size:10,weight:600,fill:MUT});
    s+=txt(x+(colW-8)/2,y+37,`${HOURS[d]}h`,{size:17,weight:700,fill:hc,anchor:'middle',family:SERIF});
  }
  const gy=top+rows*(rowH+gap)+6;
  let y=gy+10; s+=line(48,y,844,y,HAIR2); y+=24;
  s+=legend(48,y);
  // breach list
  y+=30; s+=txt(48,y,'BREACH DAYS — REASON LOGGED',{size:9.5,weight:700,spacing:1.2,fill:MUT});
  for(const d of [7,16,25]){ y+=26; s+=dot(52,y-4,4,TERRA); s+=txt(66,y,`${wdOf(d)} ${d} ${monShort[MON]}`,{size:13,weight:600,fill:NAVY}); s+=txt(190,y,`${HOURS[d]}h rest`,{size:12.5,fill:INK2}); s+=txt(300,y,REASON[d],{size:12.5,fill:MUT,italic:true}); }
  y+=34; s+=txt(48,y,'C1 · Real week grid — maps to actual Mon–Sun weeks; hours read as “12h”, white card.',{size:12,fill:INK2});
  const {s:head,h}=shell(y+10);
  writeFileSync('/tmp/cal_C1.svg', head+s+'</svg>');
}

/* ───── C2 · Compliance heat strip — bars by rest hours, breach line ───── */
{
  let s=''; const gx=56, gw=812, top=200, areaH=96, maxH=24;
  const bw=(gw - (DAYS-1)*4)/DAYS; // bar width
  // y for hours value
  const yFor=(h)=> top+areaH - (h/maxH)*areaH;
  s+=txt(48,176,'Rest hours per day',{size:11,weight:600,fill:INK2});
  // gridlines + labels at 0,10,24
  for(const hh of [10,24]){ const yy=yFor(hh); s+=line(gx,yy,gx+gw,yy,hh===10?'#E7C9BC':'#EFEDE6',1,hh===10?'4 3':null); s+=txt(gx-8,yy+4,`${hh}h`,{size:9.5,fill:hh===10?TERRA:FAINT,anchor:'end'}); }
  for(let d=1;d<=DAYS;d++){
    const x=gx+(d-1)*(bw+4); const st=stOf(HOURS[d]);
    const fill= st==='breach'?TERRA : st==='warning'?'#E3B055' : '#BCCFBD'; // compliant = soft sage
    const y=yFor(HOURS[d]); const bh=top+areaH-y; s+=rect(x,y,bw,bh,{fill,rx:2});
    if(st==='compliant') s+=rect(x,y,bw,2.5,{fill:'#6FA67E',rx:1.5}); // subtle green "ok" cap
    if(d%5===0||d===1) s+=txt(x+bw/2,top+areaH+15,String(d),{size:9,fill:FAINT,anchor:'middle'});
    if(st==='breach') s+=txt(x+bw/2,y-5,String(HOURS[d]),{size:9.5,weight:700,fill:TERRA,anchor:'middle'});
  }
  // legend — compliant now reads green ("ok")
  let y=top+areaH+34; let lx=48;
  for(const [lab,bg,tc] of [['Compliant','#BCCFBD',GREEN],['Marginal','#E3B055',AMBER],['Breach',TERRA,TERRA]]){
    s+=rect(lx,y-9,11,11,{fill:bg,rx:3}); s+=txt(lx+17,y,lab,{size:11,fill:INK2}); lx+=lab.length*6.4+44;
  }
  y+=30; s+=txt(48,y,'BREACH DAYS — REASON LOGGED',{size:9.5,weight:700,spacing:1.2,fill:MUT});
  for(const d of [7,16,25]){ y+=26; s+=dot(52,y-4,4,TERRA); s+=txt(66,y,`${wdOf(d)} ${d} ${monShort[MON]}`,{size:13,weight:600,fill:NAVY}); s+=txt(190,y,`${HOURS[d]}h rest`,{size:12.5,fill:INK2}); s+=txt(300,y,REASON[d],{size:12.5,fill:MUT,italic:true}); }
  y+=34; s+=txt(48,y,'C2 · Heat strip — bar height = hours; dips below the dashed 10h line are breaches. Scannable rhythm.',{size:12,fill:INK2});
  const {s:head}=shell(y+10);
  writeFileSync('/tmp/cal_C2.svg', head+s+'</svg>');
}

/* ───── C3 · Exceptions-first — the days approval actually cares about ───── */
{
  let s=''; let y=168;
  // summary chips
  const chips=[['28 compliant',COMP_BG,NAVY],['1 marginal',WARN_BG,AMBER],['3 breaches',BREACH_BG,TERRA]];
  let cx=48; for(const [lab,bg,tc] of chips){ const wpx=lab.length*7+26; s+=rect(cx,y-15,wpx,24,{fill:bg,rx:12}); s+=txt(cx+13,y,lab,{size:12,weight:600,fill:tc}); cx+=wpx+10; }
  y+=18; s+=line(48,y,844,y,HAIR2);
  // exception rows (breaches + marginal), the rest collapsed
  const ex=[{d:7,st:'breach'},{d:13,st:'warning'},{d:16,st:'breach'},{d:25,st:'breach'}];
  y+=14; s+=txt(48,y+8,'NEEDS A LOOK',{size:9.5,weight:700,spacing:1.2,fill:MUT});
  for(const {d,st} of ex){
    y+=46; const tag= st==='breach'?'Breach':'Marginal'; const tc= st==='breach'?TERRA:AMBER; const bg= st==='breach'?BREACH_BG:WARN_BG;
    s+=rect(48,y-22,wOf(`${HOURS[d]}h`)+0,0,{}); // noop keep
    s+=dot(54,y-4,4.5,tc);
    s+=txt(70,y,`${wdOf(d)} ${d} ${monShort[MON]} 2026`,{size:14.5,weight:600,fill:NAVY});
    s+=txt(70,y+18,`${HOURS[d]}h rest${REASON[d]?`  ·  ${REASON[d]}`:'  ·  no reason logged'}`,{size:12,fill:MUT});
    // status pill
    const pw=tag.length*7+24; s+=rect(620,y-13,pw,24,{fill:bg,rx:12}); s+=txt(620+pw/2,y+4,tag,{size:11.5,weight:700,fill:tc,anchor:'middle'});
    // sign affordance
    s+=txt(844,y+2,REASON[d]?'Reason ✓':'Add reason →',{size:12,weight:600,fill:REASON[d]?GREEN:TERRA,anchor:'end'});
    s+=line(48,y+24,844,y+24,HAIR2);
  }
  // collapsed compliant
  y+=44; s+=`<path d="M 50 ${y-4} l 5 4 l -5 4 z" fill="${MUT}"/>`;
  s+=txt(66,y,'27 compliant days',{size:13.5,weight:600,fill:INK2}); s+=txt(200,y,'all ≥ 12h rest',{size:12,fill:MUT});
  s+=txt(844,y,'Show all 31 days ▾',{size:12,weight:600,fill:MUT,anchor:'end'});
  y+=40; s+=txt(48,y,'C3 · Exceptions first — approval is about the outliers; compliant days collapse to one line.',{size:12,fill:INK2});
  const {s:head}=shell(y+10);
  writeFileSync('/tmp/cal_C3.svg', head+s+'</svg>');
}
function wOf(){return 0;}
console.log('wrote /tmp/cal_C1.svg, C2, C3');
