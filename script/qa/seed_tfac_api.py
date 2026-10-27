#!/usr/bin/env python3
"""TFAC QA catalog setup through supported GraphQL; no SQL or ORM writes.
Default: read-only dry-run. Every creation requires trusted server QA configuration,
the exact authorization document SHA, fixture whitelist, journal success=2, and readback.
No mutation replay on unknown outcomes. Application images and role assignments unchanged.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid
from qa_api import QAApi
from fixture_policy import AUTH_SHA, require_qa, validate_fixture, require_match, mutation_complete
from input_contract import validate_input_fields

ROOT = Path(__file__).parent
KEY = '/home/ubuntu/healthpay-delivery/HealthPay-Live-Server-SSH-PRIVATE-KEY'
SSH = ['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-i',KEY,'root@157.230.96.251']
BE = 'registry.digitalocean.com/healthpay-payer/backend@sha256:fa08084e6f449283eee0779ee2ef5edf47a326c27d2980e7750a7266a5fcfcae'
FE = 'registry.digitalocean.com/healthpay-payer/frontend@sha256:66413a309e7c0d2ad04cf58a5bf112a831fb7ef971144c7faf7fa17446b8362d'

def numeric_id(value):
    if str(value).isdigit(): return int(value)
    return int(base64.b64decode(value).decode().rsplit(':',1)[1])

def trusted_preflight():
    script = """from django.conf import settings
