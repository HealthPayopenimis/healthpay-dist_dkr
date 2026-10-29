const AUTH_OPERATION_NAMES = new Set(['tokenAuth', 'getCsrfToken', 'refreshToken', 'verifyToken', 'tokenRefresh']);
const BUSINESS_OPERATION_NAMES = new Set([
  'createHealthFacility', 'updateHealthFacility', 'deleteHealthFacility',
  'createLocation', 'updateLocation', 'deleteLocation', 'moveLocation',
]);

function tokens(text) {
  const result = [];
  const pattern = /\s+|#[^\n\r]*|"(?:\\.|[^"\\])*"|[_A-Za-z][_0-9A-Za-z]*|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?|\.\.\.|[!$():=@[\]{|},]/y;
  let offset = 0;
  while (offset < text.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (!match) return null;
    offset = pattern.lastIndex;
    if (!/^\s|^#|^,$/.test(match[0])) result.push(match[0]);
  }
  return result;
}

function skipBalanced(all, index, open, close) {
  if (all[index] !== open) return -1;
  let depth = 0;
  for (let i = index; i < all.length; i += 1) {
    if (all[i] === open) depth += 1;
    if (all[i] === close) depth -= 1;
    if (depth === 0) return i + 1;
  }
  return -1;
}

function rootFields(query) {
  const all = tokens(query);
  if (!all) return null;
  let i = 0;
  let kind = 'query';
  if (all[i] === 'mutation' || all[i] === 'query') {
    kind = all[i++];
    if (/^[_A-Za-z]/.test(all[i] || '')) i += 1;
    if (all[i] === '(') {
      i = skipBalanced(all, i, '(', ')');
      if (i < 0) return null;
    }
  }
  if (all[i] !== '{') return null;
  i += 1;
  const fields = [];
  while (i < all.length && all[i] !== '}') {
    let field = all[i++];
    if (!/^[_A-Za-z]/.test(field)) return null;
    if (all[i] === ':') {
      i += 1;
      field = all[i++];
      if (!/^[_A-Za-z]/.test(field)) return null;
    }
    fields.push(field);
    if (all[i] === '(') {
      i = skipBalanced(all, i, '(', ')');
      if (i < 0) return null;
    }
    if (all[i] === '{') {
      i = skipBalanced(all, i, '{', '}');
      if (i < 0) return null;
    }
  }
  if (all[i] !== '}' || i !== all.length - 1) return null;
  return { kind, fields };
}

function operationKind(query) {
  const text = String(query || '').trim();
  if (!text) return 'DENY';
  const parsed = rootFields(text);
  if (!parsed || !parsed.fields.length) return 'DENY';
  if (parsed.kind !== 'mutation') {
    if (parsed.fields.some((field) => AUTH_OPERATION_NAMES.has(field) || BUSINESS_OPERATION_NAMES.has(field))) return 'DENY';
    return 'READ';
  }
  if (parsed.fields.length !== 1) return 'DENY';
  return AUTH_OPERATION_NAMES.has(parsed.fields[0]) ? 'AUTH' : 'DENY';
}

module.exports = { operationKind };
