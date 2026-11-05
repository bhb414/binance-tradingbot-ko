import {createHash} from 'node:crypto';
import {crc32,deflateRawSync} from 'node:zlib';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {packageName,RELEASE_PREFIX} from '../../backend/release-package.mjs';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function zipFiles(entries,{method=8}={}){
 const locals=[],central=[];let offset=0;
 for(const item of entries){const entry=Array.isArray(item)?{name:'binance-tradingbot-ko/'+item[0],data:item[1]}:item;
  const name=Buffer.from(entry.name),data=Buffer.from(entry.data||''),packed=method===8?deflateRawSync(data):data,crc=crc32(data),local=Buffer.alloc(30),dir=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(0x314,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(0x800,8);dir.writeUInt16LE(method,10);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(packed.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(name.length,28);dir.writeUInt32LE(((entry.mode||0x81a4)*65536)>>>0,38);dir.writeUInt32LE(offset,42);
  locals.push(local,name,packed);central.push(dir,name);offset+=local.length+name.length+packed.length;
 }
 const listing=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(listing.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,listing,end]);
}
export function sources(version,extra={}){return new Map(Object.entries({
 'package.json':JSON.stringify({name:'binance-tradingbot-ko',version,type:'module'}),
 'server.mjs':'export function createServer(){}\n','run.cmd':'@echo off\r\nnode server.mjs\r\n','update.cmd':'@echo off\r\nnode tools/update.mjs --pause\r\n',
 'tools/update.mjs':'export const fixture=true;\n','public/index.html':'<html></html>\n','public/app.js':'export const version='+JSON.stringify(version)+';\n',...extra
}).map(([name,data])=>[name,Buffer.from(data)]));}
export async function materialize(root,files){for(const [name,data]of files){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),data);}}
export function releaseFetch(packages){return async(url,options)=>{
 if(options.redirect!=='manual')throw Error('expected manual redirects');
 for(const [version,zip]of packages){const base=RELEASE_PREFIX+'v'+version+'/';if(url===base+'SHA256SUMS.txt')return new Response(digest(zip)+'  '+packageName(version)+'\n');if(url===base+packageName(version))return new Response(zip);}
 throw Error('Unexpected URL: '+url);
};}
export async function fixture(run){const root=await mkdtemp(path.join(os.tmpdir(),'fw-zip-update-'));try{await run(root);}finally{const safe=path.resolve(root);if(!safe.startsWith(path.resolve(os.tmpdir())+path.sep+'fw-zip-update-'))throw Error('Unsafe test cleanup');await rm(safe,{recursive:true,force:true,maxRetries:3});}}
export function updates(old=sources('1.0.0'),next=sources('1.1.0')){return {old,next,options:{dataDirectory:null,port:0,onProgress(){},checkRelease:async()=>({version:'1.0.0',latest:'1.1.0',available:true,downloadUrl:RELEASE_PREFIX+'v1.1.0/'+packageName('1.1.0')}),fetchImpl:releaseFetch(new Map([['1.0.0',zipFiles([...old])],['1.1.0',zipFiles([...next])]]))}};}
