const BASE = Cypress.config('baseUrl');

function loginWith(username, password) {
  cy.clearCookies();
  cy.visit('/front/login');
  cy.get('input[type="text"]', { timeout: 30000 }).first().clear().type(username);
  cy.get('input[type="password"]', { timeout: 30000 }).first().clear().type(password, { log: false });
  cy.get('button[type="submit"]').click();
  cy.url({ timeout: 30000 }).should('not.include', '/front/login');
  cy.request({ url: '/api/core/users/current_user/', failOnStatusCode: false })
    .its('status')
    .should('eq', 200);
}

function requestReport(path, evidencePath) {
  return cy.request({
    method: 'GET',
    url: path,
    encoding: 'binary',
    followRedirect: false,
    failOnStatusCode: false,
    timeout: 120000,
  }).then((response) => {
    const metadata = {
      path,
      status: response.status,
      contentType: response.headers['content-type'] || null,
      location: response.headers.location || null,
      bodyBytes: typeof response.body === 'string' ? response.body.length : null,
    };
    cy.writeFile(evidencePath, metadata);
    return cy.wrap(metadata, { log: false });
  });
}

describe('QA Fix V2 — report runtime and session continuity', () => {
  it('hpadmin generates the QA-named Simple claim report without HTTP 500', () => {
    cy.fixture('cred').then((cred) => {
      loginWith(cred.username, cred.password);
    });
    requestReport(
      '/api/report/insuree_family_overview/pdf/?dateFrom=2026-01-01&dateTo=2026-12-31',
      'cypress/evidence/qa-fix-v2-report-simple-claim.json',
    ).then((metadata) => {
      expect(metadata.status).to.eq(200);
      expect(metadata.contentType || '').to.include('application/pdf');
      expect(metadata.bodyBytes || 0).to.be.greaterThan(0);
    });
    cy.request({ url: '/api/core/users/current_user/', failOnStatusCode: false })
      .its('status')
      .should('eq', 200);
  });

  it('hpofficer product-filter report request does not expire the active session', () => {
    cy.fixture('cred').then((cred) => {
      loginWith(cred.officerUsername, cred.officerPassword);
    });
    requestReport(
      '/api/report/policy_renewals/pdf/?date_start=2026-01-01&date_end=2026-12-31&requested_product_id=1',
      'cypress/evidence/qa-fix-v2-report-product-filter.json',
    ).then((metadata) => {
      expect(metadata.status).not.to.eq(500);
      expect(metadata.status).not.to.eq(302);
      expect(metadata.location || '').not.to.include('/front/login');
    });
    cy.request({ url: '/api/core/users/current_user/', failOnStatusCode: false })
      .its('status')
      .should('eq', 200);
    cy.url().should('not.include', '/front/login');
  });
});
