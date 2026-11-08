// Fixed anchoring keeps dropdowns visible outside the scrolling chart toolbar.
let active=null;
export function installChartMenu(root,button,panel,{onOpen=()=>{}}={}){
 const doc=root.ownerDocument,win=doc.defaultView;
 const close=()=>{panel.hidden=true;button.setAttribute('aria-expanded','false');if(active===controller)active=null;};
 const open=()=>{
  active?.close();panel.hidden=false;button.setAttribute('aria-expanded','true');active=controller;
  const rect=button.getBoundingClientRect(),viewport=win.visualViewport,width=viewport?.width||win.innerWidth,height=viewport?.height||win.innerHeight,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0;
  const below=top+height-rect.bottom-10,above=rect.top-top-10,up=below<180&&above>below;
  Object.assign(panel.style,{position:'fixed',bottom:'auto',marginLeft:'0px',maxHeight:Math.max(70,Math.min(470,up?above:below))+'px',maxWidth:Math.max(140,width-16)+'px'});
  const bounds=panel.getBoundingClientRect();panel.style.left=Math.max(left+8,Math.min(rect.left,left+width-bounds.width-8))+'px';panel.style.top=Math.max(top+8,up?rect.top-bounds.height-6:rect.bottom+6)+'px';onOpen();
 };
 const click=()=>panel.hidden?open():close(),escape=event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();close();button.focus({preventScroll:true});}},outside=event=>{if(!root.contains(event.target))close();},scroll=event=>{if(!panel.hidden&&!panel.contains(event.target))close();};
 const controller={open,close,destroy(){close();button.removeEventListener('click',click);root.removeEventListener('keydown',escape);doc.removeEventListener('pointerdown',outside);doc.removeEventListener('scroll',scroll,true);win.removeEventListener('resize',close);}};
 button.addEventListener('click',click);root.addEventListener('keydown',escape);doc.addEventListener('pointerdown',outside);doc.addEventListener('scroll',scroll,true);win.addEventListener('resize',close);
 return controller;
}
