const unref=timer=>{timer?.unref?.();return timer;};
export class UserStream{
 constructor(client,{WebSocketImpl=globalThis.WebSocket,now=Date.now}={}){this.client=client;this.WS=WebSocketImpl;this.now=now;this.status='idle';this.socket=null;this.revision=0;this.generation=0;this.attempt=0;this.lastEventAt=0;this.retryAt=0;this.closed=false;this.orders=new Map();this.events=new Map();}
 start(){if(this.closed||this.socket||this.starting||!this.WS)return;this.starting=true;const generation=++this.generation;this.status='connecting';
  (async()=>{try{const result=await this.client.listenKey();if(this.closed||generation!==this.generation)return;if(typeof result?.listenKey!=='string'||!result.listenKey)throw Error('user stream key unavailable');
   const socket=new this.WS('wss://fstream.binance.com/private/ws/'+encodeURIComponent(result.listenKey));this.socket=socket;const current=()=>!this.closed&&this.socket===socket&&this.generation===generation;
   this.connectTimer=unref(setTimeout(()=>{if(current()&&this.status==='connecting')socket.close();},15000));
   socket.addEventListener('open',()=>{if(!current())return;clearTimeout(this.connectTimer);this.status='connected';this.attempt=0;this.revision++;this.openedAt=this.now();this.keepalive=unref(setInterval(()=>this.renew(generation),25*60000));this.rotation=unref(setTimeout(()=>socket.close(),23*3600000));});
   socket.addEventListener('message',event=>{if(!current())return;try{const data=JSON.parse(String(event.data));if(data.e==='listenKeyExpired'){socket.close();return;}this.ingest(data);}catch{}});
   socket.addEventListener('error',()=>{if(current())socket.close();});socket.addEventListener('close',()=>{if(current())this.lost();});
  }catch{if(!this.closed&&generation===this.generation)this.lost();}finally{if(generation===this.generation)this.starting=false;}})();
 }
 ingest(data){if(!['ACCOUNT_UPDATE','ORDER_TRADE_UPDATE','ACCOUNT_CONFIG_UPDATE','ALGO_UPDATE','CONDITIONAL_ORDER_TRIGGER_REJECT','MARGIN_CALL','TRADE_LITE'].includes(data.e))return;const time=Number(data.E)||this.now(),key=data.e+':'+(data.o?.c||data.o?.i||'');if((this.events.get(key)||0)>time)return;this.events.set(key,time);this.lastEventAt=this.now();this.revision++;if(data.o?.c)this.orders.set(data.o.c,this.revision);if(this.events.size>2000)this.events.delete(this.events.keys().next().value);}
 async renew(generation){try{await this.client.keepListenKey();}catch{if(!this.closed&&generation===this.generation){this.socket?.close();if(!this.socket)this.lost();}}}
 lost(){clearTimeout(this.connectTimer);clearInterval(this.keepalive);clearTimeout(this.rotation);this.socket=null;this.starting=false;this.status='reconnecting';this.revision++;this.retryAt=this.now()+Math.min(60000,1000*2**Math.min(this.attempt++,6));clearTimeout(this.retryTimer);this.retryTimer=unref(setTimeout(()=>this.start(),Math.max(1,this.retryAt-this.now())));}
 view(){return {status:this.status,lastEventAt:this.lastEventAt,retryAt:this.retryAt};}
 close(){this.closed=true;this.generation++;this.starting=false;clearTimeout(this.retryTimer);clearTimeout(this.connectTimer);clearInterval(this.keepalive);clearTimeout(this.rotation);const socket=this.socket;this.socket=null;this.status='idle';socket?.close();}
}
