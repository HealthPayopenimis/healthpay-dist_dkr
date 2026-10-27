import copy
import json
from pathlib import Path
import unittest
from fixture_policy import AUTH_SHA, require_qa, validate_fixture, require_match, mutation_complete

class FixturePolicyTests(unittest.TestCase):
    def setUp(self):
        self.fixture=json.loads((Path(__file__).parent/'tfac-fixture.json').read_text())
        self.trust={'environment':'qa','database':'IMIS','qa_token_configured':True}
    def test_approved_configuration_and_fixture(self):
        require_qa(self.trust,AUTH_SHA);validate_fixture(self.fixture)
    def test_default_production_denied(self):
        with self.assertRaises(RuntimeError):require_qa({},AUTH_SHA)
    def test_explicit_production_denied(self):
        with self.assertRaises(RuntimeError):require_qa({**self.trust,'environment':'production'},AUTH_SHA)
    def test_wrong_database_denied(self):
        with self.assertRaises(RuntimeError):require_qa({**self.trust,'database':'OTHER'},AUTH_SHA)
    def test_missing_trusted_authorization_denied(self):
        with self.assertRaises(RuntimeError):require_qa({**self.trust,'qa_token_configured':False},AUTH_SHA)
    def test_wrong_document_denied(self):
        with self.assertRaises(RuntimeError):require_qa(self.trust,'incorrect')
    def test_facility_whitelist_and_marker(self):
        f=copy.deepcopy(self.fixture);f['facilities'][0]['code']='OTHER'
        with self.assertRaises(RuntimeError):validate_fixture(f)
        f=copy.deepcopy(self.fixture);f['facilities'][0]['name']='Real hospital'
        with self.assertRaises(RuntimeError):validate_fixture(f)
    def test_nonclinical_diagnosis_and_no_login(self):
        f=copy.deepcopy(self.fixture);f['diagnosis']['codingSystem']='ICD'
        with self.assertRaises(RuntimeError):validate_fixture(f)
        f=copy.deepcopy(self.fixture);f['claimAdmin']['hasLogin']=True
        with self.assertRaises(RuntimeError):validate_fixture(f)
    def test_claim_envelope_not_truncation(self):
        f=copy.deepcopy(self.fixture);f['claim']['code']='TEST-TFAC'
        with self.assertRaises(RuntimeError):validate_fixture(f)
    def test_exact_existing_row_only(self):
        require_match({'code':'TFAC001'},{'code':'TFAC001'})
        with self.assertRaises(RuntimeError):require_match({'code':'OTHER'},{'code':'TFAC001'})
        with self.assertRaises(RuntimeError):require_match({}, {'code':'TFAC001'})
    def test_actual_journal_success_and_negative_controls(self):
        self.assertFalse(mutation_complete({'status':0,'error':None}))
        self.assertTrue(mutation_complete({'status':2,'error':None}))
        with self.assertRaises(RuntimeError):mutation_complete({'status':1,'error':None})
        with self.assertRaises(RuntimeError):mutation_complete({'status':2,'error':'error'})
        with self.assertRaises(RuntimeError):mutation_complete({'status':999,'error':None})

if __name__=='__main__':unittest.main()
