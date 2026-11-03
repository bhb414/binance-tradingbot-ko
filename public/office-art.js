import {pixel as r,couch,bookshelf} from './room-art.js';
import {avatarSprite} from './avatar.js';
import {workstationEffect} from './workroom-metrics.js';
const sheets={indoors:{width:458,height:305,step:17},city:{width:592,height:448,step:16}};
export function tile(sheet,column,row,x,y,width=32,height=32){
  const atlas=sheets[sheet];return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${column*atlas.step} ${row*atlas.step} 16 16" overflow="hidden" aria-hidden="true"><image href="/room-assets/${sheet}.svg" width="${atlas.width}" height="${atlas.height}"/></svg>`;
}
export function patch(sheet,column,row,columns,rows,x,y,scale=2){
  return Array.from({length:rows},(_,dy)=>Array.from({length:columns},(_,dx)=>tile(sheet,column+dx,row+dy,x+dx*16*scale,y+dy*16*scale,16*scale,16*scale)).join('')).join('');
}
export const humanSprite=avatarSprite;
export function planter(x,y,size=1){return `<g transform="translate(${x} ${y}) scale(${size})">${r(-12,-1,25,4,'#49545322')}${tile('indoors',16,0,-16,-32)}</g>`;}
export function monitor(x,y,active=false,large=false){
 const w=large?112:42,h=large?60:30;return `<g transform="translate(${x} ${y})">${r(-w/2+3,7,w,h,'#22333c22')}${r(-w/2,0,w,h,'#36434b')}${r(-w/2+3,3,w-6,h-7,active?'#172f3d':'#52707c')}${r(-3,h,6,9,'#606f77')}${r(-12,h+8,24,3,'#899496')}<g class="monitor-pixels">${[0,1,2,3,4].map((n)=>r(-w/2+8+n*(w-16)/5,h-10-n%3*4,large?9:3,5+n%3*4,active?['#67cba6','#e1c37c','#78abd3'][n%3]:'#8ca5a7')).join('')}</g></g>`;
}
export function workstation(x,y,active=false,bot=null){return `<g class="pixel-desk ${active?'desk-active':''}">${r(x-114,y-99,76,132,'#31454d20')}${r(x-120,y-106,78,130,'#586975')}${r(x-116,y-102,70,119,'#b4c0c4')}${r(x-115,y-101,68,4,'#e1e7e5')}${r(x-117,y-100,3,115,'#d0dada')}${r(x-47,y-100,4,120,'#879aa4')}${r(x-117,y+17,73,6,'#4a606e')}${r(x-115,y+23,6,14,'#5d727e')}${r(x-51,y+23,6,14,'#5d727e')}
 ${r(x-108,y-96,20,26,'#758995')}${r(x-105,y-93,14,18,'#ced8dc')}${r(x-102,y-89,8,2,'#8195a0')}${r(x-102,y-84,8,2,'#8195a0')}
 <g class="side-monitor">${r(x-89,y-77,8,48,'#2f4352')}${r(x-87,y-74,3,41,active?'#79b69d':'#9baeb6')}${r(x-81,y-80,5,49,'#e0e8e9')}${r(x-80,y-31,4,15,'#617a8b')}${r(x-92,y-18,25,4,'#526e7e')}${r(x-82,y-36,2,2,active?'#b6e4aa':'#95a5ad')}</g>
 ${r(x-60,y-56,14,35,'#e1e8e9')}${[0,1,2,3,4,5,6].map(i=>r(x-58,y-52+i*4,9,1,'#8196a1')).join('')}${r(x-57,y-7,8,12,'#8da3ae')}${r(x-56,y-6,6,5,'#d3dfe1')}${r(x-106,y-4,11,14,'#e6eee7')}${r(x-104,y-2,7,3,'#b5c8b6')}
 ${chair(x+12,y-8,'left')}${bot&&active?workstationEffect(bot,x,y):''}</g>`;
}
export function sofa(x,y,color='green',width=3){const scale=width*32/128;return `<g transform="translate(${x+width*16} ${y+36*scale}) scale(${scale})">${couch(0,0,color==='green'?'#8ea8a3':'#a7a3bc')}</g>`;}
export function shelf(x,y,width=3){return bookshelf(x,y,width*48);}
export function glassWall(x,y,length,vertical=false){
 const w=vertical?12:length,h=vertical?length:44;
 return `<g class="office-glass">${r(x+4,y+10,w,h,'#78929c18')}${r(x,y,w,h,'#c3dde344')}${r(x,y,w,4,'#93aeb5')}${r(x,y+h-4,w,4,'#8ba3a9')}${Array.from({length:Math.ceil(length/64)+1},(_,i)=>vertical?r(x,y+i*64,12,4,'#8ca7af'):r(x+i*64,y,4,h,'#8ca7af')).join('')}${vertical?'':r(x+10,y+8,Math.max(0,w-20),2,'#f4ffff99')}</g>`;
}
export function chair(x,y,face="right"){return `<g transform="translate(${x} ${y}) scale(${face==="left"?-1:1} 1)">${r(-17,-29,10,28,'#647c87')}${r(-14,-26,6,23,'#9cafb4')}${r(-14,-4,35,10,'#617d89')}${r(-11,-3,29,5,'#93aab2')}${r(1,6,5,17,'#526773')}${r(-12,23,34,4,'#556b75')}${r(-13,24,5,7,'#394f59')}${r(19,24,5,7,'#394f59')}</g>`;}
