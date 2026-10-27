import unittest
from claim_persona_policy import PERSONA,require_persona,require_new_or_exact
from fixture_policy import require_qa,AUTH_SHA
class TestClaimPersonaPolicy(unittest.TestCase):
 def setUp(self):self.good={'username':'TFACCLM','facilityCode':'TFAC001','claimAdminCode':'TFACCLM','roles':[256],'districts':['EG0109'],'isImisAdmin':False,'isStaff':False,'isActive':True,'lastName':PERSONA['lastName'],'otherNames':PERSONA['otherNames'],'language':'ar'}
 def test_exact_proposal(self):require_persona(PERSONA)
 def test_no_existing_identity_is_new(self):self.assertEqual(require_new_or_exact(None),'CREATE_NEW')
 def test_exact_repeat_is_read_only_skip(self):self.assertEqual(require_new_or_exact(self.good),'EXACT_MATCH_SKIP')
 def test_production_is_denied(self):
  with self.assertRaises(RuntimeError):require_qa({'environment':'production','database':'IMIS','qa_token_configured':True},AUTH_SHA)
 def test_non_tfac_user_is_denied(self):
  with self.assertRaises(RuntimeError):require_new_or_exact(dict(self.good,username='hpadmin'))
 def test_admin_role_is_denied(self):
  with self.assertRaises(RuntimeError):require_new_or_exact(dict(self.good,roles=[64]))
 def test_extra_role_is_denied(self):
  with self.assertRaises(RuntimeError):require_new_or_exact(dict(self.good,roles=[256,64]))
 def test_other_facility_is_denied(self):
  with self.assertRaises(RuntimeError):require_new_or_exact(dict(self.good,facilityCode='TFAC002'))
 def test_scope_expansion_is_denied(self):
  with self.assertRaises(RuntimeError):require_new_or_exact(dict(self.good,districts=['EG0109','EG2107']))
 def test_superuser_and_staff_are_denied(self):
  for key in ['isImisAdmin','isStaff']:
   with self.assertRaises(RuntimeError):require_new_or_exact(dict(self.good,**{key:True}))
 def test_inactive_account_not_reactivated(self):
  with self.assertRaises(RuntimeError):require_new_or_exact(dict(self.good,isActive=False))
 def test_changed_identity_plan_is_denied(self):
  with self.assertRaises(RuntimeError):require_persona(dict(PERSONA,roleIsSystem=64))
if __name__=='__main__':unittest.main()
