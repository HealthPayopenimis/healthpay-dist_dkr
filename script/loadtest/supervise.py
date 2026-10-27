#!/usr/bin/env python3
"""Finite load supervision only; no service or app/database changes."""
from pathlib import Path
import argparse, collections, http.server, json, os, signal, subprocess, threading, time
ROOT=Path('/home/ubuntu/healthpay-loadtest-oct27')
KEY='/home/ubuntu/healthpay-delivery/HealthPay-Live-Server-SSH-PRIVATE-KEY'
HOST='157.230.96.251'
SSH=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','-i',KEY,'root@'+HOST]
class Budget:
 def __init__(self):self.lock=threading.Lock();self.last=0.;self.started=None;self.stopped=False;self.grants=[]
 def grant(self):
  with self.lock:
   if self.stopped or self.started is None:return False
   elapsed=time.monotonic()-self.started
   if elapsed>=480:return False
   rate=1 if elapsed<120 or elapsed>=420 else 3 if elapsed<240 else 5
   pause=max(0,self.last+1/rate+0.001-time.monotonic())
   if pause:time.sleep(pause)
   if self.stopped or time.monotonic()-self.started>=480:return False
   self.last=time.monotonic();self.grants.append(self.last-self.started);return True
budget=Budget()
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  ok=self.path=='/grant' and budget.grant();self.send_response(200 if ok else 409);self.end_headers();self.wfile.write(b'OK' if ok else b'STOP')
 def log_message(self,*args):pass

def percentile(xs,p):
 if not xs:return 0.
 vals=sorted(xs);idx=(len(vals)-1)*p;lo=int(idx);hi=min(lo+1,len(vals)-1);return vals[lo]+(vals[hi]-vals[lo])*(idx-lo)

def safety_abort(samples,now,elapsed,last_target,cpu_since,health_failures):
 if now-last_target>20:return 'TARGET_MONITOR_STALE'
 if cpu_since is not None and now-cpu_since>=30:return 'TARGET_CPU_SUSTAINED'
 if health_failures>=2:return 'TARGET_HEALTH_CONSECUTIVE_FAILURE'
 recent=[x for x in samples if now-x[0]<=30]
 errors=[x[2] for x in recent if x[1]=='unexpected_failure']
 durations=[x[2] for x in recent if x[1]=='total_request_ms']
 if elapsed>=30 and len(errors)>=10 and sum(errors)/len(errors)>.01:return 'ROLLING_UNEXPECTED_FAILURE'
 if elapsed>=30 and len(durations)>=10 and percentile(durations,.95)>2000:return 'ROLLING_P95_EXCEEDED'
 return None

