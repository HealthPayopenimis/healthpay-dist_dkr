const AUTH_OPERATION_NAMES = new Set(['tokenAuth', 'getCsrfToken', 'refreshToken']);
const BUSINESS_OPERATION_NAMES = new Set([
  'createFamily', 'createPolicy', 'createPremium', 'createClaim', 'updateClaim',
  'submitClaims', 'selectClaimsForFeedback', 'deliverClaimFeedback',
  'selectClaimsForReview', 'saveClaimReview', 'deliverClaimsReview', 'processClaims',
]);

// Minimal fail-closed executable-document reader. It identifies only root fields;
// argument strings and input objects can never masquerade as root operations.
function rootOperation(query) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('INVALID_DOCUMENT');
  const tokenPattern = /\s+|#[^\n\r]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|[_A-Za-z][_0-9A-Za-z]*|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[!$():=@\[\]{|},]|\.\.\./gy;
  const tokens = [];
  let offset = 0;
  while (offset < query.length) {
    tokenPattern.lastIndex = offset;
    const m = tokenPattern.exec(query);
    if (!m) throw new Error('INVALID_TOKEN');
    offset = tokenPattern.lastIndex;
    if (!/^\s|^#|^,$/.test(m[0])) tokens.push(m[0]);
  }
  let i = 0;
  const peek = () => tokens[i];
  const name = () => {
    if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(peek() || '')) throw new Error('EXPECTED_NAME');
    return tokens[i++];
  };
  const balanced = (open, close) => {
    if (tokens[i++] !== open) throw new Error('EXPECTED_GROUP');
    let depth = 1;
    while (depth && i < tokens.length) {
      const t = tokens[i++];
      if (t === open) depth++;
      else if (t === close) depth--;
    }
    if (depth) throw new Error('UNCLOSED_GROUP');
  };
  const directives = () => {
    while (peek() === '@') {
      i++; name();
      if (peek() === '(') balanced('(', ')');
    }
  };
  let kind = 'query';
  if (peek() !== '{') {
    kind = name();
    if (!['query', 'mutation'].includes(kind)) throw new Error('UNAPPROVED_OPERATION');
    if (peek() && /^[_A-Za-z]/.test(peek())) name();
    if (peek() === '(') balanced('(', ')');
    directives();
  }
  if (tokens[i++] !== '{') throw new Error('EXPECTED_SELECTION');
  const fields = [];
  while (peek() && peek() !== '}') {
    let field = name();
    if (peek() === ':') { i++; field = name(); }
    if (peek() === '(') balanced('(', ')');
    directives();
    if (peek() === '{') balanced('{', '}');
    fields.push(field);
  }
  if (tokens[i++] !== '}' || i !== tokens.length || !fields.length) throw new Error('MULTIPLE_OR_INVALID_OPERATION');
  return { kind, fields };
}

function classifyGraphQL(query) {
  let parsed;
  try { parsed = rootOperation(query); } catch (error) {
    return { kind: 'DENY', operation: 'MIXED_OR_UNKNOWN_MUTATION' };
  }
  const { kind, fields } = parsed;
  if (kind === 'mutation') {
    if (fields.length !== 1) return { kind: 'DENY', operation: 'MIXED_OR_UNKNOWN_MUTATION' };
    const field = fields[0];
    if (AUTH_OPERATION_NAMES.has(field)) return { kind: 'AUTH', operation: field };
    if (BUSINESS_OPERATION_NAMES.has(field)) return { kind: 'BUSINESS', operation: field };
    return { kind: 'DENY', operation: 'MIXED_OR_UNKNOWN_MUTATION' };
  }
  if (fields.some((field) => AUTH_OPERATION_NAMES.has(field) || BUSINESS_OPERATION_NAMES.has(field))) {
    return { kind: 'DENY', operation: 'MUTATION_FIELD_IN_READ' };
  }
  return { kind: 'READ', operation: 'READ' };
}

function operationName(query) {
  const c = classifyGraphQL(query);
  return c.kind === 'READ' ? 'READ' : c.kind === 'AUTH' ? 'AUTH' : c.operation;
}
function exactClaimCode(query, variables) {
  const variableCode = variables && variables.input && variables.input.code;
  return String(variableCode || '') === 'TFACC001' || /\bcode\s*:\s*"TFACC001"/.test(String(query || ''));
}
function clientMutationIdentity(query, variables) {
  const variableId = variables?.input?.clientMutationId;
  const inlineIds = Array.from(String(query || '').matchAll(/\bclientMutationId\s*:\s*"([^"]+)"/g), (match) => match[1]);
  const ids = [...new Set([variableId, ...inlineIds].filter((value) => value !== undefined))];
  if (ids.length !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ids[0])) return null;
  return ids[0];
}
function readAlias(query) {
  const q = String(query || '');
  if (/query\s+useUserQuery\b/.test(q) || /\bcurrentUser\s*\{/.test(q) || (/\buser\s*\{/.test(q) && /\busername\b/.test(q))) return 'tfacUserQuery';
  if (/healthFacilities/.test(q) && /\bid\s*:/.test(q)) return 'tfacFacilityBootstrap';
  if (/query\s+ClaimAdminPicker\b/.test(q) || /\bclaimAdmins\s*\(/.test(q)) return 'tfacAdminBootstrap';
  if (/DiagnosisPicker/.test(q) || /\bdiagnosesStr\s*\(/.test(q)) return 'tfacDiagnosisPicker';
  if (/medicalServicesStr/.test(q)) return 'tfacServicePicker';
  if (/\binsurees\s*\([^)]*chfId\s*:/.test(q)) return 'tfacInsureePicker';
  if (/validateClaimCode/.test(q)) return 'tfacClaimCodeValidation';
  return null;
}
module.exports = { classifyGraphQL, exactClaimCode, clientMutationIdentity, operationName, readAlias };
