"""HealthPay protected QA API session. Never prints credentials or tokens."""
import json
from pathlib import Path
import re
import requests

BASE = 'https://inspayer.healthpay.tech'

class QAApi:
    def __init__(self):
        c = {}
        text = Path('/home/ubuntu/healthpay-delivery/HealthPay-Web-hpadmin-CREDENTIALS.txt').read_text()
        for key in ('Username', 'Password'):
            lines = [line.split(':', 1)[1].strip() for line in text.splitlines() if line.startswith(key + ':')]
            if len(lines) != 1 or not lines[0]:
                raise RuntimeError('Restricted credential format mismatch')
            c[key] = lines[0]
        self.session = requests.Session()
        r = self.session.post(BASE + '/api/api_fhir_r4/login/', json={'username': c['Username'], 'password': c['Password']}, timeout=60)
        if r.status_code != 200 or not r.json().get('token'):
            raise RuntimeError('QA authentication failed; no secret response logged')
        self.headers = {'Authorization': 'bearer ' + r.json()['token']}
        d = self.call('mutation { getCsrfToken { csrfToken } }', auth_only=True)
        self.headers['X-CSRFToken'] = d['getCsrfToken']['csrfToken']
    def call(self, query, variables=None, auth_only=False, allowed_mutation=None):
        if re.match(r'^\s*mutation\b', query) and not auth_only:
            if not allowed_mutation or allowed_mutation not in query:
                raise RuntimeError('Business mutation blocked without exact allowed operation')
        r = self.session.post(BASE + '/api/graphql', headers=self.headers, json={'query':query,'variables':variables or {}}, timeout=90)
        if r.status_code != 200:
            raise RuntimeError('GraphQL HTTP failure: ' + str(r.status_code))
        d = r.json()
        if d.get('errors'):
            raise RuntimeError('GraphQL error: ' + '; '.join(e.get('message','error') for e in d['errors']))
        return d['data']
