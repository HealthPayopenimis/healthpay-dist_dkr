import http from 'k6/http';
import { Rate } from 'k6/metrics';
import { TARGET, QUERIES, validateAuth, responseOK, assertRequest } from './workload.js';
const auth=JSON.parse(open(__ENV.PROTECTED_CONFIG));validateAuth(auth);
const failed=new Rate('smoke_failed');
export const options={vus:1,iterations:1,maxRedirects:0,thresholds:{smoke_failed:['rate==0']}};
export default function(){
  assertRequest(TARGET,'health',QUERIES.health);
  const jar=http.cookieJar();Object.keys(auth.cookies).forEach(k=>jar.set(TARGET,k,auth.cookies[k]));
  const r=http.post(TARGET+'/api/graphql',JSON.stringify({query:QUERIES.health}),{headers:{...auth.headers,'Content-Type':'application/json'},timeout:'3s',redirects:0});
  let body=null;try{body=r.json();}catch(_e){}
  const ok=r.status===200 && responseOK('health',body,{},auth.fixture);failed.add(!ok);
  console.log('SMOKE_STATUS_ONLY',r.status,ok?'PASS':'FAIL');
}
