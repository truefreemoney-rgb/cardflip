const fs=require('fs'),p=require('path');const dir='C:/Users/Chris/cardflip/.outline-dumps';
const pre=process.argv.slice(2);const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&pre.some(x=>f.startsWith(x))).sort();
const c={sureNotReady:0,unsteady:0,outGuide:0,angle:0,other:0,mv:[]};
for(const f of files){const d=JSON.parse(fs.readFileSync(p.join(dir,f)));let pq=null;
 for(const t of d.ticks||[]){const r=t.reason||'';const q=t.quad?t.quad.map(c=>({x:c.x/224,y:c.y/224})):null;
  const mv=pq&&q?Math.max(...q.map((c,i)=>Math.hypot(c.x-pq[i].x,c.y-pq[i].y))):1;pq=q;
  if(!/sure/.test(r)||t.ready)continue;c.sureNotReady++;c.mv.push(mv);
  const tg=t.target||[];const out=!tg.every(p=>p.x>-0.12&&p.x<1.12&&p.y>-0.12&&p.y<1.12);
  const ang=q?Math.atan2(q[1].y-q[0].y,q[1].x-q[0].x)*180/Math.PI:0;
  if(mv>=0.03)c.unsteady++;else if(out)c.outGuide++;else if(Math.abs(ang)>8)c.angle++;else c.other++;}}
c.mv.sort((a,b)=>a-b);const q=f=>c.mv[Math.floor(f*(c.mv.length-1))]?.toFixed(3);
console.log({...c,mv:undefined,mvP25:q(.25),mvP50:q(.5),mvP75:q(.75)});
