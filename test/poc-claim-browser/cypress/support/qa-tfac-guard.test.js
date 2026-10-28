const assert = require('node:assert/strict');
const fs = require('node:fs');
const { classifyGraphQL, exactClaimCode, clientMutationIdentity, operationName, readAlias } = require('./qa-tfac-guard');

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
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const inline = `mutation { createClaim(input: { code: "TFACC001", clientMutationId: "${firstId}" }) { clientMutationId } }`;
assert.equal(clientMutationIdentity(inline), firstId);
assert.equal(clientMutationIdentity(inline), clientMutationIdentity(inline), 'automatic retry has the same identity');
assert.equal(clientMutationIdentity('', { input: { clientMutationId: secondId } }), secondId);
assert.equal(clientMutationIdentity(inline, { input: { clientMutationId: secondId } }), null, 'conflicting identities fail closed');
assert.equal(clientMutationIdentity('mutation { createClaim(input: { code: "TFACC001" }) { clientMutationId } }'), null);
assert.equal(clientMutationIdentity('', { input: { clientMutationId: 'not-a-uuid' } }), null);

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

// Source guard: browser acceptance must wait on visible application state or
// intercepted responses, never arbitrary time or injected application state.
const browserSpec = fs.readFileSync(require.resolve('../e2e/qa-tfac-readonly.cy.js'), 'utf8');
assert.equal(/cy\.wait\(\s*\d+/.test(browserSpec), false, 'no fixed cy.wait sleeps');
assert.equal(/setTimeout|sleep\s*\(/.test(browserSpec), false, 'no arbitrary timer sleeps');
assert.equal(/localStorage\.setItem|sessionStorage\.setItem|window\.__|store\.dispatch\s*\(/i.test(browserSpec), false, 'no store injection');
assert.match(browserSpec, /SCOPED_ACTOR_READ_QUERY/);
assert.match(browserSpec, /query ScopedClaimActorRead/);
assert.doesNotMatch(browserSpec, /mutation\s+ScopedClaimActorRead/);
assert.match(browserSpec, /forceNetworkError/);
assert.match(browserSpec, /attemptedTransportFailures: 2/);
assert.match(browserSpec, /attemptCreateAndProveUnlock\(1\)/);
assert.match(browserSpec, /attemptCreateAndProveUnlock\(2\)/);
assert.match(browserSpec, /distinct operator Save attempts excluding browser retries/);

console.log('TFAC_CLAIM_BROWSER_GUARD: PASS — auth/business mixing, batching, unknown operations, and exact simulation negatives');
