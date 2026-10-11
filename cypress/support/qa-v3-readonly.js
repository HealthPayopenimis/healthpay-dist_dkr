// Deliberately excludes upstream setup/seed/delete commands.
Cypress.Commands.add('login', () => {
  cy.fixture('cred', { log: false }).then((c) => {
    cy.visit('/front/login');
    cy.get('input[type="text"]', { timeout: 120000 }).first().clear().type(c.username, { log: false });
    cy.get('input[type="password"]').first().clear().type(c.password, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 60000 }).should('not.include', '/front/login');
    cy.request({ url: '/api/core/users/current_user/', failOnStatusCode: false, log: false }).its('status').should('eq', 200);
  });
});
beforeEach(() => {
  cy.intercept('POST', '**/graphql', (req) => {
    const query = req.body && req.body.query || '';
    if (/\bmutation\b/.test(query) && !/\b(tokenAuth|getCsrfToken|refreshToken|verifyToken|tokenRefresh)\b/.test(query)) {
      throw new Error('Read-only QA blocked a business mutation; nothing submitted.');
    }
  });
});
