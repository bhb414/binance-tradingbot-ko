const cleanPath=value=>typeof value==='string'&&/^\/[A-Za-z0-9_./-]{1,119}$/.test(value)?value:'[path]';
export class RequestUsage{
 constructor(now){this.now=now;this.minutes=new Map();this.lastWait=null;}
 bucket(){const at=Math.floor(this.now()/60000)*60000;if(!this.minutes.has(at))this.minutes.set(at,{at,rows:new Map(),denied:0});for(const key of this.minutes.keys())if(key<at-120000)this.minutes.delete(key);return this.minutes.get(at);}
 key(source,method,endpoint){return {source:['trading','market'].includes(source)?source:'other',method:['GET','POST','PUT','DELETE'].includes(method)?method:'OTHER',endpoint:cleanPath(endpoint)};}
 sent(source,method,endpoint,weight){const bucket=this.bucket(),fields=this.key(source,method,endpoint),key=JSON.stringify(fields),row=bucket.rows.get(key)||{...fields,requests:0,weight:0};row.requests++;row.weight+=weight;bucket.rows.set(key,row);}
 deferred(fields,count=true){const bucket=this.bucket();if(count)bucket.denied++;const {source,method,endpoint}=this.key(fields.source,fields.method,fields.endpoint);this.lastWait={at:this.now(),origin:fields.origin,scope:fields.scope,retryAt:fields.retryAt,usedWeight:fields.usedWeight,ceiling:fields.ceiling,source,method,endpoint};}
 view(at){const bucket=this.minutes.get(at);if(!bucket)return null;const endpoints=[...bucket.rows.values()].map(row=>({...row})).sort((a,b)=>b.weight-a.weight||a.endpoint.localeCompare(b.endpoint));return {at,requests:endpoints.reduce((n,r)=>n+r.requests,0),weight:endpoints.reduce((n,r)=>n+r.weight,0),denied:bucket.denied,endpoints};}
 snapshot(){const current=this.bucket();return {currentMinute:this.view(current.at),previousMinute:this.view(current.at-60000),lastWait:this.lastWait?{...this.lastWait}:null};}
}
