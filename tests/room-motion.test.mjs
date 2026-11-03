import test from 'node:test';
import assert from 'node:assert/strict';
import {roomLayout,actorPose,renderRoom} from '../public/room.js';
const bots=Array.from({length:35},(_,index)=>({id:'room-'+index,name:'봇 '+index,status:index<20?'running':'paused',task:index%2?'position':'watching',symbol:'BTCUSDT',leverage:3}));
test('office paths stay continuous and clear of desks while working bots spend at least 95% of their time seated',()=>{
 const layout=roomLayout(bots);assert.ok(layout.width>=1000);assert.ok(layout.height>1000);
 for(const bot of bots){const home=layout.positions.get(bot.id);let previous,seated=0,samples=0,moving=0;
 for(let time=0;time<600;time+=.2){const pose=actorPose(bot,home,time);samples++;seated+=Number(pose.working);moving+=Number(pose.walking);
 assert.ok(pose.x>80&&pose.x<layout.width-80&&pose.y>176&&pose.y<layout.height-112);
 assert.ok(!(pose.x>home.x-120&&pose.x<home.x-42&&pose.y>home.y-106&&pose.y<home.y+37),'route must not enter the desk');
 if(previous)assert.ok(Math.hypot(pose.x-previous.x,pose.y-previous.y)<=9.61,'continuous route required');previous=pose;}
 assert.ok(moving>0,'occasional movement is retained');if(home.work)assert.ok(seated/samples>=.95,'working is predominantly seated');}
});
test('starting or pausing a bot keeps its desk, and the office contains no separate lounge or meeting room',()=>{
 const a=roomLayout(bots),b=roomLayout(bots.map(bot=>({...bot,status:bot.status==='running'?'paused':'running'})));
 for(const bot of bots){assert.equal(a.positions.get(bot.id).x,b.positions.get(bot.id).x);assert.equal(a.positions.get(bot.id).y,b.positions.get(bot.id).y);}
 const source=renderRoom(bots);assert.doesNotMatch(source,/COFFEE|LOUNGE|MEETING|RECEPTION/);
});
test('people have no visual name labels while accessible selection retains full identity',()=>{
 const source=renderRoom([{...bots[0],name:'<팀장 & 봇>'}],{selectedId:'room-0'});
 assert.doesNotMatch(source,/class="actor-nickname"/);assert.match(source,/aria-pressed="true"/);assert.match(source,/aria-label="&lt;팀장 &amp; 봇&gt; · BTCUSDT/);
 assert.doesNotMatch(source,/<text[^>]*>BTCUSDT/);assert.match(source,/human-sprite/);assert.match(source,/actor-menu-anchor/);
});
