import {readFile,writeFile,readdir} from 'node:fs/promises';
const origin='http://127.0.0.1:4320';
const {csrf}=await(await fetch(origin+'/api/bootstrap')).json();
const headers={Cookie:'lecture_session='+csrf,'X-Lecture-Token':csrf};
const request=async(url,body)=>{const response=await fetch(origin+'/api'+url,{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));return result;};
const documents=[];
for(const name of await readdir('output/pointer-check/chapters')){
 const data=new FormData();data.append('file',new Blob([await readFile('output/pointer-check/chapters/'+name)]),name);
 const response=await fetch(origin+'/api/documents',{method:'POST',headers,body:data});if(!response.ok)throw Error(await response.text());documents.push(await response.json());
}
const scan='60e505755ee57c213ef451d4960006987caee620099b2dab5c922b369da015b3';
const course=await request('/courses',{name:'跨章节与扫描页 · 验收',documentIds:[...documents.map(d=>d.id),scan]});
await writeFile('output/pointer-check/course.json',JSON.stringify({course,documents},null,2));
console.log({courseId:course.id,documents:documents.map(d=>({id:d.id,name:d.name})),totalPages:5});
