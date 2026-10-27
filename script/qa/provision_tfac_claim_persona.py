"""QA-only new facility claim persona via existing supported core user services.
No existing user/admin/role is updated; default dry-run; no credentials logged.
"""
import json,os
from pathlib import Path
from django.apps import apps
from django.conf import settings
from django.db import transaction
from core.models import User,InteractiveUser,Role
from core.services import create_or_update_interactive_user,create_or_update_claim_admin,create_or_update_core_user
from fixture_policy import AUTH_SHA,require_qa
from claim_persona_policy import PERSONA,require_persona,require_new_or_exact
require_persona(PERSONA)
trust={'environment':getattr(settings,'HEALTHPAY_DEPLOYMENT_ENV','production'),'qa_token_configured':bool(getattr(settings,'HEALTHPAY_QA_AUTHORIZATION',None)),'database':settings.DATABASES['default']['NAME']}
require_qa(trust,os.environ.get('HP_QA_AUTHORIZATION_SHA'))
operator=User.objects.get(username='hpadmin')
if not operator.is_active or not operator.is_imis_admin or not User.objects.filter(i_user_id=1).exists():raise RuntimeError('Established active QA administrator required')
hf=apps.get_model('location.HealthFacility').objects.get(code='TFAC001',validity_to__isnull=True)
if not hf.name.startswith('TEST-FAC-001') or hf.location.code!='EG0109' or hf.location.type!='D':raise RuntimeError('Exact owned synthetic facility/district required')
role=Role.objects.get(is_system=256,validity_to__isnull=True)
if role.name!='Claim Administrator':raise RuntimeError('Established Claim Administrator role identity mismatch')
apply=os.environ.get('HP_QA_CLAIM_PERSONA_APPLY')=='yes'
report={'authorization_document_sha256':AUTH_SHA,'mode':'DRY_RUN','username':PERSONA['username'],'facilityCode':'TFAC001','roleIsSystem':256,'existing_user_or_role_changes':False}
with transaction.atomic():
    existing=User.objects.filter(username=PERSONA['username']).first()
    if existing:
        i=existing.i_user
        actual={'username':existing.username,'facilityCode':i.health_facility.code if i and i.health_facility else None,'claimAdminCode':existing.claim_admin.code if existing.claim_admin else None,'roles':sorted(apps.get_model('core.UserRole').objects.filter(user=i,validity_to__isnull=True,role__validity_to__isnull=True).values_list('role__is_system',flat=True)) if i else [],'districts':sorted(apps.get_model('location.UserDistrict').objects.filter(user=i,validity_to__isnull=True).values_list('location__code',flat=True)) if i else [],'isImisAdmin':bool(existing.is_imis_admin),'isStaff':bool(existing.is_staff),'isActive':bool(existing.is_active),'lastName':i.last_name if i else None,'otherNames':i.other_names if i else None,'language':i.language_id if i else None}
        report['action']=require_new_or_exact(actual)
    else:
        if InteractiveUser.objects.filter(login_name=PERSONA['username']).exists() or apps.get_model('core.ClaimAdmin').objects.filter(code=PERSONA['username']).exists():raise RuntimeError('Existing legacy identity conflict; no reassociation/update allowed')
        report['action']='WOULD_CREATE_NEW'
        if apply:
            secret=Path(os.environ['HP_QA_CLAIM_PERSONA_PASSWORD_FILE'])
            if secret.stat().st_mode & 0o077:raise RuntimeError('Protected temporary password file required')
            password=secret.read_text().strip()
            if len(password)<24:raise RuntimeError('Strong generated temporary password required')
            data={'username':PERSONA['username'],'last_name':PERSONA['lastName'],'other_names':PERSONA['otherNames'],'language':'ar','phone':None,'email':None,'birth_date':None,'health_facility_id':hf.pk,'roles':[role.pk],'districts':[hf.location_id],'password':password}
            i,created=create_or_update_interactive_user(None,data,operator,True)
            ca,ca_created=create_or_update_claim_admin(None,data,operator.id_for_audit,True)
            u,user_created=create_or_update_core_user(None,PERSONA['username'],i_user=i,claim_admin=ca)
            if not all((created,ca_created,user_created)) or u.is_staff or u.is_imis_admin or u.i_user.health_facility_id!=hf.pk or u.claim_admin.code!=PERSONA['username'] or not u.check_password(password):raise RuntimeError('New persona/authentication contract failed; rollback required')
            report.update(action='CREATED_VIA_SUPPORTED_CORE_USER_SERVICES',userId=str(u.pk),interactiveUserId=i.pk,claimAdminId=ca.pk)
            del data['password'];del password
    if existing:report.update(userId=str(existing.pk),interactiveUserId=existing.i_user_id,claimAdminId=existing.claim_admin_id)
    if apply:report['mode']='APPLY'
print('TFAC_CLAIM_PERSONA_BEGIN');print(json.dumps(report,sort_keys=True));print('TFAC_CLAIM_PERSONA_END')
