import fs from 'fs'; import { createRequire } from 'module'; const require=createRequire(import.meta.url);
const C=require('../src/codecs.js'); const d='test/fixtures/';
let fails=0; const ok=(c,m)=>{console.log((c?'OK   ':'FAIL ')+m); if(!c) fails++;};
const ref=(x,y)=>[Math.floor(x*255/301),Math.floor(y*255/203),Math.floor((x+y)*127/504)+60];
for (const f of ['t_raw','t_lzw','t_pack','t_zip','t_rgba']){
  const buf=fs.readFileSync(d+f+'.tif'); const t0=Date.now(); const r=await C.decodeTIFF(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.length));
  let md=0; for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const e=ref(x,y);for(let c=0;c<3;c++)md=Math.max(md,Math.abs(r.data[(y*r.width+x)*4+c]-e[c]));}
  ok(r.width===301&&r.height===203&&md<=1,`TIFF lesen ${f}: ${r.width}x${r.height}, max Δ ${md} (${Date.now()-t0}ms)`+(f==='t_rgba'?' alpha='+r.data[3]:''));
}
for (const f of ['t_gray','t_16','t_pal']){ const buf=fs.readFileSync(d+f+'.tif'); const r=await C.decodeTIFF(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.length));
  ok(r.width===301, `TIFF lesen ${f}: px(150,100)=${Array.from(r.data.slice((100*301+150)*4,(100*301+150)*4+4))} bits=${r.bits}`); }
// Schreiben + zurücklesen
const W=64,H=40; const d8=new Uint8ClampedArray(W*H*4), d16=new Uint16Array(W*H*4);
for(let i=0;i<W*H;i++){d8[i*4]=i%256;d8[i*4+1]=(i*3)%256;d8[i*4+2]=(i*7)%256;d8[i*4+3]=255; d16[i*4]=i*13%65536; d16[i*4+1]=i*31%65536; d16[i*4+2]=i*101%65536; d16[i*4+3]=65535;}
for (const [bits,data,cmp] of [[8,d8,false],[8,d8,true],[16,d16,false],[16,d16,true]]){
  const blob=await C.encodeTIFF(data,W,H,bits,false,cmp); const ab=await blob.arrayBuffer(); fs.writeFileSync(`test/fixtures/out_${bits}_${cmp}.tif`,Buffer.from(ab));
  const r=await C.decodeTIFF(ab); let md=0; for(let i=0;i<W*H;i++) for(let c=0;c<3;c++){ const e=bits===8?data[i*4+c]:Math.round(data[i*4+c]/257); md=Math.max(md,Math.abs(r.data[i*4+c]-e)); }
  ok(md<=1,`TIFF schreiben ${bits} Bit ${cmp?'Deflate':'unkomprimiert'} → zurückgelesen, Δ ${md}, ${blob.size} B`);
}
for (const bits of [8,16]){ const blob=await C.encodePNG(bits===8?d8:d16,W,H,bits,false); fs.writeFileSync(`test/fixtures/out_${bits}.png`,Buffer.from(await blob.arrayBuffer())); ok(blob.size>100,`PNG ${bits} Bit geschrieben (${blob.size} B)`); }
const z=await C.makeZip([{name:'a.tif',blob:new Blob([new Uint8Array([1,2,3])])}]); fs.writeFileSync('test/fixtures/out.zip',Buffer.from(await z.arrayBuffer())); ok(z.size>0,'ZIP erstellt');
console.log(fails?fails+' FEHLER':'Alle Codec-Tests bestanden');
for (const f of ['t_tiled','t_planar16']){
  const buf=fs.readFileSync(d+f+'.tif'); const r=await C.decodeTIFF(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.length));
  let md=0; for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const e=ref(x,y);for(let c=0;c<3;c++)md=Math.max(md,Math.abs(r.data[(y*r.width+x)*4+c]-e[c]));}
  ok(md<=1,`TIFF lesen ${f}: max Δ ${md}`);
}
