const { classifyGraphQL, exactClaimCode, clientMutationIdentity, readAlias } = require('./qa-tfac-guard');

function safeEvent(request, operation, disposition) {
  return {
    operation,
    disposition,
    method: request.method,
    url: request.url,
    mutation: operation !== 'READ',
    auth: operation === 'AUTH',
    forwarded: disposition === 'continued',
    requestedAt: new Date().toISOString(),
  };
}

function writeJournal() {
  cy.writeFile('cypress/evidence/tfac-readonly-transport.json', {
    actor: Cypress.env('qaActor') || null,
    countBusinessForwarded: Cypress.env('countBusinessForwarded') || 0,
    countDistinctCreateAttempts: (Cypress.env('qaSaveMutationIds') || []).length,
    events: Cypress.env('qaTransportEvents') || [],
    note: 'Metadata only. Request/response bodies, variables, query text, credentials, tokens, and passwords are intentionally excluded.',
  }, { log: false });
}

Cypress.Commands.add('login', () => {
  const username = Cypress.env('qaUsername');
  const password = Cypress.env('qaPassword');
  if (username !== 'TFACCLM' || typeof password !== 'string' || !password) {
    throw new Error('Readonly TFAC acceptance requires injected qaUsername=TFACCLM and a non-empty qaPassword');
  }
  Cypress.env('qaActor', username);
  cy.visit('/front/login');
  cy.get('input[type="text"]', { timeout: 120000 }).first().clear().type(username, { log: false });
  cy.get('input[type="password"]').first().clear().type(password, { log: false });
  cy.get('button[type="submit"]').click();
  cy.url({ timeout: 60000 }).should('not.include', '/front/login');
});

beforeEach(() => {
  Cypress.env('qaTransportEvents', []);
  Cypress.env('countBusinessForwarded', 0);
  Cypress.env('qaSaveMutationIds', []);
  cy.intercept('POST', '**/graphql', (request) => {
    const query = request.body && request.body.query;
    const variables = request.body && request.body.variables;
    const classification = classifyGraphQL(query);
    const events = Cypress.env('qaTransportEvents') || [];

    if (classification.kind === 'READ' || classification.kind === 'AUTH') {
      if (classification.kind === 'READ') {
        const alias = readAlias(query);
        // Opening the picker and its debounced typed search are different reads.
        // Only the exact authorized typed search establishes selection readiness.
        if (alias && (alias !== 'tfacServicePicker' || variables?.searchString === 'TSVC01')) request.alias = alias;
      }
      events.push(safeEvent(request, classification.kind === 'AUTH' ? 'AUTH' : 'READ', 'continued'));
      Cypress.env('qaTransportEvents', events);
      request.continue();
      return;
    }

    if (classification.kind === 'BUSINESS' && classification.operation === 'createClaim' && exactClaimCode(query, variables)) {
      const id = clientMutationIdentity(query, variables);
      if (!id) throw new Error('Readonly simulation denied missing or ambiguous create mutation identity');
      const ids = Cypress.env('qaSaveMutationIds') || [];
      const automaticTransportRetry = ids.includes(id);
      if (!automaticTransportRetry) { ids.push(id); request.alias = 'tfacCreateClaim'; }
      Cypress.env('qaSaveMutationIds', ids);
      events.push({ ...safeEvent(request, classification.operation, 'simulated_network_error'), operatorAttempt: ids.indexOf(id) + 1, automaticTransportRetry });
      Cypress.env('qaTransportEvents', events);
      request.reply({ forceNetworkError: true });
      return;
    }

    events.push(safeEvent(request, classification.operation, 'blocked'));
    Cypress.env('qaTransportEvents', events);
    throw new Error(`Readonly QA blocked ${classification.operation}; no business mutation was continued.`);
  });
});

afterEach(() => writeJournal());
