const fs=require('fs'),p=require('path');const dir='C:/Users/Chris/cardflip/.outline-dumps';
const pre=process.argv.slice(2);
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&pre.some(x=>f.startsWith(x)));
const byMin={};const all=[];
for(const f of files){const d=JSON.parse(fs.readFileSync(p.join(dir,f)));const m=f.slice(11,16);
 let prev=null;
 for(const t of d.ticks||[]){const r=t.reason||'';const mm=r.match(/corners (\d+)\/(\d+)\/(\d+)\/(\d+) ([TF]) sup ([\d.]+)/);
  const o=byMin[m]??={n:0,corner:0,sure:0,ready:0,T:0,minS:[],sup:[],failScore:0,failSup:0,mv:[],other:{}};o.n++;
  if(t.ready)o.ready++;
  if(!mm){const k=r.split(' ').slice(0,2).join(' ');o.other[k]=(o.other[k]||0)+1;prev=null;continue;}
  o.corner++;const s=mm.slice(1,5).map(Number),sup=+mm[6];if(mm[5]==='T')o.T++;
  if(/sure/.test(r))o.sure++;const mn=Math.min(...s);o.minS.push(mn);o.sup.push(sup);
  if(mn<30)o.failScore++;if(sup<0.7)o.failSup++;
  if(prev&&t.target&&prev.target){o.mv.push(Math.max(...t.target.map((q,i)=>Math.hypot(q.x-prev.target[i].x,q.y-prev.target[i].y))));}
  prev=t;all.push({mn,sup,T:mm[5]});}
}
const q=(a,f)=>{a=[...a].sort((x,y)=>x-y);return a.length?a[Math.floor(f*(a.length-1))].toFixed(2):'-'};
for(const [m,o] of Object.entries(byMin).sort())console.log(m,`ticks ${o.n} corners ${o.corner} T ${o.T} sure ${o.sure} ready ${o.ready} | min<30 ${o.failScore} sup<0.7 ${o.failSup} | minS p25/50/75 ${q(o.minS,.25)}/${q(o.minS,.5)}/${q(o.minS,.75)} sup ${q(o.sup,.25)}/${q(o.sup,.5)}/${q(o.sup,.75)} | targetMove p50/75 ${q(o.mv,.5)}/${q(o.mv,.75)}`,JSON.stringify(o.other));
