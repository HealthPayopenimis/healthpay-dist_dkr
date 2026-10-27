"""Align only this run's new TFAC facilities to governed D references.
Supported updateHealthFacility only; no existing facility/location/user changes.
"""
import argparse
import json
from pathlib import Path
from fixture_policy import require_match
from seed_tfac_api import Runner,FACILITY,numeric_id

p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--authorization-sha',required=True);p.add_argument('--output',required=True);p.add_argument('--preexisting-baseline',required=True);a=p.parse_args()
r=Runner(a);old=json.loads(Path(a.preexisting_baseline).read_text())
for f in r.fixture['facilities']:
    row=r.lookup('healthFacilities','code',f['code'],FACILITY,history=False)
    if not row:raise RuntimeError('New TFAC fixture missing')
    if str(numeric_id(row['id'])) in old['location.HealthFacility']:
        raise RuntimeError('Refuse to configure a pre-existing facility')
    require_match(row,{'code':f['code'],'name':f['name'],'level':f['level'],'careType':f['careType'],'status':f['status']})
    district=r.lookup('locations','code',f['locationPcode'],'id uuid code type parent {code type}',history=False)
    village=r.lookup('locations','code',f['siteVillageReferencePcode'],'id uuid code type parent {code type}',history=False)
    if district['type']!='D' or village['type']!='V' or village['parent']['code']!=district['code']:
        raise RuntimeError('Governed district/site-village identity mismatch')
    if row['location']['code']==district['code']:
        r.events.append({'operation':'EXACT_MATCH_SKIP','code':f['code']});r.records[f['code']]=row;r.save();continue
    if row['location']['code']!=village['code']:
        raise RuntimeError('Unexpected new-fixture location; do not overwrite')
    payload={k:v for k,v in f.items() if k not in ('locationPcode','siteVillageReferencePcode')}
    payload.update({'uuid':row['uuid'],'locationId':numeric_id(district['id']),'servicesPricelistId':numeric_id(row['servicesPricelist']['id'])})
    if a.apply:
        r.create('updateHealthFacility','UpdateHealthFacilityMutationInput',payload,'configure new '+f['code']+' governed district')
        final=r.lookup('healthFacilities','code',f['code'],FACILITY,history=False)
        require_match(final,{'code':f['code'],'name':f['name'],'level':f['level'],'careType':f['careType'],'status':f['status']})
        if final['location']['code']!=district['code'] or final['servicesPricelist']['uuid']!=row['servicesPricelist']['uuid'] or final['legalForm']['code']!=f['legalFormId']:
            raise RuntimeError('Configured facility readback mismatch')
        r.records[f['code']]=final;r.save();print('NEW_TFAC_DISTRICT_READBACK_PASS',f['code'],flush=True)
    else:
        r.events.append({'operation':'WOULD_CONFIGURE_NEW_FACILITY','code':f['code'],'input':payload});r.save()
print('NEW_TFAC_FACILITY_CONFIGURATION_COMPLETE')
