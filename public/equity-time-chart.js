const NS='http://www.w3.org/2000/svg',DAY=86400000;
const valid=n=>typeof n==='number'&&Number.isFinite(n);
const source=p=>p.source==='binance-daily'?'daily':'observed';
const number=n=>Number(n.toFixed(2));
const money=n=>n.toLocaleString('en-US',{maximumFractionDigits:2});
let instance=0;
export function orderedEquityPoints(points){return [...new Map(points.filter(p=>valid(p.at)&&p.at>0).map(p=>[p.at,p])).values()].sort((a,b)=>a.at-b.at);}
export function elapsedPosition(at,range,width){return (at-range.from)/(range.to-range.from)*width;}
export function equitySegments(points,field){
 const segments=[];let current=null,previous=null;
 for(const p of orderedEquityPoints(points)){
  if(!valid(p[field])){current=null;previous=null;continue;}
  if(!current||p.gapBefore||source(p)!==source(previous)){current=[];segments.push(current);}
  current.push(p);previous=p;
 }
 return segments;
}
export function equityRange(points,mode='all'){
 const selected=orderedEquityPoints(points).filter(p=>mode!=='detail'||source(p)==='observed');if(!selected.length)return null;
 const first=selected[0].at,last=selected.at(-1).at,span=Math.max(60000,last-first),padding=span*.035;
 return {from:first-padding,to:(last>first?last:first+span)+padding};
}
export function equityTimeTicks(range,count=5){
 const steps=[1000,5000,10000,30000,60000,300000,900000,1800000,3600000,7200000,14400000,21600000,43200000,DAY,2*DAY,7*DAY,30*DAY,90*DAY,365*DAY];
 const step=steps.find(v=>v>=(range.to-range.from)/Math.max(2,count))||365*DAY,offset=9*3600000,first=Math.ceil((range.from+offset)/step)*step-offset,ticks=[];
 for(let at=first;at<=range.to&&ticks.length<20;at+=step){const d=new Date(at+offset),date=(d.getUTCMonth()+1)+'/'+d.getUTCDate(),time=String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');ticks.push({at,label:step>=DAY?date:date+' '+time});}
 return ticks;
}
export function equityValueScale(points,range){
 const all=orderedEquityPoints(points),visible=all.filter((p,i)=>p.at>=range.from&&p.at<=range.to||p.at<range.from&&all[i+1]?.at>=range.from||p.at>range.to&&all[i-1]?.at<=range.to),values=visible.flatMap(p=>[p.wallet,p.equity].filter(valid));
 if(!values.length)return {min:0,max:1,ticks:[0,.25,.5,.75,1]};
 const low=Math.min(...values),high=Math.max(...values),span=Math.max(high-low,Math.abs(high)*.05,1),desired=span/4,power=10**Math.floor(Math.log10(desired)),step=[1,2,2.5,5,10].map(v=>v*power).find(v=>v>=desired)||10*power,min=Math.floor((low-span*.08)/step)*step,max=Math.ceil((high+span*.08)/step)*step,ticks=[];
 for(let value=min;value<=max+step*.1&&ticks.length<15;value+=step)ticks.push(number(value));return {min,max,ticks};
}
export function savedEquityView(value){
 if(!value||!['all','detail','manual'].includes(value.mode))return null;
 if(value.mode!=='manual')return {mode:value.mode};
 if(!valid(value.range?.from)||!valid(value.range?.to)||value.range.from<=0||value.range.to-value.range.from<1000||value.range.to-value.range.from>100*365*DAY)return null;
 return {mode:'manual',range:{from:value.range.from,to:value.range.to}};
}
export class EquityTimeChart{
 constructor(host,{onHover=()=>{},onView=()=>{}}={}){
  this.host=host;this.onHover=onHover;this.onView=onView;this.points=[];this.range=null;this.mode='all';this.drag=null;this.id='equity-time-'+(++instance);this.events=new AbortController();
  this.svg=document.createElementNS(NS,'svg');this.svg.setAttribute('role','img');this.svg.setAttribute('aria-label','계좌 추이 · 실제 한국시간 간격 · 드래그 이동, 더하기·빼기로 확대');this.svg.classList.add('equity-time-chart');host.replaceChildren(this.svg);host.tabIndex=0;
  const listen=(name,fn,options={})=>host.addEventListener(name,fn,{...options,signal:this.events.signal});
  listen('pointerdown',event=>{if(event.button!==0)return;this.drag={x:event.clientX,y:event.clientY,range:this.range&&{...this.range},moved:false};try{host.setPointerCapture(event.pointerId);}catch{}});
  listen('pointermove',event=>{if(this.drag?.range){const delta=event.clientX-this.drag.x;if(Math.abs(delta)>4&&Math.abs(delta)>=Math.abs(event.clientY-this.drag.y))this.drag.moved=true;if(this.drag.moved){const shift=-delta/this.plotWidth*(this.drag.range.to-this.drag.range.from);this.changeRange({from:this.drag.range.from+shift,to:this.drag.range.to+shift});return;}}if(event.pointerType!=='touch')this.hover(event);});
  listen('pointerup',event=>{const moved=this.drag?.moved;this.drag=null;if(!moved)this.hover(event);});listen('pointercancel',()=>{this.drag=null;this.onHover(null);});listen('pointerleave',()=>{if(!this.drag)this.onHover(null);});
  listen('wheel',event=>{if(!this.range)return;const box=host.getBoundingClientRect(),x=event.clientX-box.left;if(x<12||x>this.width-70)return;event.preventDefault();this.zoom(Math.exp(Math.max(-1,Math.min(1,event.deltaY*.002))),Math.max(0,Math.min(1,(x-12)/this.plotWidth)));},{passive:false});
  listen('keydown',event=>{if(event.key==='+'||event.key==='='){event.preventDefault();this.zoom(.65);}else if(event.key==='-'){event.preventDefault();this.zoom(1.5);}else if(event.key==='Home'){event.preventDefault();this.fitContent();}else if(['ArrowLeft','ArrowRight'].includes(event.key)&&this.range){event.preventDefault();const shift=(this.range.to-this.range.from)*.2*(event.key==='ArrowLeft'?-1:1);this.changeRange({from:this.range.from+shift,to:this.range.to+shift});}});
  this.observer=new ResizeObserver(()=>this.render());this.observer.observe(host);
 }
 setData(points,{fit=false,view=null}={}){
  const oldLast=this.points.at(-1)?.at;this.points=orderedEquityPoints(points);
  if(view){const saved=savedEquityView(view);if(saved){this.mode=saved.mode;this.range=saved.range||null;}}
  if(fit&&!view)this.mode='all';
  if(this.mode!=='manual'||!this.range)this.range=(equityRange(this.points,this.mode==='detail'?'detail':'all')||equityRange(this.points));
  // Explicit manual ranges use absolute timestamps and remain unchanged on refresh.
  this.render();if(oldLast!==this.points.at(-1)?.at)this.onHover(null);
 }
 fitContent(mode='all'){this.mode=mode==='detail'?'detail':'all';this.range=equityRange(this.points,this.mode)||equityRange(this.points);this.render();this.notify();}
 changeRange(range){if(!valid(range.from)||!valid(range.to)||range.to-range.from<1000)return;this.mode='manual';this.range=range;this.render();this.onHover(null);this.notify();}
 zoom(factor,anchor=.5){if(!this.range)return;const span=Math.max(5000,Math.min(100*365*DAY,(this.range.to-this.range.from)*factor)),at=this.range.from+(this.range.to-this.range.from)*anchor;this.changeRange({from:at-span*anchor,to:at+span*(1-anchor)});}
 notify(){this.onView(this.view());}
 view(){return this.mode==='manual'?{mode:'manual',range:{...this.range}}:{mode:this.mode};}
 hover(event){
  if(!this.range||!this.points.length)return;const box=this.host.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;if(x<12||x>this.width-70||y<12||y>this.height-38){this.onHover(null);return;}
  const time=this.range.from+(x-12)/this.plotWidth*(this.range.to-this.range.from);let lo=0,hi=this.points.length;while(lo<hi){const middle=(lo+hi)>>1;if(this.points[middle].at<time)lo=middle+1;else hi=middle;}
  const a=this.points[Math.max(0,lo-1)],b=this.points[Math.min(this.points.length-1,lo)],point=Math.abs(a.at-time)<=Math.abs(b.at-time)?a:b;
  if(point.at<this.range.from||point.at>this.range.to){this.onHover(null);return;}
  this.onHover({point,x:12+elapsedPosition(point.at,this.range,this.plotWidth),y});
 }
 render(){
  this.width=Math.max(160,this.host.clientWidth||640);this.height=Math.max(140,this.host.clientHeight||280);this.plotWidth=this.width-82;const bottom=this.height-38,top=14,plotHeight=bottom-top,range=this.range;
  this.svg.setAttribute('viewBox','0 0 '+this.width+' '+this.height);if(!range||!this.points.length){this.svg.replaceChildren();return;}
  const scale=equityValueScale(this.points,range),x=at=>12+elapsedPosition(at,range,this.plotWidth),y=value=>bottom-(value-scale.min)/(scale.max-scale.min)*plotHeight;
  const visible=segment=>segment.filter((p,i)=>p.at>=range.from&&p.at<=range.to||p.at<range.from&&segment[i+1]?.at>=range.from||p.at>range.to&&segment[i-1]?.at<=range.to),path=segment=>visible(segment).map((p,i)=>(i?'L':'M')+number(x(p.at))+','+number(y(p.value))).join(' ');
  const wallet=equitySegments(this.points,'wallet').map(s=>s.map(p=>({...p,value:p.wallet}))),equity=equitySegments(this.points,'equity').map(s=>s.map(p=>({...p,value:p.equity})));
  let markup='<defs><clipPath id="'+this.id+'"><rect x="12" y="'+top+'" width="'+this.plotWidth+'" height="'+plotHeight+'"/></clipPath><linearGradient id="'+this.id+'-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e7cf8c" stop-opacity=".35"/><stop offset="100%" stop-color="#e7cf8c" stop-opacity=".03"/></linearGradient></defs>';
  for(const value of scale.ticks)markup+='<line x1="12" x2="'+(this.width-70)+'" y1="'+number(y(value))+'" y2="'+number(y(value))+'" stroke="#edf1ee"/><text x="'+(this.width-62)+'" y="'+number(y(value)+4)+'" fill="#7c8b80" font-size="11">'+money(value)+'</text>';
  for(const tick of equityTimeTicks(range,Math.max(2,Math.floor(this.plotWidth/135))))markup+='<line x1="'+number(x(tick.at))+'" x2="'+number(x(tick.at))+'" y1="'+top+'" y2="'+bottom+'" stroke="#f0f3f0"/><text text-anchor="middle" x="'+number(x(tick.at))+'" y="'+(this.height-14)+'" fill="#7c8b80" font-size="10">'+tick.label+'</text>';
  markup+='<g clip-path="url(#'+this.id+')">';
  for(const s of equity){const v=visible(s),d=path(s);if(v.length>1)markup+='<path d="'+d+' L'+number(x(v.at(-1).at))+','+bottom+' L'+number(x(v[0].at))+','+bottom+' Z" fill="url(#'+this.id+'-fill)"/>';if(d)markup+='<path d="'+d+'" fill="none" stroke="#bd9843" stroke-width="2"/>';}
  for(const s of wallet){const d=path(s),daily=source(s[0])==='daily';if(d)markup+='<path d="'+d+'" fill="none" stroke="#4d8fa4" stroke-width="2"'+(daily?' stroke-dasharray="5 5"':'')+'/>';}
  for(const p of this.points)if(p.at>=range.from&&p.at<=range.to){if(source(p)==='daily'&&valid(p.wallet))markup+='<circle cx="'+number(x(p.at))+'" cy="'+number(y(p.wallet))+'" r="3.5" fill="#4d8fa4" stroke="#fff"/>';if(p.gapBefore&&valid(p.equity))markup+='<circle cx="'+number(x(p.at))+'" cy="'+number(y(p.equity))+'" r="3" fill="#9ca69d"/>';}
  if(![...equity,...wallet].some(segment=>visible(segment).length))markup+='<text x="'+number(12+this.plotWidth/2)+'" y="'+number(top+plotHeight/2)+'" text-anchor="middle" fill="#8b9a8b" font-size="12">이 구간에는 저장된 기록이 없습니다</text>';
  markup+='</g><line x1="12" x2="'+(this.width-70)+'" y1="'+bottom+'" y2="'+bottom+'" stroke="#e0e7e1"/>';
  this.svg.innerHTML=markup;
 }
 destroy(){this.events.abort();this.observer.disconnect();this.host.replaceChildren();this.onHover(null);}
}
