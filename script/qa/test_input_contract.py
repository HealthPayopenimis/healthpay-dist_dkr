import unittest
from input_contract import validate_input_fields
from fixture_policy import require_match

def scalar(name):return {'kind':'SCALAR','name':name,'ofType':None}
def field(name,kind):return {'name':name,'type':kind}

class InputContractTests(unittest.TestCase):
    def test_date_input_accepts_calendar_date_not_datetime(self):
        fields=[field('dateFrom',scalar('Date'))]
        validate_input_fields(fields,{'dateFrom':'2026-10-01'})
        with self.assertRaises(RuntimeError):validate_input_fields(fields,{'dateFrom':'2026-10-01T00:00:00'})
    def test_required_field_is_not_silently_omitted(self):
        fields=[field('code',{'kind':'NON_NULL','name':None,'ofType':scalar('String')})]
        with self.assertRaises(RuntimeError):validate_input_fields(fields,{})
    def test_unknown_field_denied(self):
        with self.assertRaises(RuntimeError):validate_input_fields([],{'unknown':1})
    def test_uuid_scalar_and_uuid_list(self):
        u='00000000-0000-0000-0000-000000000001'
        validate_input_fields([field('uuid',scalar('UUID'))],{'uuid':u})
        fields=[field('ids',{'kind':'LIST','name':None,'ofType':scalar('UUID')})]
        validate_input_fields(fields,{'ids':[u]})
        with self.assertRaises(RuntimeError):validate_input_fields(fields,{'ids':['bad']})
    def test_nonfinite_decimal_denied(self):
        with self.assertRaises(RuntimeError):validate_input_fields([field('amount',scalar('Decimal'))],{'amount':'NaN'})
    def test_midnight_readback_is_same_calendar_date(self):
        expected={'dateFrom':'2026-10-01'}
        require_match({'dateFrom':'2026-10-01T00:00:00'},expected)
        with self.assertRaises(RuntimeError):require_match({'dateFrom':'2026-10-01T01:00:00'},expected)
        with self.assertRaises(RuntimeError):require_match({'dateFrom':'2026-10-02T00:00:00'},expected)

if __name__=='__main__':unittest.main()
