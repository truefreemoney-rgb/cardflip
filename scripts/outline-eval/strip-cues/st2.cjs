const fs=require('fs'),p=require('path');const dir='C:/Users/Chris/cardflip/.outline-dumps';
const pre=process.argv.slice(2);const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&pre.some(x=>f.startsWith(x))).sort();
for(const [th,H] of [[0.03,0],[0.08,0],[0.08,3],[0.08,5],[0.05,4]]){let n=0,g=0,dumps=0,dg=0;
 for(const f of files){const d=JSON.parse(fs.readFileSync(p.join(dir,f)));let pq=null,st=0,any=0,hold=0;dumps++;
  for(const t of d.ticks||[]){n++;const r=t.reason||'';const q=t.quad?t.quad.map(c=>({x:c.x/224,y:c.y/224})):null;
   if(!q||!/corners/.test(r)){pq=null;st=0;continue;}
   const mv=pq?Math.max(...q.map((c,i)=>Math.hypot(c.x-pq[i].x,c.y-pq[i].y))):1;pq=q;st=mv<th?st+1:0;
   const tg=t.target||[];const inG=tg.every(p=>p.x>-0.12&&p.x<1.12&&p.y>-0.12&&p.y<1.12);
   const ok=/sure/.test(r)&&st>=1&&inG; if(ok)hold=H+1; if(!inG)hold=0; if(hold>0){g++;any=1;hold--;}}
  dg+=any;}
 console.log('steady<',th,'hold',H,'green ticks',(g/n*100).toFixed(0)+'%','dumps with green',dg+'/'+dumps);}
