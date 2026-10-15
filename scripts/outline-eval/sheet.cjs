const { createRequire } = require("node:module");
const r = createRequire("file:///C:/Users/Chris/cardflip/package.json");
const sharp = r("sharp"); const fs = require("fs"); const path = require("path");
const dir = process.argv[2]; const files = fs.readdirSync(dir).filter(f=>f.startsWith("16-")&&f.endsWith(".png")).sort();
const W=336,H=381,COLS=6; 
(async()=>{ for (let s=0; s*36<files.length; s++){ const chunk=files.slice(s*36,s*36+36); const rows=Math.ceil(chunk.length/COLS);
 const comps=[]; for(let i=0;i<chunk.length;i++){ const buf=await sharp(path.join(dir,chunk[i])).resize(W,H).toBuffer(); comps.push({input:buf,left:(i%COLS)*W,top:Math.floor(i/COLS)*H}); }
 await sharp({create:{width:COLS*W,height:rows*H,channels:3,background:"#000"}}).composite(comps).jpeg({quality:80}).toFile(path.join(dir,`sheet${s+1}.jpg`)); console.log("sheet"+(s+1), chunk[0], chunk[chunk.length-1]); } })();
