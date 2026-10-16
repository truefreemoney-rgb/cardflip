const fs=require('fs'),p=require('path');const dir='C:/Users/Chris/cardflip/.outline-dumps';
const pre=process.argv.slice(2);
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&pre.some(x=>f.startsWith(x))).sort();
const G=[[0,0],[1,0],[1,1],[0,1]];
const gates={
 now:(t)=>t.mn>=30&&t.sup>=0.7&&t.st>=2,
 A_min20_sup6:(t)=>t.mn>=20&&t.sup>=0.6&&t.st>=2,
 B_fit12_min15:(t)=>t.fit<=0.12&&t.mn>=15&&t.sup>=0.6&&t.st>=2,
 C_fit10_nosc:(t)=>t.fit<=0.10&&t.sup>=0.6&&t.st>=2,
 D_fit12_3of4:(t)=>t.fit<=0.12&&t.s.filter(x=>x>=30).length>=3&&t.sup>=0.6&&t.st>=2,
 E_fit15_min15:(t)=>t.fit<=0.15&&t.mn>=15&&t.sup>=0.6&&t.st>=2,
};
const res={};
for(const f of files){const d=JSON.parse(fs.readFileSync(p.join(dir,f)));const m=f.slice(11,16);let pq=null,st=0;
 for(const t of d.ticks||[]){const mm=(t.reason||'').match(/corners (\d+)\/(\d+)\/(\d+)\/(\d+) ([TF]) sup ([\d.]+)/);
  const r=res[m]??={n:0};r.n++;
  if(!mm||!t.quad){pq=null;st=0;continue;}
  const q=t.quad.map(c=>({x:c.x/224,y:c.y/224}));
  const mv=pq?Math.max(...q.map((c,i)=>Math.hypot(c.x-pq[i].x,c.y-pq[i].y))):1; st=mv<0.03?st+1:0; pq=q;
  const tg=t.target||[];const fit=tg.length?Math.max(...tg.map((c,i)=>Math.hypot(c.x-G[i][0],c.y-G[i][1]))):9;
  const s=mm.slice(1,5).map(Number);const x={s,mn:Math.min(...s),sup:+mm[6],st,fit};
  for(const [k,g] of Object.entries(gates))if(g(x))r[k]=(r[k]||0)+1;
  r.fitok=(r.fitok||0)+(fit<=0.12);}
}
for(const [m,r] of Object.entries(res).sort())console.log(m,'n',r.n,'fit<=12%',r.fitok,Object.keys(gates).map(k=>`${k} ${((r[k]||0)/r.n*100).toFixed(0)}%`).join('  '));
