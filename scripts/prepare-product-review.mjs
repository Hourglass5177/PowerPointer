import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const target='output/product-review-20261021';
if(existsSync(target)) throw Error('Review directory already exists');
mkdirSync(target,{recursive:true});
const original=new DatabaseSync('data/library.sqlite',{readOnly:true});
await backup(original,path.join(target,'library.sqlite')); original.close();
const clone=new DatabaseSync(path.join(target,'library.sqlite'));
const records=kind=>clone.prepare('SELECT body FROM records WHERE kind=?').all(kind).map(r=>JSON.parse(r.body));
for(const course of records('course')) {
  course.root=undefined;
  clone.prepare('UPDATE records SET body=? WHERE kind=? AND id=?').run(JSON.stringify(course),'course',course.id);
}
console.log(JSON.stringify({courses:records('course').map(c=>({id:c.id,name:c.name,documents:c.documentIds.length})),documents:records('document').length,conversations:records('conversation').length,turns:records('turn').length,knowledge:records('knowledge').map(k=>({state:k.state,total:k.total,pages:k.pages.length}))}));
clone.close();
for(const folder of ['pdfs','attachments']) {
  mkdirSync(path.join(target,folder),{recursive:true});
  for(const file of readdirSync(path.join('data',folder),{withFileTypes:true}))
    if(file.isFile()) copyFileSync(path.join('data',folder,file.name),path.join(target,folder,file.name));
}