import json
print('QA_TRUST_BEGIN')
print(json.dumps({'environment':getattr(settings,'HEALTHPAY_DEPLOYMENT_ENV','production'),'qa_token_configured':bool(getattr(settings,'HEALTHPAY_QA_AUTHORIZATION',None)),'database':settings.DATABASES['default']['NAME']}))
print('QA_TRUST_END')
"""
    out = subprocess.run(SSH+['cd /opt/healthpay/healthpay-dist_dkr;docker compose -f compose.healthpay.yml exec -T backend python manage.py shell'],input=script,text=True,capture_output=True,check=True).stdout
    trust = json.loads(out.split('QA_TRUST_BEGIN\n')[1].split('\nQA_TRUST_END')[0])
    require_qa(trust, AUTH_SHA)
    out = subprocess.run(SSH+['cd /opt/healthpay/healthpay-dist_dkr;docker compose -f compose.healthpay.yml ps --format "{{.Image}}"'],text=True,capture_output=True,check=True).stdout
    if BE not in out or FE not in out: raise RuntimeError('Verified immutable QA images changed; stop for revalidation')
    return trust

SERVICE = 'id uuid code name type level packagetype price careType category patientCategory validityTo'
PRICELIST = 'id uuid name pricelistDate validityTo details { edges { node { service { uuid code } priceOverrule } } }'
FACILITY = 'id uuid code name level careType status validityTo legalForm { code } location { id uuid code } servicesPricelist { id uuid }'
PRODUCT = 'id uuid code name dateFrom dateTo insurancePeriod maxMembers lumpSum ceiling ceilingType ceilingInterpretation deductible gracePeriodEnrolment gracePeriodPayment gracePeriodRenewal validityTo services { edges { node { service { uuid code } priceOrigin limitationType limitationTypeR limitationTypeE limitAdult limitAdultR limitAdultE limitChild limitChildR limitChildE waitingPeriodAdult waitingPeriodChild } } }'

class Runner:
    def __init__(self,args):
        self.args=args; self.fixture=json.loads((ROOT/'tfac-fixture.json').read_text());validate_fixture(self.fixture)
        if args.authorization_sha != AUTH_SHA: raise RuntimeError('Explicit document authorization SHA required')
        self.trust=trusted_preflight();self.api=QAApi();self.events=[];self.records={};self.output=Path(args.output)
        self.save()
    def save(self):
        r={'authorization_document_sha256':AUTH_SHA,'fixture_sha256':hashlib.sha256((ROOT/'tfac-fixture.json').read_bytes()).hexdigest(),'mode':'APPLY' if self.args.apply else 'DRY_RUN','trust':self.trust,'events':self.events,'records':self.records,'updated_at':datetime.now(timezone.utc).isoformat()}
        self.output.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
    def lookup(self,field,key,value,projection,history=True):
        q='query($value:String!){%s(%s:$value%s,first:20){edges{node{%s}}}}' % (field,key,',showHistory:true' if history else '',projection)
        rows=[e['node'] for e in self.api.call(q,{'value':value})[field]['edges']]
        if len(rows)>1: raise RuntimeError('Multiple current/historical rows for '+value+'; conflict stop')
        return rows[0] if rows else None
    def create(self,operation,input_type,data,label):
        if not self.args.apply: raise RuntimeError('Creation blocked in dry-run')
        cmid=str(uuid.uuid4());payload={**data,'clientMutationId':cmid,'clientMutationLabel':'TEST-TFAC '+label}
        contract=self.api.call('query($name:String!){__type(name:$name){inputFields{name type{kind name ofType{kind name ofType{kind name}}}}}}',{'name':input_type})
        validate_input_fields(contract['__type']['inputFields'],payload)
        event={'operation':operation,'clientMutationId':cmid,'input':payload,'outcome':'SUBMITTING'};self.events.append(event);self.save()
        q='mutation($input:%s!){%s(input:$input){clientMutationId internalId}}' % (input_type,operation)
        event['response']=self.api.call(q,{'input':payload},allowed_mutation=operation);event['outcome']='ACKNOWLEDGED';self.save()
        logq='query($cmid:String!){mutationLogs(clientMutationId:$cmid){edges{node{id status error clientMutationId requestDateTime clientMutationLabel}}}}'
        deadline=time.monotonic()+120
        while time.monotonic()<deadline:
            logs=self.api.call(logq,{'cmid':cmid})['mutationLogs']['edges']
            if len(logs)>1: raise RuntimeError('Duplicate audit correlation key; stop')
            if logs:
                event['mutationLog']=logs[0]['node'];self.save()
                if mutation_complete(event['mutationLog']): event['outcome']='SUCCESS';self.save();return
            time.sleep(2)
        event['outcome']='UNKNOWN_DO_NOT_REPLAY';self.save();raise RuntimeError('Mutation completion timeout; reconcile audit and exact code before retry')
    def ensure(self,label,field,key,value,projection,expected,input_type,operation,payload):
        row=self.lookup(field,key,value,projection)
        if row:
            require_match(row,expected)
            if row.get('validityTo') is not None:raise RuntimeError('Historical record conflicts; no reactivation')
            self.events.append({'operation':'EXACT_MATCH_SKIP','entity':label,'key':value});self.records[label]=row;self.save();return row
        if not self.args.apply:
            self.events.append({'operation':'WOULD_CREATE','entity':label,'key':value});self.save();return None
        self.create(operation,input_type,payload,value)
        row=self.lookup(field,key,value,projection)
        if row is None:raise RuntimeError('Successful log without entity readback')
        require_match(row,expected)
        self.records[label]=row;self.save();print('QA_CREATE_READBACK_PASS',label,value,flush=True);return row
    def run(self):
        f=self.fixture
        # Validate real source P-codes with the existing supported location query.
        locs={}
        for code in sorted(set(x['locationPcode'] for x in f['facilities'])):
            row=self.lookup('locations','code',code,'id uuid code name type parent {code type parent {code type}}',history=False)
            if row is None or row['type']!='V':raise RuntimeError('Approved active V location absent')
            locs[code]=row
        self.records['locations']=locs;self.save()
        service=self.ensure('service','medicalServices','code',f['service']['code'],SERVICE,f['service'],'CreateServiceMutationInput','createService',f['service'])
        p=f['servicePricelist'];existing=self.lookup('servicesPricelists','name',p['name'],PRICELIST)
        if not service and not self.args.apply:
            self.events.append({'operation':'WOULD_CREATE','entity':'servicePricelist','key':p['name']});pricelist=None
        else:
            inp={'name':p['name'],'pricelistDate':p['pricelistDate'],'addedDetails':[service['uuid']],'priceOverrules':[{'uuid':service['uuid'],'price':p['price']}]}
            pricelist=self.ensure('servicePricelist','servicesPricelists','name',p['name'],PRICELIST,{'name':p['name'],'pricelistDate':p['pricelistDate']},'CreateServicesPricelistMutationInput','createServicesPricelist',inp)
            if pricelist:
                details=pricelist['details']['edges'];
                if len(details)!=1 or details[0]['node']['service']['uuid']!=service['uuid'] or details[0]['node']['priceOverrule']!=p['price']:raise RuntimeError('Price-list linkage/amount readback mismatch')
        for facility in f['facilities']:
            payload={k:v for k,v in facility.items() if k!='locationPcode'}
            payload['locationId']=numeric_id(locs[facility['locationPcode']]['id'])
            if pricelist:payload['servicesPricelistId']=numeric_id(pricelist['id'])
            row=self.ensure(facility['code'],'healthFacilities','code',facility['code'],FACILITY,{'code':facility['code'],'name':facility['name'],'level':facility['level'],'careType':facility['careType'],'status':facility['status']},'CreateHealthFacilityMutationInput','createHealthFacility',payload)
            if row:
                if row['location']['code']!=facility['locationPcode'] or row['legalForm']['code']!=facility['legalFormId'] or not row['servicesPricelist'] or row['servicesPricelist']['uuid']!=pricelist['uuid']:raise RuntimeError('Facility links/parent contract mismatch')
        product=f['product'];payload=dict(product)
        if service:payload['services']=[{'serviceUuid':service['uuid'],**f['serviceBenefit']}]
        row=self.ensure('product','products','code',product['code'],PRODUCT,product,'CreateProductMutationInput','createProduct',payload)
        if row and service:
            linked=row['services']['edges']
            if len(linked)!=1 or linked[0]['node']['service']['uuid']!=service['uuid']:raise RuntimeError('Product service benefit link mismatch')
            require_match(linked[0]['node'],f['serviceBenefit'])
        self.save();print('QA_CATALOG_PHASE_COMPLETED',self.args.apply,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--authorization-sha',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    runner=Runner(a)
    try:runner.run()
    except Exception as e:
        runner.events.append({'operation':'STOP','error':str(e)});runner.save();raise
