"""Read-only validation of the actual GraphQL input contract; no coercion/truncation."""
from datetime import date
from decimal import Decimal
from uuid import UUID

def check_value(kind,value,name):
    if kind['kind']=='NON_NULL':
        if value is None:raise RuntimeError('Required GraphQL input missing: '+name)
        return check_value(kind['ofType'],value,name)
    if value is None:return
    if kind['kind']=='LIST':
        if not isinstance(value,(list,tuple)):raise RuntimeError('GraphQL list input required: '+name)
        for entry in value:check_value(kind['ofType'],entry,name)
        return
    scalar=kind.get('name')
    try:
        if scalar=='Date':date.fromisoformat(value)
        elif scalar=='UUID':UUID(str(value))
        elif scalar=='Decimal' and not Decimal(str(value)).is_finite():raise ValueError('non-finite decimal')
    except (TypeError,ValueError,ArithmeticError):
        raise RuntimeError('Invalid '+str(scalar)+' input field: '+name) from None

def validate_input_fields(fields,payload):
    by_name={f['name']:f['type'] for f in fields}
    if set(payload)-set(by_name):raise RuntimeError('Unknown GraphQL input fields: '+','.join(sorted(set(payload)-set(by_name))))
    for name,kind in by_name.items():check_value(kind,payload.get(name),name)
