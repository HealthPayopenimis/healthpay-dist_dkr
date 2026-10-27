#!/usr/bin/env python3
"""Two auth requests + one exact fixture read; private output is never logged."""
from pathlib import Path
import argparse, json, sys, os
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'qa'))
from qa_api import QAApi
TARGET='https://inspayer.healthpay.tech'
QUERY='''query LoadSetup($a:String!,$b:String!){original:insurees(chfId:$a,ignoreLocation:true,first:1){edges{node{uuid family{uuid}}}}tfac:insurees(chfId:$b,ignoreLocation:true,first:1){edges{node{uuid family{uuid}}}}district:locations(code:"EG0109",first:1){edges{node{uuid}}}policy:policies(uuid:"7ce8d48b-5fbf-4481-8b78-8dec1837f86e",first:1){edges{node{status}}}}'''
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args();out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.parent.chmod(0o700)
 api=QAApi();d=api.call(QUERY,{'a':'29001011234567','b':'29001010190019'})
 def one(name):
  e=d[name]['edges'];assert len(e)==1,'EXACT_FIXTURE_MISSING';return e[0]['node']
 original=one('original');tfac=one('tfac');district=one('district')
 assert original['family']['uuid']=='e456ef2f-6a84-4408-ad3d-3ab2e90d30bf' and tfac['uuid']=='fa1c296d-3f39-4892-a48f-7458d630afb6' and tfac['family']['uuid']=='e2034a66-3efe-4cd5-93bf-733e89ad7202','FIXTURE_IDENTITY_MISMATCH'
 f={'original':{'number':'29001011234567','uuid':original['uuid'],'family':original['family']['uuid']},'tfac':{'number':'29001010190019','uuid':tfac['uuid'],'family':tfac['family']['uuid']},'district':district['uuid'],'policy':'7ce8d48b-5fbf-4481-8b78-8dec1837f86e','policyStatus':one('policy')['status']}
 private={'target':TARGET,'actor':'hpadmin','headers':api.headers,'cookies':api.session.cookies.get_dict(),'fixture':f}
 fd=os.open(str(out),os.O_CREAT|os.O_TRUNC|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as h:json.dump(private,h);h.write('\n')
 print('PROTECTED_SETUP_READY; auth_requests=2; fixture_query=1; values withheld')
if __name__=='__main__':
 try:main()
 except Exception:
  print('PROTECTED_SETUP_FAILED; no secret response emitted',file=sys.stderr);sys.exit(1)
