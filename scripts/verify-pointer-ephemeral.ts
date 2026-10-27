import {Codex} from "../server/codex.ts";
import {writeFileSync,mkdirSync} from "node:fs";
import path from "node:path";
const dir=path.resolve("output/pointer-check/ephemeral-probe");
const first=new Codex(dir,{ephemeral:true,agentTools:false,webSearch:false});
let threadId="",model="";
try{const models=await first.models();model=models.find(m=>m.isDefault)!.model;threadId=await first.thread(model,undefined,{ephemeral:true,agentTools:false,webSearch:false});}
finally{await first.shutdown();}
const second=new Codex(dir);let error="";
try{await second.thread(model,threadId,{agentTools:false,webSearch:false});throw Error("Ephemeral thread unexpectedly persisted");}
catch(e){error=(e as Error).message;if(!/not found|no rollout|does not exist|ephemeral/i.test(error)||error.includes("unexpectedly"))throw e;}
finally{await second.shutdown();}
mkdirSync("output/pointer-check",{recursive:true});
writeFileSync("output/pointer-check/ephemeral.json",JSON.stringify({threadId,missingAfterShutdown:true,error,modelCalls:0},null,2));
console.log({missingAfterShutdown:true,error,modelCalls:0});
