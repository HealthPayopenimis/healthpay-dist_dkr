"""Source-controlled QA fixtures loaded through Django's supported loaddata.
No raw SQL/ad hoc model writes, no login, role changes or running-source patches.
Default dry-run. All keys/relationships are exact whitelisted synthetic records.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
from django.apps import apps
from django.conf import settings
from django.core.management import call_command
from django.db import transaction
from django.core import serializers
from core.models import User
from fixture_policy import AUTH_SHA, require_qa, validate_fixture, require_match

root=Path(os.environ.get('HP_QA_FIXTURE_DIRECTORY','/tmp/healthpay-issue38-source'))
fixture=json.loads((root/'tfac-fixture.json').read_text());validate_fixture(fixture)
trust={'environment':getattr(settings,'HEALTHPAY_DEPLOYMENT_ENV','production'),'qa_token_configured':bool(getattr(settings,'HEALTHPAY_QA_AUTHORIZATION',None)),'database':settings.DATABASES['default']['NAME']}
require_qa(trust,os.environ.get('HP_QA_AUTHORIZATION_SHA'))
operator=User.objects.get(username='hpadmin')
if not operator.is_imis_admin or not operator.is_active:raise RuntimeError('Approved active QA administrator required')
facility=apps.get_model('location.HealthFacility').objects.get(code='TFAC001',validity_to__isnull=True)
if not facility.name.startswith('TEST-FAC-001'):raise RuntimeError('Synthetic TFAC marker missing')
village=apps.get_model('location.Location').objects.get(code='EG010901',type='V',validity_to__isnull=True)
if village.parent.code!='EG0109' or village.parent.type!='D':raise RuntimeError('Source D/V location contract changed')
objects=[
 {'model':'medical.diagnosis','fields':{'code':'TDX001','name':fixture['diagnosis']['name'],'audit_user_id':operator.id_for_audit}},
 {'model':'core.claimadmin','fields':{'code':'TESTTFAC','last_name':fixture['claimAdmin']['lastName'],'other_names':fixture['claimAdmin']['otherNames'],'health_facility':facility.pk,'has_login':False,'audit_user_id':operator.id_for_audit}},
 {'model':'core.officer','fields':{'code':'TFACOFF','last_name':fixture['enrolmentOfficer']['lastName'],'other_names':fixture['enrolmentOfficer']['otherNames'],'location':village.parent_id,'has_login':False,'audit_user_id':operator.id_for_audit}}
]
report={'authorization_document_sha256':AUTH_SHA,'fixture_sha256':hashlib.sha256((root/'tfac-fixture.json').read_bytes()).hexdigest(),'operator':operator.username,'audit_user_id':operator.id_for_audit,'environment':trust['environment'],'mode':'DRY_RUN','events':[],'timestamp':datetime.now(timezone.utc).isoformat()}
apply=os.environ.get('HP_QA_FIXTURE_APPLY')=='yes'

def validate_new(obj):
    candidate=list(serializers.deserialize('json',json.dumps([obj])))[0].object
    omitted=[f.name for f in candidate._meta.fields if f.null and getattr(candidate,f.attname) is None]
    candidate.full_clean(exclude=omitted)

def load_supported_fixture(objs):
    if not objs:return
    with tempfile.NamedTemporaryFile(mode='w',suffix='.json',delete=False) as fh:
        json.dump(objs,fh,ensure_ascii=False);path=fh.name
    try:call_command('loaddata',path,verbosity=0)
    finally:Path(path).unlink(missing_ok=True)

with transaction.atomic():
    new=[]
    for obj in objects:
        model=apps.get_model(obj['model']);rows=list(model.objects.filter(code=obj['fields']['code']))
        if len(rows)>1:raise RuntimeError('Ambiguous/historical synthetic code conflict')
        if rows:
            current=rows[0]
            if current.validity_to is not None:raise RuntimeError('Historical fixture conflict; no reactivation')
            actual={k:(getattr(current,k+'_id') if k in ('health_facility','location') else getattr(current,k)) for k in obj['fields']}
            require_match(actual,obj['fields']);report['events'].append({'model':obj['model'],'code':current.code,'action':'EXACT_MATCH_SKIP','id':current.pk})
        else:
            validate_new(obj);new.append(obj);report['events'].append({'model':obj['model'],'code':obj['fields']['code'],'action':'WOULD_CREATE'})
    if apply:
        report['mode']='APPLY';load_supported_fixture(new)
        for event in report['events']:
            current=apps.get_model(event['model']).objects.get(code=event['code'],validity_to__isnull=True)
            event['id']=current.pk;event['audit_user_id']=current.audit_user_id
            if event['action']=='WOULD_CREATE':event['action']='CREATED_BY_DJANGO_FIXTURE'
    officer=apps.get_model('core.Officer').objects.filter(code='TFACOFF',validity_to__isnull=True).first()
    if officer:
        model=apps.get_model('location.OfficerVillage');rows=list(model.objects.filter(officer=officer,location=village))
        if len(rows)>1 or (rows and rows[0].validity_to is not None):raise RuntimeError('Synthetic officer catchment conflict')
        if rows:
            if rows[0].audit_user_id!=operator.id_for_audit:raise RuntimeError('Officer catchment audit conflict')
            report['events'].append({'model':'location.officervillage','action':'EXACT_MATCH_SKIP','id':rows[0].pk,'officer_code':'TFACOFF','location_code':'EG010901'})
        else:
            obj={'model':'location.officervillage','fields':{'officer':officer.pk,'location':village.pk,'audit_user_id':operator.id_for_audit}}
            validate_new(obj)
            if apply:
                load_supported_fixture([obj]);new_row=model.objects.get(officer=officer,location=village,validity_to__isnull=True)
                report['events'].append({'model':'location.officervillage','action':'CREATED_BY_DJANGO_FIXTURE','id':new_row.pk,'officer_code':'TFACOFF','location_code':'EG010901'})
            else:report['events'].append({'model':'location.officervillage','action':'WOULD_CREATE','officer_code':'TFACOFF','location_code':'EG010901'})
    else:
        report['events'].append({'model':'location.officervillage','action':'WOULD_CREATE_AFTER_OFFICER','officer_code':'TFACOFF','location_code':'EG010901'})
print('TFAC_REFERENCE_FIXTURE_BEGIN');print(json.dumps(report,ensure_ascii=False,sort_keys=True));print('TFAC_REFERENCE_FIXTURE_END')
