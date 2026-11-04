// One request at a time; urgent execution checks can pass queued report reads.
export const requestPriority=(method,endpoint,parameters={})=>{
 if(method!=='GET'||/\/(?:order|algoOrder|account|positionRisk|openOrders|openAlgoOrders|symbolConfig|leverageBracket)$/.test(endpoint)||endpoint.endsWith('/userTrades')&&parameters.fromId!==undefined)return 0;
 if(/\/(?:income|commissionRate|userTrades|positionSide\/dual)$/.test(endpoint))return 2;
 return 1;
};
export class RequestQueue{
 constructor({now=Date.now}={}){this.now=now;this.jobs=[];this.running=false;}
 enqueue(run,{priority=1,onTiming=()=>{}}={}){
  return new Promise((resolve,reject)=>{this.jobs.push({run,priority,resolve,reject,onTiming,queuedAt:this.now()});this.drain();});
 }
 async drain(){
  if(this.running)return;this.running=true;
  try{
   while(this.jobs.length){
    let index=0;for(let i=1;i<this.jobs.length;i++)if(this.jobs[i].priority<this.jobs[index].priority)index=i;
    const job=this.jobs.splice(index,1)[0],startedAt=this.now();let ok=false;
    try{const value=await job.run();ok=true;job.resolve(value);}catch(error){job.reject(error);}
    finally{try{job.onTiming({priority:job.priority,queuedAt:job.queuedAt,startedAt,finishedAt:this.now(),queueMs:Math.max(0,startedAt-job.queuedAt),serviceMs:Math.max(0,this.now()-startedAt),ok});}catch{}}
   }
  }finally{this.running=false;}
 }
}
