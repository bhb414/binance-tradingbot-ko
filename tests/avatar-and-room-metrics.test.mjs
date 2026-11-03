import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {avatarLayers,normalizeAppearance,AVATAR_HAIR,AVATAR_OUTFITS,AVATAR_BODIES,AVATAR_ACCESSORIES,spriteViewBox} from '../public/avatar.js';
import {workroomPerformance,positionEmotion} from '../public/workroom-metrics.js';
import {actorPose,roomLayout} from '../public/room.js';

test('every selectable avatar layer fits the real three-column, four-direction source sheet',async()=>{
 const base=normalizeAppearance(),parts=new Set();
 for(const body of AVATAR_BODIES)for(let skin=0;skin<4;skin++)avatarLayers({...base,body:body.id,skin}).forEach(p=>parts.add(p));
 for(const [key,items] of [['hair',AVATAR_HAIR],['outfit',AVATAR_OUTFITS],['accessory',AVATAR_ACCESSORIES]])for(const item of items)avatarLayers({...base,[key]:item.id}).forEach(p=>parts.add(p));
 for(const part of parts){const svg=await readFile(new URL('../public/room-assets/parts/'+part+'.svg',import.meta.url),'utf8'),bytes=Buffer.from(svg.match(/base64,([^" ]+)/)[1],'base64');assert.equal(bytes.readUInt32BE(16),96,part);assert.equal(bytes.readUInt32BE(20),128,part);}
 for(const direction of ['down','left','right','up'])for(const frame of [0,1,2]){const [x,y,w,h]=spriteViewBox(direction,frame).split(' ').map(Number);assert.ok(x>=0&&x+w<=96&&y>=0&&y+h<=128);assert.equal(w,32);assert.equal(h,32);}
 assert.deepEqual(normalizeAppearance({hair:'../../file',skin:99}),base);
});
test('working characters sit facing their monitors and walk clear of their desk',()=>{
 const bot={id:'seat-check',status:'running',task:'position'},home=roomLayout([bot]).positions.get(bot.id);let seated=0,walking=0;
 for(let t=0;t<600;t+=.1){const pose=actorPose(bot,home,t);if(pose.working){seated++;assert.equal(pose.direction,'left');assert.equal(pose.x,home.x);assert.equal(pose.y,home.y);}if(pose.walking){walking++;assert.ok(!(pose.x>home.x-99&&pose.x<home.x-35&&pose.y>home.y-100&&pose.y<home.y+20),'walk must not enter desk footprint');}}
 assert.ok(seated>walking*15&&walking>50);
});
test('overall return uses original allocations while emotion uses only the held position unrealized result',()=>{
 const bots=[{budget:1000,effectiveBudget:1100,pnl:150,quantity:1,runtime:{realized:200}},{budget:500,pnl:-25,quantity:0,runtime:{realized:-25}}];
 assert.deepEqual(workroomPerformance(bots),{baseBudget:1500,pnl:125,roi:125/1500*100});
 assert.equal(positionEmotion(bots[0]).kind,'sad');assert.equal(positionEmotion(bots[0]).value,-50);assert.equal(positionEmotion(bots[1]).kind,'none');
 assert.equal(positionEmotion({...bots[0],pnl:250}).kind,'excited');assert.equal(positionEmotion({...bots[0],pnl:200}).kind,'neutral');assert.equal(positionEmotion({...bots[0],runtime:{realized:200,syncHold:true}}).kind,'unknown');
 assert.equal(workroomPerformance([]).roi,null);assert.equal(workroomPerformance([{budget:100,pnl:null}]).roi,null);
});
