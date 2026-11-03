import { spawn } from 'node:child_process';
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const MAGIC=Buffer.from('FWC1');
const valid=value=>value&&['live','testnet'].includes(value.environment)&&['apiKey','secret'].every(key=>typeof value[key]==='string'&&value[key].length>=16&&value[key].length<=512);

// Secrets travel through private process pipes, never command arguments or plaintext files.
export function windowsProtect(operation,bytes){
  if(process.platform!=='win32')return Promise.reject(new Error('암호화 키 저장은 현재 Windows에서 지원합니다.'));
  if(!['Protect','Unprotect'].includes(operation))return Promise.reject(new Error('잘못된 암호화 작업입니다.'));
  const script=`$ErrorActionPreference='Stop'; try {
    Add-Type -AssemblyName System.Security;
    $workroomBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());
    $workroomEntropy=[Text.Encoding]::UTF8.GetBytes('FuturesWorkroom.credentials.v1');
    $workroomResult=[Security.Cryptography.ProtectedData]::${operation}($workroomBytes,$workroomEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);
    [Console]::Out.Write([Convert]::ToBase64String($workroomResult));
  } catch { exit 1 } finally {
    if($workroomBytes){[Array]::Clear($workroomBytes,0,$workroomBytes.Length)}
    if($workroomResult){[Array]::Clear($workroomResult,0,$workroomResult.Length)}
  }`;
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    let output='',settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(new Error('Windows 암호화 저장소를 사용할 수 없습니다.'));else resolve(result);};
    const timer=setTimeout(()=>{child.kill();finish(true);},15000);
    child.on('error',()=>finish(true));child.stdin.on('error',()=>finish(true));
    child.stdout.on('data',chunk=>{output+=chunk.toString('ascii');if(output.length>65536){child.kill();finish(true);}});
    child.on('close',code=>{const value=output.trim();if(code!==0||!value||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))finish(true);else finish(false,Buffer.from(value,'base64'));});
    child.stdin.end(bytes.toString('base64'));
  });
}

export class CredentialStore {
  constructor(directory,{protect=windowsProtect}={}){this.directory=path.resolve(directory);this.filename=path.join(this.directory,'credentials.dpapi');this.protect=protect;this.saved=false;}
  async load(){
    let encrypted;try{encrypted=await readFile(this.filename);}catch(error){if(error.code==='ENOENT'){this.saved=false;return null;}throw new Error('저장된 API 키 파일을 읽지 못했습니다.');}
    this.saved=true;let plaintext;
    try{
      if(encrypted.length>65536||!encrypted.subarray(0,4).equals(MAGIC))throw new Error();
      plaintext=await this.protect('Unprotect',encrypted.subarray(4));const value=JSON.parse(plaintext.toString('utf8'));
      if(value.version!==1||!valid(value))throw new Error();
      return {environment:value.environment,apiKey:value.apiKey,secret:value.secret};
    }catch{throw new Error('저장된 키를 복호화하지 못했습니다. 같은 Windows 사용자로 실행하거나 키를 다시 등록해 주세요.');}
    finally{plaintext?.fill(0);}
  }
  async save(credentials){
    if(!valid(credentials))throw new Error('저장할 API 키를 확인해 주세요.');
    const plaintext=Buffer.from(JSON.stringify({version:1,environment:credentials.environment,apiKey:credentials.apiKey,secret:credentials.secret}));
    const temporary=this.filename+'.'+randomUUID()+'.tmp';
    try{
      const encrypted=Buffer.concat([MAGIC,await this.protect('Protect',plaintext)]);
      await mkdir(this.directory,{recursive:true});const file=await open(temporary,'wx',0o600);
      try{await file.writeFile(encrypted);await file.sync();}finally{await file.close();}
      await rename(temporary,this.filename);this.saved=true;
    }catch{throw new Error('API 키를 암호화 저장하지 못했습니다. 연결 설정은 적용하지 않았습니다.');}
    finally{plaintext.fill(0);await unlink(temporary).catch(()=>{});}
  }
  async clear(){try{await unlink(this.filename);}catch(error){if(error.code!=='ENOENT')throw new Error('저장된 API 키를 삭제하지 못했습니다.');}this.saved=false;}
}
