import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new DatabaseSync('data/library.sqlite',{readOnly:true});
const backup=new DatabaseSync('output/backups/library-before-powerpointer.sqlite',{readOnly:true});
const id='09ed7c60-298e-4faf-90c5-9e5827d8811b';
const turns=db.prepare("select body from records where kind='turn'").all().map(r=>JSON.parse(r.body)).filter(t=>t.conversationId===id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
assert.equal(turns.length,5);assert.ok(turns.every(t=>t.state==='completed'));
assert.deepEqual(turns.map(t=>[t.model,t.reasoningEffort]),[['gpt-6.1-sol','low'],['gpt-6-luna','medium'],['gpt-6-luna','medium'],['gpt-6.1-sol','medium'],['gpt-6-luna','low']]);
assert.equal(turns[1].snapshot.replyTurnId,turns[0].id);assert.equal(turns[1].snapshot.page,54);
assert.equal(turns[3].snapshot.replyTurnId,turns[1].id);assert.equal(turns[3].snapshot.page,84);
assert.ok(turns[2].tools.some(t=>t.title==='搜索网页'&&t.state==='completed'));assert.ok(turns[2].tools.some(t=>t.title==='查阅网页'&&t.state==='completed'));
assert.ok(turns[3].tools.some(t=>t.kind==='course'&&t.detail.includes('84、87')&&t.state==='completed'));
assert.deepEqual(turns[3].toolSources.filter(s=>s.image).map(s=>s.page).sort((a,b)=>a-b),[84,87]);assert.ok(!turns[3].tools.some(t=>t.kind==='web'));
assert.equal(turns[4].snapshot.page,75);assert.equal(turns[4].snapshot.images.length,2);assert.ok(turns[4].snapshot.rect);assert.equal(turns[4].snapshot.agentTools,false);assert.equal(turns[4].snapshot.webSearch,false);assert.equal(turns[4].tools?.length||0,0);
const sources=new Map(turns.flatMap(t=>[...t.snapshot.sources,...t.toolSources||[]]).map(s=>[s.id,s]));let citations=0;
for(const t of turns)for(const m of t.answer.matchAll(/\]\(source:([^\s)]+)\)/g)){assert.ok(sources.has(m[1]),'unresolved source '+m[1]);citations++;}
const old=backup.prepare("select kind,id,body from records where kind in ('turn','conversation')").all();for(const row of old){assert.equal(db.prepare('select body from records where kind=? and id=?').get(row.kind,row.id)?.body,row.body,'changed prior '+row.kind+' '+row.id);}
const summary={conversationId:id,turnCount:turns.length,modelSettings:turns.map(t=>({model:t.model,effort:t.reasoningEffort,page:t.snapshot.page,toolCount:t.tools?.length||0})),validCitations:citations,replyAnchors:true,crossPageImages:[84,87],webSearchAndOpen:true,cropImages:2,priorConversationsUnchanged:old.filter(r=>r.kind==='conversation').length,priorTurnsUnchanged:old.filter(r=>r.kind==='turn').length,passed:true};
writeFileSync('output/user-course-check/session.json',JSON.stringify({conversationId:id,turns},null,2));writeFileSync('output/user-course-check/assertions.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));db.close();backup.close();
