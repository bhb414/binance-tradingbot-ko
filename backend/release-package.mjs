import {createHash} from 'node:crypto';
import {inflateRawSync,crc32} from 'node:zlib';
import {safeSourcePath,protectedSourcePath} from './source-package.mjs';
export const RELEASE_PREFIX='https://github.com/bhb414/binance-tradingbot-ko/releases/download/';
export const packageName=version=>{if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('정식 릴리즈 버전을 확인해 주세요.');return 'binance-tradingbot-ko-v'+version+'-windows.zip';};
const hash=data=>createHash('sha256').update(data).digest('hex');
export function validReleasePath(file){return safeSourcePath(file)&&file.length<=500&&!protectedSourcePath(file)&&!protectedSourcePath(file+'/')&&file.split('/').every(part=>!/[. ]$/.test(part)&&!/^\s/.test(part)&&!/[<>"|?*\x01-\x1f]/.test(part)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)&&!/^\.git(?:$|-bootstrap-)/i.test(part));}
export function readSourceZip(zip,{maxFiles=5000,maxBytes=128*1024*1024,maxEntry=16*1024*1024}={}){
 if(!Buffer.isBuffer(zip)||zip.length<22)throw Error('릴리즈 ZIP 형식을 확인하지 못했습니다.');
 let end=zip.length-22;for(;end>=Math.max(0,zip.length-65557);end--)if(zip.readUInt32LE(end)===0x06054b50&&end+22+zip.readUInt16LE(end+20)===zip.length)break;
 if(end<Math.max(0,zip.length-65557))throw Error('ZIP 끝 정보를 확인하지 못했습니다.');
 const count=zip.readUInt16LE(end+10),offset=zip.readUInt32LE(end+16),size=zip.readUInt32LE(end+12);
 if(zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6)||zip.readUInt16LE(end+8)!==count||!count||count>maxFiles||offset+size!==end)throw Error('지원하지 않는 ZIP 구조입니다.');
 let at=offset,total=0;const files=new Map(),names=new Set(),folders=new Set(),ranges=[];
 for(let i=0;i<count;i++){
  if(at+46>offset+size||zip.readUInt32LE(at)!==0x02014b50)throw Error('ZIP 파일 목록이 손상되었습니다.');
  const flags=zip.readUInt16LE(at+8),method=zip.readUInt16LE(at+10),crc=zip.readUInt32LE(at+16),compressed=zip.readUInt32LE(at+20),expanded=zip.readUInt32LE(at+24),length=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32),local=zip.readUInt32LE(at+42),mode=(zip.readUInt32LE(at+38)>>>16)&0xf000;
  if(at+46+length+extra+comment>offset+size||zip.readUInt16LE(at+34)||flags&1||![0,8].includes(method)||![0,0x8000,0x4000].includes(mode))throw Error('암호화·링크 또는 지원하지 않는 ZIP 항목입니다.');
  const bytes=zip.subarray(at+46,at+46+length),name=bytes.toString('utf8');if(!Buffer.from(name).equals(bytes)||!name.startsWith('binance-tradingbot-ko/'))throw Error('공식 배포 폴더가 아닌 ZIP 항목입니다.');
  const directory=name.endsWith('/'),file=name.slice('binance-tradingbot-ko/'.length).replace(/\/$/,'');
  if((!directory&&!file)||(file&&!validReleasePath(file)))throw Error('배포 파일 경로를 사용할 수 없습니다: '+file);
  if((directory&&mode===0x8000)||(!directory&&mode===0x4000))throw Error('ZIP 파일 종류가 올바르지 않습니다.');
  if(local+30>offset||zip.readUInt32LE(local)!==0x04034b50||zip.readUInt16LE(local+6)!==flags||zip.readUInt16LE(local+8)!==method)throw Error('ZIP 로컬 항목이 손상되었습니다.');
  const localName=zip.readUInt16LE(local+26),localExtra=zip.readUInt16LE(local+28),dataAt=local+30+localName+localExtra;
  if(!zip.subarray(local+30,local+30+localName).equals(bytes)||dataAt+compressed>offset)throw Error('ZIP 로컬 경로 또는 크기가 올바르지 않습니다.');
  if(!(flags&8)&&(zip.readUInt32LE(local+14)!==crc||zip.readUInt32LE(local+18)!==compressed||zip.readUInt32LE(local+22)!==expanded))throw Error('ZIP 크기 정보가 일치하지 않습니다.');
  ranges.push([local,dataAt+compressed]);
  if(directory){if(expanded||compressed&&method===0)throw Error('ZIP 폴더에 데이터가 들어 있습니다.');if(file)folders.add(file.toLowerCase());}
  else{
   const key=file.toLowerCase();if(names.has(key))throw Error('중복된 배포 경로입니다: '+file);names.add(key);
   total+=expanded;if(expanded>maxEntry||total>maxBytes)throw Error('배포 파일 압축 해제 크기가 제한을 초과했습니다.');
   let contents;try{contents=method===0?zip.subarray(dataAt,dataAt+compressed):inflateRawSync(zip.subarray(dataAt,dataAt+compressed),{maxOutputLength:Math.min(maxEntry,expanded+1)});}catch{throw Error('ZIP 압축 데이터가 손상되었습니다.');}
   if(contents.length!==expanded||crc32(contents)!==crc)throw Error('ZIP 파일 무결성 확인에 실패했습니다: '+file);files.set(file,Buffer.from(contents));
  }
  at+=46+length+extra+comment;
 }
 if(at!==offset+size)throw Error('ZIP 목록 크기가 일치하지 않습니다.');ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])throw Error('ZIP 항목 범위가 겹칩니다.');
 for(const file of names){if(folders.has(file))throw Error('파일과 폴더 경로가 충돌합니다.');const parts=file.split('/');for(let n=1;n<parts.length;n++)if(names.has(parts.slice(0,n).join('/')))throw Error('파일 경로가 충돌합니다.');}
 if(!files.size)throw Error('배포 ZIP에 파일이 없습니다.');return files;
}
async function download(url,{fetchImpl,maxBytes,timeoutMs}){
 let next=url;
 for(let redirects=0;redirects<=5;redirects++){
  const parsed=new URL(next);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port&&!['443'].includes(parsed.port)||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'].includes(parsed.hostname))throw Error('공식 GitHub 다운로드 주소가 아닙니다.');
  let response;try{response=await fetchImpl(next,{headers:{'User-Agent':'binance-tradingbot-ko-updater'},redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}catch{throw Error('업데이트 파일 다운로드에 실패했습니다. 인터넷 연결을 확인해 주세요.');}
  if([301,302,303,307,308].includes(response.status)){const location=response.headers?.get('location');if(!location)throw Error('다운로드 이동 주소가 없습니다.');next=new URL(location,next).href;await response.body?.cancel?.();continue;}
  if(!response.ok)throw Error('업데이트 파일을 받지 못했습니다 (HTTP '+response.status+').');
  if(Number(response.headers?.get('content-length'))>maxBytes)throw Error('업데이트 다운로드 크기가 제한을 초과했습니다.');
  const chunks=[];let size=0;
  if(response.body){for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw Error('업데이트 다운로드 크기가 제한을 초과했습니다.');chunks.push(Buffer.from(chunk));}}
  else{const data=Buffer.from(await response.arrayBuffer());if(data.length>maxBytes)throw Error('업데이트 다운로드 크기가 제한을 초과했습니다.');chunks.push(data);}
  return Buffer.concat(chunks);
 }
 throw Error('다운로드 이동 횟수가 너무 많습니다.');
}
export async function downloadReleasePackage(version,{fetchImpl=globalThis.fetch,timeoutMs=30000,maxDownload=32*1024*1024}={}){
 const name=packageName(version),base=RELEASE_PREFIX+'v'+version+'/',options={fetchImpl,timeoutMs};
 const checksum=(await download(base+'SHA256SUMS.txt',{...options,maxBytes:64*1024})).toString('utf8').replace(/^\uFEFF/,'');
 const matches=checksum.split(/\r?\n/).map(line=>/^([a-f0-9]{64}) [ *](.+)$/i.exec(line)).filter(match=>match&&match[2]===name);if(matches.length!==1)throw Error('릴리즈 체크섬을 확인하지 못했습니다.');
 const zip=await download(base+name,{...options,maxBytes:maxDownload}),sha256=hash(zip);if(sha256!==matches[0][1].toLowerCase())throw Error('다운로드 파일 체크섬이 다릅니다. 기존 버전을 유지합니다.');
 const files=readSourceZip(zip);let pkg;try{pkg=JSON.parse(files.get('package.json')?.toString('utf8'));}catch{}
 if(pkg?.name!=='binance-tradingbot-ko'||pkg.version!==version||pkg.type!=='module')throw Error('릴리즈의 프로그램·버전 정보가 일치하지 않습니다.');
 for(const file of ['server.mjs','run.cmd','update.cmd','tools/update.mjs','public/index.html','public/app.js'])if(!files.has(file))throw Error('릴리즈 필수 파일이 없습니다: '+file);
 if(Object.keys(pkg.dependencies||{}).length||Object.keys(pkg.devDependencies||{}).length)throw Error('추가 설치가 필요한 버전입니다. 설치 안내를 확인해 주세요.');
 return {version,sha256,files};
}
