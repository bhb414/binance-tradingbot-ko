import test from 'node:test';
import assert from 'node:assert/strict';
import {installChartMenu} from '../public/chart-menu.js';
function target(){const listeners=new Map();return {listeners,addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},fire(type,event={}){for(const fn of listeners.get(type)||[])fn({target:this,preventDefault(){},stopPropagation(){},...event});}};}
function setup({anchor={left:350,top:10,bottom:42},width=390,height=844,viewport}={}){
 const doc=target(),win={...target(),innerWidth:width,innerHeight:height,visualViewport:viewport};doc.defaultView=win;
 const root={...target(),ownerDocument:doc},button={...target(),attributes:{},focusCount:0,setAttribute(k,v){this.attributes[k]=v;},focus(){this.focusCount++;},getBoundingClientRect:()=>anchor},panel={hidden:true,style:{},getBoundingClientRect:()=>({width:330,height:240}),contains:item=>item===panel};root.contains=item=>[root,button,panel].includes(item);
 const picker=installChartMenu(root,button,panel);return {doc,win,root,button,panel,picker};
}
test('dropdowns stay within a narrow viewport when their toolbar button is near the right edge',()=>{
 const h=setup();h.button.fire('click');assert.equal(h.panel.hidden,false);assert.equal(h.button.attributes['aria-expanded'],'true');assert.equal(h.panel.style.position,'fixed');
 assert.ok(parseFloat(h.panel.style.left)>=8);assert.ok(parseFloat(h.panel.style.left)+330<=382);assert.equal(h.panel.style.top,'48px');h.picker.destroy();
});
test('dropdowns open above a low anchor and account for a shifted visual viewport',()=>{
 const h=setup({anchor:{left:350,top:800,bottom:832}});h.picker.open();assert.equal(h.panel.style.top,'554px');h.picker.destroy();
 const shifted=setup({anchor:{left:350,top:300,bottom:330},viewport:{width:360,height:500,offsetLeft:15,offsetTop:100}});shifted.picker.open();assert.ok(parseFloat(shifted.panel.style.left)>=23);assert.ok(parseFloat(shifted.panel.style.left)+330<=367);shifted.picker.destroy();
});
test('Escape closes only the current popup and returns focus while outside input dismisses it',()=>{
 const h=setup();let prevented=0,stopped=0;h.picker.open();h.root.fire('keydown',{key:'Escape',preventDefault(){prevented++;},stopPropagation(){stopped++;}});
 assert.equal(h.panel.hidden,true);assert.equal(h.button.focusCount,1);assert.equal(prevented,1);assert.equal(stopped,1);
 h.picker.open();h.doc.fire('pointerdown');assert.equal(h.panel.hidden,true);h.picker.destroy();
});
test('scrolling a dropdown preserves it, while moving its toolbar anchor or resizing closes it',()=>{
 const h=setup();h.picker.open();h.doc.fire('scroll',{target:h.panel});assert.equal(h.panel.hidden,false);h.doc.fire('scroll',{target:h.root});assert.equal(h.panel.hidden,true);
 h.picker.open();h.win.fire('resize');assert.equal(h.panel.hidden,true);h.picker.destroy();
});
test('only one chart popup stays open and disposal removes all event handlers',()=>{
 const a=setup(),b=setup();a.picker.open();b.picker.open();assert.equal(a.panel.hidden,true);assert.equal(b.panel.hidden,false);
 b.picker.destroy();assert.equal(b.panel.hidden,true);b.button.fire('click');assert.equal(b.panel.hidden,true);
 for(const object of [b.root,b.button,b.doc,b.win])assert([...object.listeners.values()].every(set=>set.size===0));a.picker.destroy();
});
