const FACILITY_CODE_CANDIDATES = ['TFAC0001', 'TFAC001'];
const LIST_ROUTE = '/front/location/healthFacilities';
const EDIT_ROUTE_FRAGMENT = '/front/location/healthFacility/';
const labels = {
  region: /Regions|المحافظات|Régions/i,
  district: /Districts|المراكز/i,
  ward: /Municipalities|المدن|Municipalités/i,
  village: /Village Catchments|النطاقات|Bassins versants/i,
};
const localFixture = {
  districtA: { id: 9401, uuid: '94010000-0000-4000-8000-000000000001', type: 'D', code: 'I40-A-D', name: 'Synthetic local A district' },
  districtB: { id: 9402, uuid: '94020000-0000-4000-8000-000000000002', type: 'D', code: 'I40-B-D', name: 'Synthetic local B district' },
  wardA: { id: 9501, uuid: '95010000-0000-4000-8000-000000000001', type: 'W', code: 'I40-A-W', name: 'Synthetic local A ward' },
  villageAWard: { id: 9601, uuid: '96010000-0000-4000-8000-000000000001', type: 'V', code: 'I40-A-V-W', name: 'Synthetic local ward village' },
  villageBDirect: { id: 9602, uuid: '96020000-0000-4000-8000-000000000002', type: 'V', code: 'I40-B-V-D', name: 'Synthetic local direct village' },
};
const normalized = (text) => String(text || '').replace(/\s+/g, ' ').trim();

function assertNoBusinessForwarding() {
  cy.then(() => {
    expect(Cypress.env('issue40BusinessForwarded') || 0, 'business mutations forwarded').to.eq(0);
    expect(Cypress.env('issue40HttpWriteAttempts') || 0, 'non-GraphQL writes').to.eq(0);
    expect(Cypress.env('issue40ForbiddenUiClicks') || 0, 'checkbox or facility Save clicks').to.eq(0);
  });
}
function recordDomMetadata(label) {
  cy.document({ log: false }).then((document) => {
    cy.writeFile(`cypress/evidence/issue40-dom-${label}.json`, {
      pathname: document.defaultView.location.pathname,
      scopeLabels: ['regions', 'districts', 'wards', 'catchments'],
      panelCount: document.querySelectorAll('.MuiPaper-root').length,
      visibleProgressCount: Array.from(document.querySelectorAll('[role="progressbar"]')).filter((e) => e.offsetWidth || e.offsetHeight).length,
      inputMetadata: Array.from(document.querySelectorAll('input:not([type="password"]):not([type="hidden"]),textarea')).map((input) => ({ type: input.type, disabled: input.disabled, visible: Boolean(input.offsetWidth || input.offsetHeight) })),
      note: 'Metadata only; field values, DOM text, request bodies, variables, tokens, photos and beneficiary data excluded.',
    }, { log: false });
  });
}
function paper(titlePattern) {
  return cy.get('.MuiGrid-item').filter((_, element) =>
    titlePattern.test(normalized(element.textContent)) &&
    !Array.from(element.querySelectorAll('.MuiGrid-item')).some((child) => titlePattern.test(normalized(child.textContent))),
  ).first().closest('.MuiPaper-root');
}
function rowsIn(title) { return paper(title).find('.MuiList-root > .MuiListItem-root'); }
function clickRow(title, code) {
  rowsIn(title).filter((_, row) => normalized(row.textContent).startsWith(`${code} -`)).first().should('be.visible').click();
}
function openExistingFacility() {
  cy.visit(LIST_ROUTE);
  cy.get('tbody tr, .MuiTableBody-root tr', { timeout: 120000 }).then(($rows) => {
    const code = FACILITY_CODE_CANDIDATES.find((candidate) => $rows.toArray().some((row) =>
      Array.from(row.querySelectorAll('td')).some((cell) => normalized(cell.textContent) === candidate)));
    if (!code) throw new Error('No pre-existing synthetic TFAC facility visible; no fixture invented.');
    Cypress.env('issue40FacilityCode', code);
    return cy.get('tbody tr, .MuiTableBody-root tr').filter((_, row) =>
      Array.from(row.querySelectorAll('td')).some((cell) => normalized(cell.textContent) === code)).first().dblclick();
  });
  cy.location('pathname', { timeout: 120000 }).should('include', EDIT_ROUTE_FRAGMENT);
  Object.values(labels).forEach((label) => paper(label).should('exist'));
}
function regionMetadata(response) {
  const nodes = response?.body?.data?.locations?.edges?.map((edge) => edge.node).filter(Boolean) || [];
  if (nodes.length < 2) throw new Error('Two live regions needed for the two-parent regression; no regions fabricated.');
  const safe = nodes.slice(0, 2).map(({ id, uuid, type, code }) => ({ id, uuid, type, code }));
  expect(safe.every((node) => node.uuid && node.type === 'R'), 'live region metadata').to.eq(true);
  Cypress.env('issue40Regions', safe);
}
function prepareControlledRegions() {
  cy.intercept('POST', '**/graphql', (request) => {
    const query = String(request.body?.query || '');
    if (!/\blocations\s*\(/.test(query) || !/\btype\s*:\s*"R"/.test(query)) return;
    request.alias = 'issue40Regions';
    request.continue((response) => regionMetadata(response));
  });
}
function body(nodes) {
  return { data: { locations: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null }, totalCount: nodes.length } } };
}
function installControlledChildTransport({ delayedOldWard = false } = {}) {
  cy.intercept('POST', '**/graphql', (request) => {
    const query = String(request.body?.query || '');
    const type = query.match(/\btype\s*:\s*"([RDWV])"/)?.[1];
    const parentUuid = query.match(/\bparent_Uuid\s*:\s*"([^"]+)"/)?.[1];
    const [regionA, regionB] = Cypress.env('issue40Regions') || [];
    if (!type || !parentUuid || !regionA || !regionB) return;
    const reply = (alias, nodes, delay = 0) => {
      request.alias = alias;
      const counts = Cypress.env('issue40ControlledCounts') || {};
      counts[alias] = (counts[alias] || 0) + 1;
      Cypress.env('issue40ControlledCounts', counts);
      request.reply({ statusCode: 200, delay, body: body(nodes) });
    };
    if (type === 'D' && parentUuid === regionA.uuid) return reply('issue40DistrictA', [localFixture.districtA]);
    if (type === 'D' && parentUuid === regionB.uuid) return reply('issue40DistrictB', [localFixture.districtB]);
    if (type === 'W' && parentUuid === localFixture.districtA.uuid) return reply('issue40OldWard', [localFixture.wardA], delayedOldWard ? 1200 : 0);
    if (type === 'V' && parentUuid === localFixture.wardA.uuid) return reply('issue40VillageUnderWardA', [localFixture.villageAWard]);
    if (type === 'W' && parentUuid === localFixture.districtB.uuid) return reply('issue40WardBEmpty', []);
    if (type === 'V' && parentUuid === localFixture.districtB.uuid) return reply('issue40DirectVillageB', [localFixture.villageBDirect]);
  });
}
function clickRegion(index) {
  return cy.then(() => {
    const regions = Cypress.env('issue40Regions') || [];
    expect(regions, 'live region metadata').to.have.length.at.least(2);
    return clickRow(labels.region, regions[index].code);
  });
}
function preparePath(options) {
  cy.issue40Login();
  prepareControlledRegions();
  installControlledChildTransport(options);
  openExistingFacility();
  cy.wait('@issue40Regions').then(({ response }) => regionMetadata(response));
}
function chooseParentA() {
  clickRegion(0);
  cy.wait('@issue40DistrictA').its('response.statusCode').should('eq', 200);
  clickRow(labels.district, 'I40-A-D');
}