def run():
 ROOT.mkdir(exist_ok=True)
 gate=json.loads((ROOT/'execution-gate.json').read_text())
 if not gate.get('smoke_passed') or not gate.get('functional_preflight_passed'):raise RuntimeError('LOAD_EXECUTION_GATE_CLOSED')
 state={'last_target':0.,'cpu_since':None,'health_failures':0,'target_abort':None};lock=threading.Lock()
 monitor_log=open(ROOT/'target-monitor.jsonl','w');error_log=open(ROOT/'target-monitor-stderr.log','w')
 remote="cd /opt/healthpay/healthpay-dist_dkr;docker compose -f compose.healthpay.yml exec -T backend python manage.py shell -c 'import sys;exec(compile(sys.stdin.read(),\"approved-target-sampler\",\"exec\"),{\"__name__\":\"__main__\"})'"
 mon=subprocess.Popen(SSH+[remote],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=error_log,text=True,bufsize=1)
 sampler=(Path(__file__).parent/'target_sampler.py').read_text();mon.stdin.write(sampler);mon.stdin.close()
 def consume():
  for line in mon.stdout:
   try:d=json.loads(line)
   except Exception:continue
   monitor_log.write(json.dumps(d)+'\n');monitor_log.flush()
   with lock:
    if d.get('event')=='ERROR':state['target_abort']='TARGET_MONITOR_ERROR'
    if 'cpu_percent' in d:
     now=time.monotonic();state['last_target']=now
     if d['cpu_percent']>85:state['cpu_since']=state['cpu_since'] or now
     else:state['cpu_since']=None
     if d['mem_available_ratio']<.10:state['target_abort']='TARGET_MEMORY_PRESSURE'
     if d['global_connection_count']>.8*d['max_connections']:state['target_abort']='TARGET_DATABASE_CONNECTION_PRESSURE'
 threading.Thread(target=consume,daemon=True).start()
 deadline=time.monotonic()+40
 while not state['last_target'] and not state['target_abort'] and time.monotonic()<deadline:time.sleep(.2)
 if not state['last_target'] or state['target_abort']:raise RuntimeError('TARGET_MONITOR_NOT_READY')
 httpd=http.server.ThreadingHTTPServer(('127.0.0.1',9189),Handler);threading.Thread(target=httpd.serve_forever,daemon=True).start()
 env={k:v for k,v in os.environ.items() if not k.startswith('K6_')};env.update({'PROTECTED_CONFIG':str(ROOT/'secure/setup.json'),'SUMMARY_FILE':str(ROOT/'k6-summary.json')})
 binary=ROOT/'tool/k6-v2.3.0-linux-amd64/k6';data=ROOT/'metrics.jsonl';console=open(ROOT/'k6-run.log','w')
 budget.started=time.monotonic();proc=subprocess.Popen([str(binary),'run','--no-color','--quiet','--out','json='+str(data),str(Path(__file__).parent/'bounded_readonly.js')],env=env,stdout=console,stderr=subprocess.STDOUT)
 metric_samples=collections.deque();stream=None;abort=None;generator=[];last_progress=0.
 try:
  while proc.poll() is None:
   now=time.monotonic();elapsed=now-budget.started
   if data.exists() and stream is None:stream=open(data)
   if stream:
    while True:
     position=stream.tell();line=stream.readline()
     if not line:break
     if not line.endswith('\n'):stream.seek(position);break
     try:d=json.loads(line)
     except Exception:continue
     if d.get('type')!='Point':continue
     name=d.get('metric');pt=d['data'];tags=pt.get('tags') or {}
     if name in ('unexpected_failure','total_request_ms'):metric_samples.append((now,name,float(pt['value'])))
     if name=='unexpected_failure' and tags.get('kind')=='health':
      with lock:state['health_failures']=state['health_failures']+1 if pt['value'] else 0
   while metric_samples and now-metric_samples[0][0]>35:metric_samples.popleft()
   with lock:abort=state['target_abort'] or safety_abort(metric_samples,now,elapsed,state['last_target'],state['cpu_since'],state['health_failures'])
   if elapsed>480:abort=abort or 'APPROVED_TIME_BOUND_REACHED'
   try:
    status=Path('/proc/'+str(proc.pid)+'/status').read_text();rss=int(next(x.split()[1] for x in status.splitlines() if x.startswith('VmRSS:')));generator.append({'elapsed_seconds':round(elapsed,2),'rss_kib':rss})
   except Exception:pass
   if elapsed-last_progress>=30:print('Load progress elapsed_seconds='+str(round(elapsed))+' budget_grants='+str(len(budget.grants)),flush=True);last_progress=elapsed
   if abort:
    budget.stopped=True;proc.send_signal(signal.SIGINT);break
   time.sleep(.25)
  try:proc.wait(timeout=8)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
 finally:
  budget.stopped=True;httpd.shutdown();console.close()
  if stream:stream.close()
  try:mon.wait(timeout=65)
  except subprocess.TimeoutExpired:mon.terminate()
  monitor_log.close();error_log.close();(ROOT/'secure/setup.json').unlink(missing_ok=True)
  (ROOT/'budget-grants.json').write_text(json.dumps(budget.grants)+'\n');(ROOT/'generator-resources.json').write_text(json.dumps(generator)+'\n')
  (ROOT/'supervisor-result.json').write_text(json.dumps({'k6_exit_code':proc.returncode,'stop_reason':abort,'elapsed_seconds':round(time.monotonic()-budget.started,2),'budget_grants':len(budget.grants),'business_mutation_submitted':False,'temporary_credentials_removed':not (ROOT/'secure/setup.json').exists()},indent=2)+'\n')
 print('Load supervisor complete; k6_exit='+str(proc.returncode)+' stop_reason='+str(abort),flush=True)
if __name__=='__main__':run()
