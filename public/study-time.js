import {chartIntervalSeconds} from './chart-timeframes.js';
export function studyTimeAt(raw,index,interval='1m'){
 if(index<0||!raw.length)return null;if(index<raw.length)return raw[index].time;
 const last=raw.at(-1).time,n=index-raw.length+1;if(interval==='1M'){const d=new Date(last*1000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1)/1000;}
 const seconds=chartIntervalSeconds(interval);return seconds>0?last+n*seconds:null;
}
export function shiftStudyPoints(values,raw,offset=0,interval='1m'){
 return values.flatMap((value,i)=>{const time=studyTimeAt(raw,i+offset,interval);return time===null?[]:[{time,...(Number.isFinite(value)?{value}:{})}];});
}
export function projectStudyPoints(values,raw,{horizon=3,slopeBars=3,lag=1,interval='1m'}={}){
 const index=raw.length-1-lag,base=values[index],before=values[index-slopeBars];if(!Number.isFinite(base)||!Number.isFinite(before))return {data:[],slope:null,base:null,index};
 const slope=(base-before)/slopeBars,data=Array.from({length:horizon+1},(_,i)=>({time:studyTimeAt(raw,index+i,interval),value:base+slope*i}));return {data,slope,base,index};
}

