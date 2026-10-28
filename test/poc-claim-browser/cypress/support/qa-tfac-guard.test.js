const assert = require('node:assert/strict');
const { classifyGraphQL, exactClaimCode, operationName, readAlias } = require('./qa-tfac-guard');

assert.deepEqual(classifyGraphQL('query { healthFacilities { edges { node { code } } } }'), {
  kind: 'READ',
  operation: 'READ',
});
assert.equal(operationName('mutation { getCsrfToken { csrfToken } }'), 'AUTH');
assert.equal(readAlias('query ClaimAdminPicker { claimAdmins { edges { node { code } } } }'), 'tfacAdminBootstrap');

assert.equal(classifyGraphQL('mutation { createClaim(input: { code: "TFACC001" }) { clientMutationId } }').kind, 'BUSINESS');
assert.equal(exactClaimCode('mutation { createClaim(input: { code: "TFACC001" }) { clientMutationId } }'), true);
assert.equal(exactClaimCode('mutation($input: CreateClaimInput!) { createClaim(input: $input) { clientMutationId } }', { input: { code: 'TFACC001' } }), true);
assert.equal(exactClaimCode('mutation { createClaim(input: { code: "OTHER" }) { clientMutationId } }'), false);

// Fail closed: auth and business in one document may not be continued.
assert.deepEqual(classifyGraphQL('mutation { getCsrfToken { csrfToken } createClaim(input: { code: "TFACC001" }) { clientMutationId } }'), {
  kind: 'DENY',
  operation: 'MIXED_OR_UNKNOWN_MUTATION',
});

// Fail closed: batched/multi-operation documents may not be continued.
assert.deepEqual(classifyGraphQL('mutation A { getCsrfToken { csrfToken } } mutation B { refreshToken { token } }'), {
  kind: 'DENY',
  operation: 'MIXED_OR_UNKNOWN_MUTATION',
});
assert.deepEqual(classifyGraphQL('query A { healthFacilities { edges { node { code } } } } mutation B { getCsrfToken { csrfToken } }'), {
  kind: 'DENY',
  operation: 'MIXED_OR_UNKNOWN_MUTATION',
});

// Fail closed: unknown mutation fields and business fields embedded in a read.
assert.deepEqual(classifyGraphQL('mutation { unknownOperation { id } }'), {
  kind: 'DENY',
  operation: 'MIXED_OR_UNKNOWN_MUTATION',
});
assert.deepEqual(classifyGraphQL('query { createClaim { id } }'), {
  kind: 'DENY',
  operation: 'MUTATION_FIELD_IN_READ',
});

for (const document of [
  undefined, null, '', [], [{ query: 'mutation{getCsrfToken{csrfToken}}' }],
  'mutation{getCsrfToken{csrfToken} deleteInsuree(input:{id:1}){id}}',
  'mutation{safe:getCsrfToken{csrfToken} disguised:unknownOperation{id}}',
  'mutation{a:getCsrfToken{csrfToken} b:getCsrfToken{csrfToken}}',
  'mutation{getCsrfToken{csrfToken}',
  'mutation{getCsrfToken{csrfToken}} query{__typename}',
]) assert.equal(classifyGraphQL(document).kind, 'DENY');
assert.equal(classifyGraphQL('mutation Login($username:String!,$password:String!){auth:tokenAuth(username:$username,password:$password){token}}').kind, 'AUTH');
assert.equal(classifyGraphQL('query{one:healthFacilities{edges{node{code}}}two:__typename}').kind, 'READ');
assert.equal(classifyGraphQL('query($x:String="mutation getCsrfToken"){healthFacilities{edges{node{code}}}}').kind, 'READ');

console.log('TFAC_CLAIM_BROWSER_GUARD: PASS — auth/business mixing, batching, unknown operations, and exact simulation negatives');
