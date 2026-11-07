export function installChartFullscreen(panel,button,{document:doc=panel.ownerDocument,onChange=()=>{}}={}){
 const root=doc.documentElement;let active=false,ownedNative=false,busy=false;
 const sync=value=>{active=value;panel.classList.toggle('is-chart-fullscreen',value);root.classList.toggle('chart-fullscreen-open',value);button.setAttribute('aria-pressed',String(value));button.setAttribute('aria-label',value?'차트 전체화면 해제':'차트 전체화면 보기');button.title=value?'전체화면 해제 · Esc':'차트 전체화면';onChange(value);};
 const enter=async()=>{
  if(busy||active)return;busy=true;button.disabled=true;sync(true);
  // Keep browser controls and system navigation available on phones/tablets.
  const mobile=doc.defaultView?.matchMedia?.('(pointer:coarse), (max-width:900px)')?.matches===true;
  try{if(!mobile&&!doc.fullscreenElement&&root.requestFullscreen){await root.requestFullscreen();ownedNative=doc.fullscreenElement===root;}}catch{ownedNative=false;}finally{busy=false;button.disabled=false;}
 };
 const exit=async()=>{
  if(busy||!active)return;busy=true;button.disabled=true;sync(false);
  try{if(ownedNative&&doc.fullscreenElement===root)await doc.exitFullscreen();}catch{}finally{ownedNative=false;busy=false;button.disabled=false;}
 };
 const click=()=>active?exit():enter(),change=()=>{if(active&&doc.fullscreenElement===root)ownedNative=true;else if(active&&ownedNative){ownedNative=false;sync(false);}},key=event=>{if(event.key==='Escape'&&active&&!doc.querySelector('dialog[open]')){event.preventDefault();exit();}};
 button.addEventListener('click',click);doc.addEventListener('fullscreenchange',change);doc.addEventListener('keydown',key);sync(false);
 return {enter,exit,get active(){return active;}};
}