describe('HealthPay Issue 40 — no-write catchment browser acceptance', () => {
  it('enters the live synthetic facility and mounts all four scope panels without edits', () => {
    cy.issue40Login();
    openExistingFacility();
    assertNoBusinessForwarding();
    recordDomMetadata('entry-panel');
  });
  it('clears lower panels and rejects a delayed old-parent response after a region switch', () => {
    preparePath({ delayedOldWard: true });
    chooseParentA();
    clickRegion(1);
    cy.wait('@issue40DistrictB').its('response.statusCode').should('eq', 200);
    paper(labels.ward).should('not.contain', 'I40-A-W');
    paper(labels.village).should('not.contain', 'I40-A-V-W');
    cy.wait('@issue40OldWard').its('response.statusCode').should('eq', 200);
    paper(labels.ward).should('not.contain', 'I40-A-W');
    paper(labels.village).should('not.contain', 'I40-A-V-W');
    assertNoBusinessForwarding();
    recordDomMetadata('stale-switch');
  });
  it('follows district-to-ward-to-village with the selected ward as parent', () => {
    preparePath();
    chooseParentA();
    cy.wait('@issue40OldWard').its('response.statusCode').should('eq', 200);
    clickRow(labels.ward, 'I40-A-W');
    cy.wait('@issue40VillageUnderWardA').its('response.statusCode').should('eq', 200);
    rowsIn(labels.village).contains('I40-A-V-W').should('be.visible');
    assertNoBusinessForwarding();
    recordDomMetadata('legacy-ward-path');
  });
  it('same-parent re-selection does not start a duplicate child-fetch loop', () => {
    preparePath();
    clickRegion(0);
    cy.wait('@issue40DistrictA').its('response.statusCode').should('eq', 200);
    clickRegion(0);
    cy.then(() => expect((Cypress.env('issue40ControlledCounts') || {}).issue40DistrictA, 'same-parent requests').to.eq(1));
    assertNoBusinessForwarding();
    recordDomMetadata('same-parent-no-loop');
  });
  it('uses direct district-to-village only after an empty ward response', () => {
    preparePath();
    clickRegion(1);
    cy.wait('@issue40DistrictB').its('response.statusCode').should('eq', 200);
    clickRow(labels.district, 'I40-B-D');
    cy.wait('@issue40WardBEmpty').its('response.statusCode').should('eq', 200);
    cy.wait('@issue40DirectVillageB').its('response.statusCode').should('eq', 200);
    paper(labels.ward).should('not.contain', 'I40-B-W');
    rowsIn(labels.village).contains('I40-B-V-D').should('be.visible');
    assertNoBusinessForwarding();
    recordDomMetadata('direct-district-village');
  });
  afterEach(() => {
    assertNoBusinessForwarding();
    cy.then(() => cy.writeFile('cypress/evidence/issue40-summary.json', {
      actor: Cypress.env('issue40Actor'), facilityCode: Cypress.env('issue40FacilityCode'),
      controlledRequestCounts: Cypress.env('issue40ControlledCounts') || {},
      businessForwarded: Cypress.env('issue40BusinessForwarded') || 0,
      httpWriteAttempts: Cypress.env('issue40HttpWriteAttempts') || 0,
      forbiddenUiClicks: Cypress.env('issue40ForbiddenUiClicks') || 0,
      note: 'Local synthetic transport only, no Save/checkbox actions or business writes. No query, variables, tokens, photos or beneficiary data.',
    }, { log: false }));
  });
});
