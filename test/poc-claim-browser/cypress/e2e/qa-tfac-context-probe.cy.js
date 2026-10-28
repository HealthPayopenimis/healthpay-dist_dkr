function contextFlags(root) {
  const element = root.querySelector('label') || root;
  const key = Object.keys(element).find((k) => /^__react(Fiber|InternalInstance)\$/.test(k));
  let fiber = key ? element[key] : null;
  while (fiber) {
    const form = fiber.stateNode;
    if (form && typeof form.canSave === 'function' && form.props && Object.prototype.hasOwnProperty.call(form.props, 'claimAdminContext')) {
      const p = form.props, c = p.claimAdminContext || {}, f = p.currentUserHF || p.userHealthFacilityFullPath, a = p.currentClaimAdmin || p.claimAdmin;
      return {
        facilityPresent: !!f, facilityUuidPresent: !!f?.uuid, facilityTargetMatches: f?.code === 'TFAC001',
        fetchedFacility: !!p.fetchedUserHF, fetchingFacility: !!p.fetchingUserHF, facilityErrorPresent: !!p.errorUserHF,
        currentAdminPresent: !!p.currentClaimAdmin, selectedAdminPresent: !!p.claimAdmin,
        adminUuidPresent: !!a?.uuid, adminActorMatches: a?.code === 'TFACCLM',
        adminFacilityUuidPresent: !!a?.healthFacility?.uuid, adminFacilityMatches: !!f?.uuid && a?.healthFacility?.uuid === f.uuid,
        usernameMatches: p.currentUsername === 'TFACCLM',
        contextPresent: !!p.claimAdminContext, contextFetched: !!c.fetched, contextLoading: !!c.isLoading,
        contextErrorPresent: !!c.error, contextScopeMatches: !!f?.uuid && c.scopeUuid === f.uuid,
        contextUsernameMatches: c.username === p.currentUsername, contextAdminMatches: !!a?.uuid && c.adminUuid === a.uuid,
        claimUuidPresent: !!form.state?.claim_uuid, saved: !!form.state?.isSaved,
      };
    }
    fiber = fiber.return;
  }
  return null;
}
describe('Read-only actual connected claim context diagnostic', () => {
  afterEach(() => {
    cy.get('#root').then(($root) => cy.writeFile('cypress/evidence/tfac-actual-connected-context-flags.json', {
      flags: contextFlags($root[0]), businessForwarded: Cypress.env('countBusinessForwarded') || 0,
      labels: $root.find('label').map((_, el) => String(el.textContent || '').replace(/\*/g, '').trim()).get(),
    }, { log: false }));
  });
  it('captures actual state after an authenticated administrator query completes, without modifying state', () => {
    cy.intercept('POST', '**/api/graphql', (req) => {
      if (/query\s+ClaimAdminPicker/.test(req.body?.query || '')) req.alias = 'actualAdminContextQuery';
    });
    cy.login();
    cy.visit('/front/claim/healthFacilities/claim');
    cy.wait('@actualAdminContextQuery').its('response.statusCode').should('eq', 200);
    cy.get('#root').should(($root) => {
      const flags = contextFlags($root[0]);
      expect(flags, 'actual ClaimForm instance').not.to.equal(null);
      expect(flags.contextLoading, 'administrator request completion reflected in actual props').to.equal(false);
    });
    cy.then(() => expect(Cypress.env('countBusinessForwarded') || 0).to.equal(0));
  });
});
