export const TARGET = 'https://inspayer.healthpay.tech';
export const QUERIES = Object.freeze({
  health: 'query LoadHealth { __typename }',
  validity: 'query LoadValidity($number:String!,$own:String){insureeNumberValidity(insureeNumber:$number,insureeUuid:$own){isValid errorCode}}',
  beneficiary: 'query LoadBeneficiary($number:String!){insurees(chfId:$number,ignoreLocation:true,first:1){edges{node{uuid family{uuid}}}}}',
  policy: 'query LoadPolicy($uuid:String!){policies(uuid:$uuid,first:1){edges{node{uuid status value family{uuid} product{code}}}}}',
  location: 'query LoadLocation($uuid:String!){locationsStr(type:"V",parent_Uuid:$uuid,first:5){edges{node{uuid type parent{uuid}}}}}',
  controls: 'query GetControls {control{edges{node{name usage adjustability}}}}',
});
export const CYCLE = Object.freeze(['health','validity','beneficiary','policy','validity','location','beneficiary','validity','controls','policy','health','validity','beneficiary','location','validity','policy','beneficiary','controls','validity','location']);
export const LIMITS = Object.freeze({durationSeconds:480,maxVUs:10,maxRPS:5,p95Ms:2000,errorFraction:0.01,graceSeconds:30});
export function selectWorkload(iteration) { return CYCLE[iteration % CYCLE.length]; }
export function assertRequest(target, kind, query) {
  if (target !== TARGET || !Object.prototype.hasOwnProperty.call(QUERIES,kind) || query !== QUERIES[kind] || !query.startsWith('query ')) throw new Error('OUTBOUND_READ_WHITELIST_DENIED');
}
export function validateAuth(auth) {
  if (!auth || auth.target!==TARGET || !auth.headers || !auth.headers.Authorization || !auth.headers['X-CSRFToken'] || !auth.cookies || !auth.fixture || auth.actor!=='hpadmin') throw new Error('PROTECTED_SETUP_INVALID');
  const f=auth.fixture;
  if (f.original.number!=='29001011234567' || f.original.family!=='e456ef2f-6a84-4408-ad3d-3ab2e90d30bf' || f.tfac.number!=='29001010190019' || f.tfac.family!=='e2034a66-3efe-4cd5-93bf-733e89ad7202' || f.tfac.uuid!=='fa1c296d-3f39-4892-a48f-7458d630afb6' || f.policy!=='7ce8d48b-5fbf-4481-8b78-8dec1837f86e' || !f.original.uuid || !f.district) throw new Error('APPROVED_FIXTURE_MISMATCH');
}
export function caseFor(kind, iteration, f) {
  const round=Math.floor(iteration/20);
  if (kind==='validity') {
    const cases=[{number:f.original.number,own:null,expected:false},{number:f.original.number,own:f.original.uuid,expected:true},{number:f.tfac.number,own:null,expected:false},{number:'2900101123456',own:null,expected:false},{number:'290010112345678',own:null,expected:false}];
    return cases[round%cases.length];
  }
  if (kind==='beneficiary') return round%2 ? f.tfac : f.original;
  return {};
}
export function variablesFor(kind, c, f) {
  if (kind==='validity') return {number:c.number,own:c.own};
  if (kind==='beneficiary') return {number:c.number};
  if (kind==='policy') return {uuid:f.policy};
  if (kind==='location') return {uuid:f.district};
  return {};
}
export function responseOK(kind, body, c, f) {
  if (!body || body.errors || !body.data) return false;
  const d=body.data;
  if (kind==='health') return d.__typename==='Query';
  if (kind==='validity') return d.insureeNumberValidity && d.insureeNumberValidity.isValid===c.expected;
  if (kind==='beneficiary') { const e=d.insurees && d.insurees.edges;return !!(e && e.length===1 && e[0].node.uuid===c.uuid && e[0].node.family.uuid===c.family); }
  if (kind==='policy') { const e=d.policies && d.policies.edges;return !!(e && e.length===1 && e[0].node.uuid===f.policy && e[0].node.status===f.policyStatus && Number(e[0].node.value)===1000 && e[0].node.product.code==='TQAC001' && e[0].node.family.uuid===f.tfac.family); }
  if (kind==='location') {const e=d.locationsStr && d.locationsStr.edges;return !!(e && e.length>0 && e.length<=5 && e.every(x=>x.node.type==='V' && x.node.parent.uuid===f.district));}
  if (kind==='controls') return !!(d.control && d.control.edges.length===60);
  return false;
}
