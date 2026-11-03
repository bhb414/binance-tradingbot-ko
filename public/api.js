let session;
async function token(){session||=fetch('/api/session',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('로컬 서버 연결을 확인해 주세요.');return (await r.json()).token;}).catch(e=>{session=null;throw e;});return session;}
export async function api(path,{method='GET',body}={}){
  const response=await fetch('/api'+path,{method,cache:'no-store',headers:{'X-Workroom-Token':await token(),...(method!=='GET'?{'Content-Type':'application/json'}:{})},...(method!=='GET'?{body:JSON.stringify(body??{})}:{})});
  const data=await response.json();if(response.status===401&&location.pathname!=='/pair.html'){session=null;location.replace('/pair.html');}if(!response.ok){if(response.status===403)session=null;throw new Error(data.error||'요청을 처리하지 못했습니다.');}return data;
}
