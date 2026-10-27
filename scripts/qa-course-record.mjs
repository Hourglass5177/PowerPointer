import {DatabaseSync} from 'node:sqlite';import {writeFileSync,mkdirSync} from 'node:fs';
const db=new DatabaseSync('data/library.sqlite',{readOnly:true}), id='09ed7c60-298e-4faf-90c5-9e5827d8811b';
const turns=db.prepare("select body from records where kind='turn'").all().map(r=>JSON.parse(r.body)).filter(t=>t.conversationId===id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
mkdirSync('output/user-course-check',{recursive:true});writeFileSync('output/user-course-check/session.json',JSON.stringify({conversationId:id,turns},null,2));console.log(JSON.stringify(turns.map(t=>({id:t.id,state:t.state,question:t.question,model:t.model,effort:t.reasoningEffort,tools:t.tools,answer:t.answer,error:t.error})),null,2));db.close();
