import http from 'k6/http';
import exec from 'k6/execution';
import { Rate, Trend, Counter } from 'k6/metrics';
import { TARGET, QUERIES, LIMITS, selectWorkload, assertRequest, validateAuth, caseFor, variablesFor, responseOK } from './workload.js';

const inspection = __ENV.INSPECT_ONLY === '1';
if (__ENV.K6_HTTP_DEBUG) throw new Error('HTTP_DEBUG_FORBIDDEN');
const auth = inspection ? null : JSON.parse(open(__ENV.PROTECTED_CONFIG));
if (!inspection) validateAuth(auth);
const unexpected = new Rate('unexpected_failure');
const semantic = new Rate('semantic_failure');
const totalTime = new Trend('total_request_ms',true);
const starts = new Counter('target_request_started');
let initialized=false;
export const options = {
  scenarios: { bounded: {
    executor:'ramping-arrival-rate',startRate:1,timeUnit:'1s',preAllocatedVUs:5,maxVUs:10,
    stages:[{duration:'120s',target:1},{duration:'1s',target:3},{duration:'119s',target:3},{duration:'1s',target:5},{duration:'179s',target:5},{duration:'1s',target:1},{duration:'59s',target:1}],
    gracefulStop:'5s',
  }},
  thresholds:{
    unexpected_failure:[{threshold:'rate<=0.01',abortOnFail:true,delayAbortEval:'30s'}],
    total_request_ms:[{threshold:'p(95)<=2000',abortOnFail:true,delayAbortEval:'30s'}],
    dropped_iterations:['count==0'],
  },
  maxRedirects:0,userAgent:'HealthPay-approved-bounded-loadtest/2026-10-27',
  summaryTrendStats:['avg','min','med','max','p(95)','p(99)'],
};
export default function(){
  if (inspection) throw new Error('INSPECTION_CANNOT_SEND_TRAFFIC');
  const iteration=exec.scenario.iterationInTest;
  const kind=selectWorkload(iteration), q=QUERIES[kind];
  assertRequest(auth.target,kind,q);
  if (!initialized){
    const jar=http.cookieJar();Object.keys(auth.cookies).forEach(k=>jar.set(TARGET, k, auth.cookies[k]));initialized=true;
  }
  const c=caseFor(kind,iteration,auth.fixture);
  const elapsed=exec.instance.currentTestRunDuration/1000;
  const phase=elapsed<120?'1rps_warm':elapsed<240?'3rps':elapsed<420?'5rps':'1rps_cool';
  const tags={kind,phase};
  const permit=http.get('http://127.0.0.1:9189/grant',{timeout:'3s',tags:{kind:'local_budget_control',scope:'generator'}});
  if (permit.status!==200) exec.test.abort('LOCAL_BUDGET_GATE_UNAVAILABLE');
  starts.add(1,tags);
  const before=Date.now();
  const r=http.post(TARGET+'/api/graphql',JSON.stringify({query:q,variables:variablesFor(kind,c,auth.fixture)}),{headers:{...auth.headers,'Content-Type':'application/json'},timeout:'3s',redirects:0,tags});
  let body=null;try{body=r.json();}catch(_e){}
  const ok=r.status===200 && responseOK(kind,body,c,auth.fixture);
  const duration=Date.now()-before;
  unexpected.add(!ok,tags);semantic.add(!ok,tags);totalTime.add(duration,tags);
}
export function handleSummary(data){
  const file=__ENV.SUMMARY_FILE || 'bounded-summary.json';
  return {[file]:JSON.stringify(data,null,2)};
}
