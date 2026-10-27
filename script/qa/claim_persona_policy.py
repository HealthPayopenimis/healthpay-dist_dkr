"""Exact new QA identity; no provisioning or credential operations here."""
PERSONA={'username':'TFACCLM','claimAdminCode':'TFACCLM','facilityCode':'TFAC001','districtCode':'EG0109','roleIsSystem':256,'language':'ar','lastName':'اختبار TFAC','otherNames':'مسؤول مطالبات اختباري'}
def require_persona(spec):
    if spec != PERSONA:raise RuntimeError('Exact synthetic claim persona/least-privilege target denied')
def require_new_or_exact(existing):
    if existing is None:return 'CREATE_NEW'
    if existing.get('username')!='TFACCLM' or existing.get('facilityCode')!='TFAC001' or existing.get('claimAdminCode')!='TFACCLM' or existing.get('roles')!=[256] or existing.get('districts')!=['EG0109'] or existing.get('isImisAdmin') is not False or existing.get('isStaff') is not False or existing.get('isActive') is not True or existing.get('lastName')!=PERSONA['lastName'] or existing.get('otherNames')!=PERSONA['otherNames'] or existing.get('language')!='ar':
        raise RuntimeError('Existing identity conflict; no update/reset/role change permitted')
    return 'EXACT_MATCH_SKIP'
