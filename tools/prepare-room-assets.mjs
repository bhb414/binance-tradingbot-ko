// Package original licensed PNG pixels in SVG containers for the buildless app.
// No recolouring, resampling or generated bitmap art is involved.
import {mkdir,readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {AVATAR_BODIES,AVATAR_HAIR,AVATAR_OUTFITS,AVATAR_ACCESSORIES,avatarLayers,normalizeAppearance} from '../public/avatar.js';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'public/room-assets');
await mkdir(out,{recursive:true});
async function wrap(source,name){
  const png=await readFile(path.join(root,source)),width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  await writeFile(path.join(out,name+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}" style="image-rendering:pixelated"/></svg>`);
  return {width,height,name};
}
await wrap('asset-sources/indoors/Tilesheets/roguelikeIndoor_transparent.png','indoors');
await wrap('asset-sources/city/Tilemap/tilemap_packed.png','city');
await copyFile(path.join(root,'asset-sources/indoors/License.txt'),path.join(out,'LICENSE-Kenney-Indoors.txt'));
await copyFile(path.join(root,'asset-sources/city/License.txt'),path.join(out,'LICENSE-Kenney-City.txt'));
await mkdir(path.join(out,'parts'),{recursive:true});
const usedParts=new Set(),base=normalizeAppearance();
for(const body of AVATAR_BODIES)for(let skin=0;skin<4;skin++)for(const name of avatarLayers({...base,body:body.id,skin}))usedParts.add(name);
for(const [key,items] of [['hair',AVATAR_HAIR],['outfit',AVATAR_OUTFITS],['accessory',AVATAR_ACCESSORIES]])for(const item of items)for(const name of avatarLayers({...base,[key]:item.id}))usedParts.add(name);
for(const name of usedParts){const result=await wrap('asset-sources/pipoya-parts/'+name+'.png','parts/'+name);if(result.width!==96||result.height!==128)throw new Error('Unexpected avatar sheet: '+name);}
if(!process.argv.includes('--catalog')){console.log('Two tile atlases and '+usedParts.size+' modular avatar layers prepared.');process.exit(0);}
const characters=[];
for(const name of await readdir(path.join(root,'asset-sources/pipoya'))){
  if(!/^(Male|Female) \d+-1\.png$/.test(name))continue;
  const png=await readFile(path.join(root,'asset-sources/pipoya',name));
  characters.push(`<div><svg viewBox="0 0 32 32" width="96" height="96"><image href="data:image/png;base64,${png.toString('base64')}" width="${png.readUInt32BE(16)}" height="${png.readUInt32BE(20)}"/></svg><small>${name}</small></div>`);
}
let grid='';for(let y=0;y<18;y++)for(let x=0;x<27;x++)grid+=`<div><svg viewBox="${x*17} ${y*17} 16 16" width="48" height="48"><image href="indoors.svg" width="458" height="305"/></svg><small>${x},${y}</small></div>`;
await writeFile(path.join(out,'catalog.html'),`<!doctype html><meta charset="utf-8"><style>body{background:#dde5eb;color:#253e45;font:11px monospace}section{display:grid;grid-template-columns:repeat(12,1fr);gap:8px}section.tiles{grid-template-columns:repeat(18,1fr)}small{display:block}svg{image-rendering:pixelated}div{text-align:center;background:#f7f7f2;padding:4px}</style><h2>Characters</h2><section>${characters.join('')}</section><h2>Indoor tiles</h2><section class="tiles">${grid}</section>`);
console.log('Room asset containers and local inspection catalog prepared.');
