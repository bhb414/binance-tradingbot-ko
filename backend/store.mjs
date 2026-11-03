import { mkdir, readFile, open, rename } from 'node:fs/promises';
import path from 'node:path';
export const emptyState=()=>({version:2,environment:'live',scope:null,orderPermission:null,nextIntent:1,bots:[],orders:[],fills:[],logs:[]});
export class StateStore {
  constructor(directory){this.directory=path.resolve(directory);this.filename=path.join(this.directory,'state.json');this.state=emptyState();this.tail=Promise.resolve();}
  async load(){await mkdir(this.directory,{recursive:true});try{const parsed=JSON.parse(await readFile(this.filename,'utf8'));if(parsed.version!==2||!['testnet','live'].includes(parsed.environment)||!Array.isArray(parsed.bots)||!Array.isArray(parsed.orders)||!Array.isArray(parsed.fills)||!Array.isArray(parsed.logs))throw new Error('저장된 실행 원장 형식을 확인해 주세요. 원본 파일은 보존했습니다.');this.state=parsed;}catch(e){if(e.code!=='ENOENT')throw e;}return this.state;}
  async save(){const serialized=JSON.stringify(this.state);const run=async()=>{const temp=this.filename+'.tmp';const file=await open(temp,'w',0o600);try{await file.writeFile(serialized,'utf8');await file.sync();}finally{await file.close();}await rename(temp,this.filename);};const result=this.tail.then(run,run);this.tail=result.catch(()=>{});return result;}
}
