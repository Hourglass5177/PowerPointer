import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:17317/api',{csrf}=await(await fetch(base+'/bootstrap')).json(), headers={'content-type':'application/json',cookie:`lecture_session=${csrf}`,'x-lecture-token':csrf};
async function api(url,body){const r=await fetch(base+url,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;}
const r=JSON.parse(readFileSync('output/chat-check/real-agent.json','utf8')),c=await api(`/documents/${r.documentId}/conversations`,{}),result={date:new Date().toISOString()};
const t=await api('/turns',{requestId:randomUUID(),question:'请简要解释导数为何是切线斜率，并引用本页。',snapshot:{...r.turns[0].snapshot,conversationId:c.id,images:undefined,sources:undefined,agentTools:false,webSearch:false,reasoningEffort:'high',model:'gpt-6-luna'}});
async function state(id,cid){return(await api(`/conversations/${cid}/turns`)).find(t=>t.id===id);}
for(let i=0;i<100;i++){const v=await state(t.id,c.id);if(v.state==='generating')break;if(v.state==='failed')throw Error(v.error);await new Promise(r=>setTimeout(r,100));}
await api(`/turns/${t.id}/stop`,{});
for(let i=0;i<100;i++){const v=await state(t.id,c.id);if(!['preparing','generating'].includes(v.state)){result.stopped=v;break;}await new Promise(r=>setTimeout(r,100));}assert.equal(result.stopped.state,'stopped');
const retried=await api(`/turns/${t.id}/retry`,{requestId:randomUUID()});assert.notEqual(retried.conversationId,c.id);
for(let i=0;i<150;i++){const v=await state(retried.id,retried.conversationId);if(!['preparing','generating'].includes(v.state)){result.retried=v;break;}await new Promise(r=>setTimeout(r,1000));}
writeFileSync('output/chat-check/stop-retry.json',JSON.stringify(result,null,2));assert.equal(result.retried.state,'completed');assert.equal((await state(t.id,c.id)).state,'stopped');console.log({stopped:true,retryInBranch:true,originalPreserved:true});
