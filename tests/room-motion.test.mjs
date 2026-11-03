import test from 'node:test';
import assert from 'node:assert/strict';
import {roomLayout,actorPose,renderRoom} from '../public/room.js';
const bots=Array.from({length:35},(_,index)=>({id:'room-'+index,name:'봇 '+index,color:['mint','lavender','amber'][index%3],status:index<20?'running':'paused',task:index%2?'position':'watching',symbol:'BTCUSDT',leverage:3}));
test('people walk continuously in their own room without crossing the walls or leaving the world',()=>{
  const layout=roomLayout(bots);assert.ok(layout.width>1000);assert.ok(layout.height>1000);
  for(const bot of bots){const home=layout.positions.get(bot.id),positions=new Set();let previous;
    for(let time=0;time<90;time+=.2){const pose=actorPose(bot,home,time);positions.add(Math.round(pose.x)+':'+Math.round(pose.y));
      assert.ok(pose.y>160&&pose.y<layout.height-280);assert.ok(home.work?pose.x>160&&pose.x<870:pose.x>940&&pose.x<1360);
      if(previous)assert.ok(Math.hypot(pose.x-previous.x,pose.y-previous.y)<=9.01,'sprite must not jump across its loop boundary');previous=pose;
    }
    assert.ok(positions.size>25,'each person must actually change position');
  }
});
test('people have no visual name labels while accessible selection retains full identity',()=>{
  const source=renderRoom([{...bots[0],name:'<팀장 & 봇>'}],{selectedId:'room-0'});
  assert.doesNotMatch(source,/class="actor-nickname"/);assert.match(source,/aria-pressed="true"/);assert.match(source,/aria-label="&lt;팀장 &amp; 봇&gt; · BTCUSDT/);
  assert.doesNotMatch(source,/<text[^>]*>BTCUSDT/);assert.doesNotMatch(source,/<text[^>]*>[^<]*3×/);assert.match(source,/human-sprite/);
});
