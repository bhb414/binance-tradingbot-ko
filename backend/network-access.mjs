import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {randomBytes,randomInt,createHmac,timingSafeEqual} from 'node:crypto';

const lifetime=30*86400000;
const ipv4=text=>{const parts=String(text).replace(/^::ffff:/,'').split('.');return parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255)?parts.reduce((n,p)=>(n*256+Number(p))>>>0,0):null;};
export const loopback=address=>address==='::1'||((ipv4(address)??0)>>>24)===127;
const privateIP=address=>{const n=ipv4(address);return n!==null&&(n>>>24===10||n>>>20===0xac1||n>>>16===0xc0a8);};
export function lanInterfaces(interfaces=os.networkInterfaces()){
  return Object.entries(interfaces).flatMap(([name,rows])=>/vethernet|vmware|virtualbox|loopback|docker|wsl|tailscale|zerotier/i.test(name)?[]:(rows||[]).filter(r=>!r.internal&&(r.family==='IPv4'||r.family===4)&&privateIP(r.address)&&ipv4(r.netmask)!==null&&ipv4(r.netmask)!==0).map(r=>({name,address:r.address,netmask:r.netmask}))).filter((row,i,rows)=>rows.findIndex(r=>r.address===row.address)===i);
}
export class NetworkAccess{
  constructor(directory,{interfaces=os.networkInterfaces,now=Date.now,listener=handler=>http.createServer(handler)}={}){
    this.filename=directory?path.join(directory,'network.json'):null;this.interfaces=interfaces;this.now=now;this.listener=listener;
    this.config={enabled:false,secret:randomBytes(32).toString('hex')};this.code=String(randomInt(100000,1000000));this.listeners=new Map();this.attempts={at:0,count:0};this.tail=Promise.resolve();this.error=null;this.closed=false;
  }
  async init(){if(this.filename)try{const value=JSON.parse(await readFile(this.filename,'utf8'));if(typeof value.enabled!=='boolean'||!/^[a-f0-9]{64}$/.test(value.secret))throw Error('접속 설정 파일 형식을 확인하세요.');this.config=value;}catch(error){if(error.code!=='ENOENT')this.error='접속 설정을 읽지 못해 같은 Wi-Fi 접속을 껐습니다.';}return this;}
  serial(action){const result=this.tail.then(action,action);this.tail=result.catch(()=>{});return result;}
  candidates(){return lanInterfaces(this.interfaces());}
  local(req){return loopback(req.socket.remoteAddress);}
  allowed(req,port){
    if(this.local(req))return new Set(['localhost:'+port,'127.0.0.1:'+port]).has(req.headers.host);
    if(!this.config.enabled)return false;
    const address=String(req.socket.localAddress||'').replace(/^::ffff:/,''),row=this.candidates().find(r=>r.address===address),remote=ipv4(req.socket.remoteAddress),mask=row&&ipv4(row.netmask);
    return !!row&&this.listeners.has(address)&&req.headers.host===address+':'+port&&privateIP(req.socket.remoteAddress)&&remote!==null&&((remote&mask)>>>0)===((ipv4(address)&mask)>>>0);
  }
  validOrigin(req){
    if(req.headers['sec-fetch-site']==='cross-site')return false;
    if(!req.headers.origin)return true;
    try{const origin=new URL(req.headers.origin);return origin.protocol==='http:'&&origin.host===req.headers.host;}catch{return false;}
  }
  signature(value){return createHmac('sha256',this.config.secret).update(value).digest('hex');}
  authenticated(req){
    const raw=String(req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith('workroom_lan='))?.slice(13)||'';
    const match=/^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(raw);if(!match)return false;
    const issued=Number(match[1]);if(issued>this.now()+60000||this.now()-issued>lifetime)return false;
    return timingSafeEqual(Buffer.from(match[3]),Buffer.from(this.signature(match[1]+'.'+match[2])));
  }
  pair(value){
    if(!this.config.enabled)throw Object.assign(Error('이 PC에서 같은 Wi-Fi 접속을 먼저 켜세요.'),{httpStatus:403});
    const now=this.now();if(now-this.attempts.at>=60000)this.attempts={at:now,count:0};
    if(this.attempts.count>=5)throw Object.assign(Error('입력 시도가 많습니다. 1분 후 다시 시도하세요.'),{httpStatus:429});
    this.attempts.count++;
    if(typeof value!=='string'||!/^\d{6}$/.test(value)||!timingSafeEqual(Buffer.from(value),Buffer.from(this.code)))throw Object.assign(Error('서버 PC 설정에 표시된 6자리 코드를 확인하세요.'),{httpStatus:401});
    const payload=now+'.'+randomBytes(16).toString('hex');
    return 'workroom_lan='+payload+'.'+this.signature(payload)+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000';
  }
  async persist(config){
    if(!this.filename)return;
    await mkdir(path.dirname(this.filename),{recursive:true});
    const temp=this.filename+'.tmp';await writeFile(temp,JSON.stringify(config),{mode:0o600});await rename(temp,this.filename);
  }
  async bind(port,handler){
    const added=[];
    for(const row of this.candidates()){
      if(this.listeners.has(row.address))continue;
      const listener=this.listener(handler);
      try{await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(port,row.address,resolve);});listener.on('error',()=>{this.error='접속 주소를 열지 못했습니다. 이 PC의 네트워크 연결을 확인하세요.';});this.listeners.set(row.address,listener);added.push(row.address);}
      catch{listener.close();this.error='일부 접속 주소를 열지 못했습니다. 네트워크·포트 사용 상태를 확인하세요.';}
    }
    return added;
  }
  async closeAddresses(addresses){for(const address of addresses){const listener=this.listeners.get(address);if(!listener)continue;this.listeners.delete(address);listener.closeAllConnections?.();await new Promise(resolve=>listener.close(()=>resolve()));}}
  async start(server){this.server=server;this.port=server.address().port;this.handler=(req,res)=>server.emit('request',req,res);if(this.config.enabled)await this.refresh();}
  async refresh(){return this.serial(async()=>{if(!this.server||this.closed)return;const wanted=new Set(this.candidates().map(r=>r.address));await this.closeAddresses([...this.listeners.keys()].filter(ip=>!this.config.enabled||!wanted.has(ip)));if(this.config.enabled)await this.bind(this.port,this.handler);});}
  async setEnabled(enabled){
    if(typeof enabled!=='boolean')throw Error('같은 Wi-Fi 접속을 켜짐 또는 꺼짐으로 지정하세요.');
    return this.serial(async()=>{
      if(this.closed||!this.server)throw Error('서버가 시작 중입니다. 잠시 후 다시 시도하세요.');
      if(this.config.enabled===enabled)return this.view(true);
      const next={enabled,secret:randomBytes(32).toString('hex')};let added=[];
      this.error=null;
      if(enabled){added=await this.bind(this.port,this.handler);if(!this.listeners.size)throw Error(this.error||'같은 Wi-Fi에서 사용할 PC 주소가 없습니다. 네트워크 연결을 확인하세요.');}
      try{await this.persist(next);}catch{await this.closeAddresses(added);throw Error('접속 설정을 저장하지 못했습니다. 기존 설정을 유지합니다.');}
      this.config=next;this.code=String(randomInt(100000,1000000));this.attempts={at:0,count:0};
      if(!enabled)await this.closeAddresses([...this.listeners.keys()]);
      return this.view(true);
    });
  }
  view(local){
    return {enabled:this.config.enabled,local,available:this.candidates().length>0,urls:[...this.listeners.keys()].map(ip=>'http://'+ip+':'+this.port),code:local&&this.config.enabled?this.code:null,error:this.error};
  }
  async close(){this.closed=true;await this.tail;await this.closeAddresses([...this.listeners.keys()]);}
}
