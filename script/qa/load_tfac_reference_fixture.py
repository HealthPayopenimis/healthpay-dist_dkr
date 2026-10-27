"""Run under manage.py shell with this source-controlled directory on sys.path.
Only Django's supported loaddata fixture loader writes. No raw SQL/ad hoc model saves,
no user creation, no role changes, no patches to running application source.
Default dry-run. QA/staging configuration and exact authorization SHA required.
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

root = Path(os.environ.get('HP_QA_FIXTURE_DIRECTORY','/tmp/healthpay-issue38-source'))
fixture = json.loads((root/'tfac-fixture.json').read_text())
validate_fixture(fixture)
trust={'environment':getattr(settings,'HEALTHPAY_DEPLOYMENT_ENV','production'),'qa_token_configured':bool(getattr(settings,'HEALTHPAY_QA_AUTHORIZATION',None)),'database':settings.DATABASES['default']['NAME']}
require_qa(trust, os.environ.get('HP_QA_AUTHORIZATION_SHA'))
operator=User.objects.get(username='hpadmin')
if not operator.is_imis_admin or not operator.is_active:
    raise RuntimeError('Fixture operator is not the approved active QA administrator')
facility=apps.get_model('location.HealthFacility').objects.get(code='TFAC001',validity_to__isnull=True)
if not facility.name.startswith('TEST-FAC-001'):
    raise RuntimeError('New TFAC facility marker missing')
objects = [
 {'model':'medical.diagnosis','fields':{'code':fixture['diagnosis']['code'],'name':fixture['diagnosis']['name'],'audit_user_id':operator.id_for_audit}},
 {'model':'core.claimadmin','fields':{'code':'TESTTFAC','last_name':fixture['claimAdmin']['lastName'],'other_names':fixture['claimAdmin']['otherNames'],'health_facility':facility.pk,'has_login':False,'audit_user_id':operator.id_for_audit}}
]
report={'authorization_document_sha256':AUTH_SHA,'fixture_sha256':hashlib.sha256((root/'tfac-fixture.json').read_bytes()).hexdigest(),'operator':operator.username,'audit_user_id':operator.id_for_audit,'environment':trust['environment'],'mode':'DRY_RUN','events':[],'timestamp':datetime.now(timezone.utc).isoformat()}
new=[]
with transaction.atomic():
    for obj in objects:
        model=apps.get_model(obj['model']);rows=list(model.objects.filter(code=obj['fields']['code']))
        if len(rows)>1:raise RuntimeError('Historical or duplicate code conflict')
        if rows:
            current=rows[0]
            if current.validity_to is not None:raise RuntimeError('Historical fixture conflict; no reactivation')
            actual={k:(getattr(current,k+'_id') if k=='health_facility' else getattr(current,k)) for k in obj['fields']}
            require_match(actual,obj['fields']);report['events'].append({'model':obj['model'],'code':current.code,'action':'EXACT_MATCH_SKIP','id':current.pk})
        else:
            # Built-in deserialization/model validation, with no save and no assigned PK.
            candidate=list(serializers.deserialize('json',json.dumps([obj])))[0].object
            nullable_omitted=[f.name for f in candidate._meta.fields if f.null and getattr(candidate,f.attname) is None]
            candidate.full_clean(exclude=nullable_omitted)
            new.append(obj);report['events'].append({'model':obj['model'],'code':obj['fields']['code'],'action':'WOULD_CREATE'})
    if os.environ.get('HP_QA_FIXTURE_APPLY') == 'yes':
        report['mode']='APPLY'
        if new:
            with tempfile.NamedTemporaryFile(mode='w',suffix='.json',delete=False) as fh:
                json.dump(new,fh,ensure_ascii=False);path=fh.name
            try:
                call_command('loaddata',path,verbosity=0)
            finally:
                Path(path).unlink(missing_ok=True)
        for event in report['events']:
            current=apps.get_model(event['model']).objects.get(code=event['code'],validity_to__isnull=True)
            event['id']=current.pk
            if event['action']=='WOULD_CREATE':event['action']='CREATED_BY_DJANGO_FIXTURE'
            event['audit_user_id']=current.audit_user_id
print('TFAC_REFERENCE_FIXTURE_BEGIN')
print(json.dumps(report,ensure_ascii=False,sort_keys=True))
print('TFAC_REFERENCE_FIXTURE_END')
