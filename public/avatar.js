import {identity} from './room-art.js';
export const APPEARANCE_KEY='fw-bot-appearance-v1';
export const AVATAR_BODIES=[{id:'a',label:'체형 A',skins:[22,23,24,25],eye:26},{id:'b',label:'체형 B',skins:[6,7,8,9],eye:16}];
export const AVATAR_HAIR=[
 {id:'short',label:'쇼트',front:39},{id:'crop',label:'크롭',front:41},{id:'wave',label:'웨이브',front:43,back:32},
 {id:'side',label:'사이드 파트',front:47,back:36},{id:'spike',label:'스파이키',front:51,back:40},{id:'medium',label:'미디엄',front:57,back:44},
 {id:'long',label:'긴 머리',front:1,back:0},{id:'bob',label:'단발',front:5,back:2},{id:'pony',label:'포니테일',front:9,back:6},
 {id:'curl',label:'컬',front:13,back:10},{id:'pixie',label:'픽시',front:19},{id:'braid',label:'브레이드',front:27,back:20}
];
export const AVATAR_OUTFITS=[
 {id:'suit',label:'블레이저',file:55},{id:'suit-blue',label:'블루 재킷',file:56},{id:'vest',label:'베스트',file:58},
 {id:'casual',label:'캐주얼',file:33},{id:'shirt',label:'셔츠',file:34},{id:'uniform',label:'니트 유니폼',file:49},
 {id:'skirt',label:'스커트 정장',file:18},{id:'skirt-blue',label:'블루 정장',file:19},{id:'jacket',label:'롱 재킷',file:21},
 {id:'dress',label:'캐주얼 원피스',file:0},{id:'cardigan',label:'카디건',file:1},{id:'school',label:'세일러',file:12}
];
export const AVATAR_ACCESSORIES=[{id:'none',label:'없음'},{id:'round',label:'둥근 안경',group:'06Glasses',file:0},{id:'square',label:'사각 안경',group:'06Glasses',file:2},{id:'sun',label:'선글라스',group:'06Glasses',file:4},{id:'ribbon',label:'헤어밴드',group:'05Hat',file:13},{id:'hat',label:'실크햇',group:'05Hat',file:16}];
const keys={body:AVATAR_BODIES,hair:AVATAR_HAIR,outfit:AVATAR_OUTFITS,accessory:AVATAR_ACCESSORIES};
export function normalizeAppearance(value={}){const out={};for(const [key,items] of Object.entries(keys))out[key]=items.some(item=>item.id===value?.[key])?value[key]:items[0].id;out.skin=Number.isInteger(value?.skin)&&value.skin>=0&&value.skin<4?value.skin:0;return out;}
export function defaultAppearance(bot){const n=identity(bot.id).seed;return normalizeAppearance({body:n%2?'a':'b',skin:n%4,hair:AVATAR_HAIR[n%AVATAR_HAIR.length].id,outfit:AVATAR_OUTFITS[n%AVATAR_OUTFITS.length].id,accessory:'none'});}
let saved={};
export function reloadAppearances(){try{const data=JSON.parse(globalThis.localStorage?.getItem(APPEARANCE_KEY)||'{}');saved=data&&typeof data==='object'&&!Array.isArray(data)?data:{};}catch{saved={};}}
reloadAppearances();
export function appearanceFor(bot){return Object.hasOwn(saved,bot.id)?normalizeAppearance(saved[bot.id]):defaultAppearance(bot);}
export function saveAppearance(bot,value){const next={...saved,[bot.id]:normalizeAppearance(value)};globalThis.localStorage.setItem(APPEARANCE_KEY,JSON.stringify(next));saved=next;return saved[bot.id];}
export function avatarSignature(bot){return JSON.stringify(appearanceFor(bot));}
export function avatarLayers(value){
 const a=normalizeAppearance(value),body=AVATAR_BODIES.find(x=>x.id===a.body),hair=AVATAR_HAIR.find(x=>x.id===a.hair),outfit=AVATAR_OUTFITS.find(x=>x.id===a.outfit),accessory=AVATAR_ACCESSORIES.find(x=>x.id===a.accessory);
 return [hair.back===undefined?null:'03Hair-back-'+hair.back,'00Skin-'+body.skins[a.skin],'01Costume-'+outfit.file,'02Eye-'+body.eye,'03Hair-'+hair.front,accessory.group?accessory.group+'-'+accessory.file:null].filter(Boolean);
}
export function spriteViewBox(direction='down',frame=1){const column=[0,1,2].includes(frame)?frame:1,row={down:0,left:1,right:2,up:3}[direction]??0;return `${column*32} ${row*32} 32 32`;}
export function avatarSprite(bot,{appearance=appearanceFor(bot),direction='down',frame=1,x=-32,y=-62,size=64}={}){
 return `<svg class="human-sprite sprite-person" x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${spriteViewBox(direction,frame)}" overflow="hidden" aria-hidden="true">${avatarLayers(appearance).map(name=>`<image href="/room-assets/parts/${name}.svg" width="96" height="128"/>`).join('')}</svg>`;
}
export function seatedAvatar(bot){
 const a=appearanceFor(bot),pants=['casual','shirt','school','cardigan'].includes(a.outfit)?'#4f6357':'#515e70',skin=['#edc7a5','#d8ab82','#b78260','#805a44'][a.skin];
 return `<g class="seated-person"><g class="seated-legs"><path d="M-6 -20 H14 V-9 H-12 V7 H-20 V-12 H-6Z" fill="${pants}"/><path d="M-20 6 H-6 V13 H-24 V9Z" fill="#34414d"/><path d="M-5 -16 H10 V-10 H-5Z" fill="#9aa9b2" opacity=".3"/></g><svg class="seated-torso" x="-40" y="-70" width="80" height="57.5" viewBox="32 32 32 23" overflow="hidden" aria-hidden="true">${avatarLayers(a).map(name=>`<image href="/room-assets/parts/${name}.svg" width="96" height="128"/>`).join('')}</svg><path d="M-18 -24 H-27 V-20 H-36 V-14 H-23 V-17 H-16Z" fill="#667c85"/><path d="M-36 -20 H-42 V-14 H-34Z" fill="${skin}"/></g>`;
}
export function avatarPartLayers(category,item,appearance){
 const a=normalizeAppearance(appearance);
 if(category==='hair'){const hair=AVATAR_HAIR.find(x=>x.id===item);return hair?[hair.back===undefined?null:'03Hair-back-'+hair.back,'03Hair-'+hair.front].filter(Boolean):[];}
 if(category==='outfit'){const outfit=AVATAR_OUTFITS.find(x=>x.id===item);return outfit?['01Costume-'+outfit.file]:[];}
 if(category==='accessory'){const accessory=AVATAR_ACCESSORIES.find(x=>x.id===item);return accessory?.group?[accessory.group+'-'+accessory.file]:[];}
 return [];
}
export function avatarPartPreview(category,item,appearance){
 const layers=avatarPartLayers(category,item,appearance);if(!layers.length)return '<span class="appearance-none" aria-hidden="true">∅</span>';
 const viewBox=category==='outfit'?'36 12 24 20':category==='accessory'?'32 0 32 22':'32 0 32 32';
 return `<svg class="appearance-part" viewBox="${viewBox}" aria-hidden="true" overflow="hidden">${layers.map(name=>`<image href="/room-assets/parts/${name}.svg" width="96" height="128"/>`).join('')}</svg>`;
}
