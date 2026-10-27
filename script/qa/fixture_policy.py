"""Pure guard functions; these never make API or database calls."""
AUTH_SHA = '3acfe7c2c14ff703ac0e0135d0ad18821b33eede5e37a599412dd25700ab0ca3'
CODES = ['TFAC001','TFAC002','TFAC003','TFAC004','TFAC005']

def require_qa(trust, authorization):
    if authorization != AUTH_SHA or trust.get('environment') not in ('qa','staging'):
        raise RuntimeError('QA-only authorization/configuration gate denied')
    if trust.get('database') != 'IMIS' or not trust.get('qa_token_configured'):
        raise RuntimeError('Trusted QA database/configuration gate denied')

def validate_fixture(fixture):
    if fixture.get('authorization_document_sha256') != AUTH_SHA or fixture.get('synthetic_only') is not True or fixture.get('environment') != 'qa':
        raise RuntimeError('Fixture authorization/type denied')
    if fixture.get('base_url') != 'https://inspayer.healthpay.tech':
        raise RuntimeError('Target denied')
    if [x['code'] for x in fixture['facilities']] != CODES:
        raise RuntimeError('Facility whitelist denied')
    for i, f in enumerate(fixture['facilities'], 1):
        if len(f['code']) > 8 or ('TEST-FAC-%03d' % i) not in f['name'] or f['level'] not in ('H','C'):
            raise RuntimeError('Synthetic facility marker/type denied')
    for key, code, max_length in [('service','TSVC01',6),('product','TQAC001',8),('diagnosis','TDX001',6),('claim','TFACC001',8)]:
        row = fixture[key]
        if row['code'] != code or len(code)>max_length:
            raise RuntimeError('Synthetic dependent identifier denied')
    if 'TEST' not in fixture['diagnosis']['name'] or fixture['diagnosis']['codingSystem'] != 'synthetic QA sentinel; not ICD or an actual clinical diagnosis':
        raise RuntimeError('Diagnosis must be an explicitly synthetic, nonclinical sentinel')
    if fixture['claimAdmin']['code'] != 'TESTTFAC' or fixture['claimAdmin']['hasLogin'] is not False:
        raise RuntimeError('Non-login administrator policy denied')

def require_match(actual, expected):
    if any(actual.get(k) != value for k, value in expected.items()):
        raise RuntimeError('Existing code/name conflicts with fixture; no update allowed')

def mutation_complete(log):
    # Exact source: core.models.base_mutation.MutationLog RECEIVED=0 ERROR=1 SUCCESS=2.
    if log['status'] == 1 or log.get('error'):
        raise RuntimeError('Application mutation failed: ' + str(log.get('error') or 'status=ERROR'))
    if log['status'] not in (0,2):
        raise RuntimeError('Unknown mutation-log status')
    return log['status'] == 2
