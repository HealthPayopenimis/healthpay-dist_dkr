"""Configure only the new TQAC001 fixture through supported updateProduct.
Never touches a product that existed in the prechange baseline; no application-code change.
"""
import argparse
import json
import sys
from pathlib import Path
from seed_tfac_api import Runner, PRODUCT, numeric_id
from fixture_policy import require_match

p=argparse.ArgumentParser();p.add_argument('--authorization-sha',required=True);p.add_argument('--output',required=True);p.add_argument('--preexisting-baseline',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
r=Runner(a)
row=r.lookup('products','code','TQAC001',PRODUCT,history=False)
if not row:raise RuntimeError('New QA product absent')
old=json.loads(Path(a.preexisting_baseline).read_text())
if str(numeric_id(row['id'])) in old['product.Product']:
    raise RuntimeError('Refuse to change a pre-existing product')
if row['code']!='TQAC001' or row['name']!=r.fixture['product']['name']:
    raise RuntimeError('Synthetic product ownership marker conflict')
payload={**r.fixture['product'],'uuid':row['uuid']}
service=r.lookup('medicalServices','code','TSVC01','id uuid code name price')
payload['services']=[{'serviceUuid':service['uuid'],**r.fixture['serviceBenefit']}]
try:
    require_match(row,r.fixture['product'])
    require_match(row['services']['edges'][0]['node'],r.fixture['serviceBenefit'])
    require_match(row['services']['edges'][0]['node']['service'],{'uuid':service['uuid']})
except (RuntimeError,IndexError):
    pass
else:
    r.events.append({'operation':'EXACT_MATCH_SKIP','entity':'new QA product'});r.records['product']=row;r.save()
    print('NEW_QA_PRODUCT_ALREADY_EXACT_NO_WRITE');sys.exit(0)
if a.apply:
    r.create('updateProduct','UpdateProductMutationInput',payload,'configure newly-created TQAC001 ceiling type')
    final=r.lookup('products','code','TQAC001',PRODUCT,history=False)
    require_match(final,r.fixture['product'])
    require_match(final['services']['edges'][0]['node'],r.fixture['serviceBenefit'])
    r.records['product']=final;r.save();print('NEW_QA_PRODUCT_CONFIGURED_AND_READBACK_PASS')
else:
    r.events.append({'operation':'WOULD_CONFIGURE_NEW_QA_PRODUCT','uuid':row['uuid'],'input':payload});r.save()
