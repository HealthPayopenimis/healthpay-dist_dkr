const { operationKind } = require('./issue40-guard');

function safeEvent(request, operation, disposition, extra = {}) {
  return {
    operation,
    disposition,
    method: request.method,
    urlPath: new URL(request.url).pathname,
    httpStatus: extra.httpStatus ?? null,
    mutation: operation !== 'READ',
    auth: operation === 'AUTH',
    forwarded: disposition === 'continued',
  };
}

function record(event) {
  const events = Cypress.env('issue40TransportEvents') || [];
  events.push(event);
  Cypress.env('issue40TransportEvents', events);
}

function writeEvidence() {
  cy.writeFile('cypress/evidence/issue40-transport.json', {
    actor: Cypress.env('issue40Actor') || null,
    businessForwarded: Cypress.env('issue40BusinessForwarded') || 0,
    httpWriteAttempts: Cypress.env('issue40HttpWriteAttempts') || 0,
    events: Cypress.env('issue40TransportEvents') || [],
    note: 'Metadata only. Request/response bodies, variables, query text, credentials, tokens, photos, and beneficiary data are intentionally excluded.',
  }, { log: false });
}

Cypress.Commands.add('issue40Login', () => {
  const credentialFile = Cypress.env('qaCredentialFile');
  const login = (credential) => {
    const username = credential && credential.username;
    const password = credential && credential.password;
    if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
      throw new Error('Issue 40 readonly acceptance requires a protected credential fixture');
    }
    Cypress.env('issue40Actor', username);
    cy.visit('/front/login');
    cy.get('input[type="text"]', { timeout: 120000 }).first().clear().type(username, { log: false });
    cy.get('input[type="password"]').first().clear().type(password, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 60000 }).should('not.include', '/front/login');
  };
  if (credentialFile) {
    cy.readFile(credentialFile, { log: false }).then(login);
    return;
  }
  login({ username: Cypress.env('qaUsername'), password: Cypress.env('qaPassword') });
});

beforeEach(() => {
  Cypress.env('issue40TransportEvents', []);
  Cypress.env('issue40BusinessForwarded', 0);
  Cypress.env('issue40HttpWriteAttempts', 0);
  Cypress.env('issue40ForbiddenUiClicks', 0);
  Cypress.env('issue40ControlledCounts', {});
  Cypress.env('issue40Regions', []);
  Cypress.on('window:before:load', (win) => {
    win.document.addEventListener('click', (event) => {
      const target = event.target;
      if (!target || !target.closest) return;
      const checkbox = target.closest('input[type="checkbox"],.MuiCheckbox-root');
      const control = target.closest('button,[role="button"],label');
      const description = control ? ((control.getAttribute('title') || '') + ' ' + (control.getAttribute('aria-label') || '') + ' ' + control.textContent) : '';
      if (checkbox || (/healthFacility\//.test(win.location.pathname) && /save|حفظ/i.test(description))) {
        Cypress.env('issue40ForbiddenUiClicks', (Cypress.env('issue40ForbiddenUiClicks') || 0) + 1);
        throw new Error('Issue 40 readonly suite attempted a checkbox or facility Save action');
      }
    }, true);
  });
  cy.intercept('POST', '**/graphql', (request) => {
    const kind = operationKind(request.body && request.body.query);
    if (kind === 'READ' || kind === 'AUTH') {
      // Record safe request metadata before forwarding. Do not attach a
      // response callback to unrelated reads: navigation may legitimately
      // cancel them and Cypress turns that cancellation into a test error.
      record(safeEvent(request, kind, 'continued'));
      request.continue();
      return;
    }
    record(safeEvent(request, kind, 'blocked'));
    throw new Error('Issue 40 readonly guard blocked a non-auth GraphQL mutation');
  });
  cy.intercept({ middleware: true }, (request) => {
    if (!['GET', 'HEAD', 'OPTIONS', 'POST'].includes(request.method)) {
      const count = Cypress.env('issue40HttpWriteAttempts') || 0;
      Cypress.env('issue40HttpWriteAttempts', count + 1);
      throw new Error(`Issue 40 readonly guard blocked HTTP ${request.method}`);
    }
    if (request.method === 'POST' && !/\/api\/graphql(?:$|\?)/.test(new URL(request.url).pathname)) {
      const count = Cypress.env('issue40HttpWriteAttempts') || 0;
      Cypress.env('issue40HttpWriteAttempts', count + 1);
      throw new Error('Issue 40 readonly guard blocked non-GraphQL HTTP POST');
    }
    if (request.method === 'POST' && operationKind(request.body && request.body.query) === 'DENY') {
      throw new Error('Issue 40 middleware blocked a GraphQL business mutation before any local reply handler');
    }
    // Do not call continue here: middleware must fall through to the mutation
    // guard and controlled READ handlers. continue would bypass later handlers.
  });
});

afterEach(() => {
  writeEvidence();
});

module.exports = { operationKind };
