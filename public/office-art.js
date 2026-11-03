import {pixel as r,couch,bookshelf} from './room-art.js';
import {avatarSprite} from './avatar.js';
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
export function workstation(x,y,active=false){return `<g class="pixel-desk ${active?'desk-active':''}"><g transform="translate(14 0)">${r(x-95,y-94,62,119,'#28323b24')}${r(x-100,y-100,62,118,'#46535e')}${r(x-96,y-97,54,109,'#9ea9ae')}${r(x-95,y-96,51,3,'#c9d2d6')}${r(x-97,y-94,3,105,'#b9c4c8')}${r(x-44,y-94,3,107,'#798892')}${r(x-98,y+12,58,5,'#3d4b58')}${r(x-97,y+18,6,13,'#4c5964')}${r(x-48,y+18,6,13,'#4c5964')}${r(x-69,y-94,19,24,'#596775')}${r(x-67,y-92,15,18,'#aebbc3')}${r(x-65,y-89,11,2,'#667582')}${r(x-65,y-85,11,2,'#667582')}<g transform="translate(${x-81} ${y-69})"><path d="M0 0 L7 4 L7 46 L0 42Z" fill="#273544"/><path d="M1 3 L4 5 L4 41 L1 39Z" fill="${active?'#445d70':'#718392'}"/><path d="M7 4 L10 2 L10 43 L7 46Z" fill="#b4c3cf"/>${r(4,43,4,10,'#495e6e')}${r(-1,51,18,3,'#354957')}${r(7,37,2,2,active?'#9ed3ae':'#8e9fa9')}</g>${r(x-57,y-53,11,31,'#c7d2da')}${[0,1,2,3,4,5].map(i=>r(x-55,y-50+i*4,7,1,'#6c8090')).join('')}${r(x-52,y-11,8,12,'#6f818e')}${r(x-51,y-10,5,5,'#a3b3bf')}${r(x-88,y-6,10,13,'#cddfe1')}${r(x-87,y-5,7,3,'#f4fbf8')}</g>${chair(x+6,y,'left')}</g>`;}
export function sofa(x,y,color='green',width=3){const scale=width*32/128;return `<g transform="translate(${x+width*16} ${y+36*scale}) scale(${scale})">${couch(0,0,color==='green'?'#8ea8a3':'#a7a3bc')}</g>`;}
export function shelf(x,y,width=3){return bookshelf(x,y,width*48);}
export function glassWall(x,y,length,vertical=false){
 const w=vertical?12:length,h=vertical?length:44;
 return `<g class="office-glass">${r(x+4,y+10,w,h,'#78929c18')}${r(x,y,w,h,'#c3dde344')}${r(x,y,w,4,'#93aeb5')}${r(x,y+h-4,w,4,'#8ba3a9')}${Array.from({length:Math.ceil(length/64)+1},(_,i)=>vertical?r(x,y+i*64,12,4,'#8ca7af'):r(x+i*64,y,4,h,'#8ca7af')).join('')}${vertical?'':r(x+10,y+8,Math.max(0,w-20),2,'#f4ffff99')}</g>`;
}
export function chair(x,y,face="right"){return `<g transform="translate(${x} ${y}) scale(${face==="left"?-1:1} 1)">${r(-17,-29,10,28,'#647c87')}${r(-14,-26,6,23,'#9cafb4')}${r(-14,-4,35,10,'#617d89')}${r(-11,-3,29,5,'#93aab2')}${r(1,6,5,17,'#526773')}${r(-12,23,34,4,'#556b75')}${r(-13,24,5,7,'#394f59')}${r(19,24,5,7,'#394f59')}</g>`;}
