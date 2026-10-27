import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
const source=fs.readFileSync(new URL('./workload.js',import.meta.url),'utf8');
const w=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const [privateFile,resultFile]=process.argv.slice(2);
const auth=JSON.parse(fs.readFileSync(privateFile,'utf8'));w.validateAuth(auth);
const headers={...auth.headers,'Content-Type':'application/json','Cookie':Object.entries(auth.cookies).map(([k,v])=>`${k}=${v}`).join('; ')};
const cases=[['health',0],['validity',0],['validity',20],['validity',40],['validity',60],['validity',80],['beneficiary',0],['beneficiary',20],['policy',0],['location',0],['controls',0]];
const results=[];
for (const [kind,id] of cases){
 const c=w.caseFor(kind,id,auth.fixture);w.assertRequest(auth.target,kind,w.QUERIES[kind]);let body=null,status=0;
 const before=performance.now();
 try{const r=await fetch(auth.target+'/api/graphql',{method:'POST',headers,body:JSON.stringify({query:w.QUERIES[kind],variables:w.variablesFor(kind,c,auth.fixture)}),redirect:'error',signal:AbortSignal.timeout(10000)});status=r.status;body=await r.json();}catch(_e){}
 const pass=status===200 && w.responseOK(kind,body,c,auth.fixture);
 results.push({kind,variant:id,status,pass,duration_ms:Math.round(performance.now()-before),graphql_error_count:body && body.errors ? body.errors.length : 0});
 if(!pass){fs.writeFileSync(resultFile,JSON.stringify({success:false,results},null,2)+'\n');console.log('QUERY_PREFLIGHT_FAILED',kind,status);process.exit(1);}
 await new Promise(r=>setTimeout(r,1000));
}
fs.writeFileSync(resultFile,JSON.stringify({success:true,business_mutation:false,request_count:results.length,results},null,2)+'\n');
console.log('QUERY_PREFLIGHT_PASS',results.length,'bounded reads; no response bodies stored');
