import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {git,repositoryInfo} from '../backend/app-update.mjs';
import {protectedSourcePath,safeSourcePath} from '../backend/source-package.mjs';
export async function packageRelease(root,{outDirectory=path.join(root,'dist')}={}){
 const repo=await repositoryInfo(root);if(await git(root,['status','--porcelain','--untracked-files=normal']))throw Error('커밋되지 않은 파일이 있어 배포를 중단합니다.');
 const files=(await git(root,['ls-files','-z'])).split('\0').filter(Boolean);
 if(!files.length||files.some(file=>!safeSourcePath(file)||protectedSourcePath(file)))throw Error('비공개 파일 또는 잘못된 배포 경로가 포함되어 있습니다.');
 for(const file of files){
  const data=await readFile(path.join(root,file));if(data.includes(0))continue;const source=data.toString('utf8');
  if(/(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(source)||/(?:apiKey|secret)\s*[:=]\s*['"][A-Za-z0-9]{40,}['"]/.test(source))throw Error('비밀정보로 의심되는 내용: '+file);
 }
 const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));await mkdir(outDirectory,{recursive:true});
 const name='binance-tradingbot-ko-v'+pkg.version+'-windows.zip',filename=path.resolve(outDirectory,name);
 await git(root,['archive','--format=zip','--prefix=binance-tradingbot-ko/','--output='+filename,repo.revision]);
 const digest=createHash('sha256').update(await readFile(filename)).digest('hex');await writeFile(path.join(outDirectory,'SHA256SUMS.txt'),digest+'  '+name+'\n');
 return {version:pkg.version,revision:repo.revision,filename,sha256:digest,files:files.length};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{console.log(JSON.stringify(await packageRelease(fileURLToPath(new URL('../',import.meta.url))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
