const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
function safeStructure(label) {
  cy.document({ log: false }).then((document) => {
    const patterns = { region: /Regions|المحافظات|Régions/i, district: /Districts|المراكز/i, ward: /Municipalities|المدن|Municipalités/i, catchment: /Village Catchments|النطاقات|Bassins versants/i };
    const papers = Array.from(document.querySelectorAll('.MuiPaper-root')).map((paper, index) => ({
      index,
      visible: Boolean(paper.offsetWidth || paper.offsetHeight),
      scopeHeadingKinds: Object.entries(patterns).filter(([,pattern]) => pattern.test(normalize(paper.textContent))).map(([kind]) => kind),
      listRootCount: paper.querySelectorAll('.MuiList-root').length,
      listItemCount: paper.querySelectorAll('.MuiListItem-root').length,
      listItemStructure: Array.from(paper.querySelectorAll('.MuiListItem-root')).slice(0, 4).map((row) => ({ tag: row.tagName, parentTag: row.parentElement.tagName, parentClasses: row.parentElement.className, classes: row.className })),
      progressCount: Array.from(paper.querySelectorAll('[role="progressbar"]')).filter((bar) => bar.offsetWidth || bar.offsetHeight).length,
    }));
    const leafHeadings = Array.from(document.querySelectorAll('.MuiGrid-item')).filter((element) =>
      Object.values(patterns).some((pattern) => pattern.test(normalize(element.textContent))) &&
      !Array.from(element.querySelectorAll('.MuiGrid-item')).some((child) => Object.values(patterns).some((pattern) => pattern.test(normalize(child.textContent)))),
    ).map((element) => ({
      scopeHeadingKinds: Object.entries(patterns).filter(([,pattern]) => pattern.test(normalize(element.textContent))).map(([kind]) => kind),
      paperIndex: papers.length ? Array.from(document.querySelectorAll('.MuiPaper-root')).indexOf(element.closest('.MuiPaper-root')) : -1,
      visible: Boolean(element.offsetWidth || element.offsetHeight),
    }));
    cy.writeFile(`cypress/evidence/issue40-diagnostic-${label}.json`, {
      pathname: document.defaultView.location.pathname,
      papers, leafHeadings,
      readMetadata: Cypress.env('issue40DiagnosticReads') || [],
      businessForwarded: Cypress.env('issue40BusinessForwarded') || 0,
      httpWriteAttempts: Cypress.env('issue40HttpWriteAttempts') || 0,
      forbiddenUiClicks: Cypress.env('issue40ForbiddenUiClicks') || 0,
      note: 'Structure/counts only: no DOM text, field values, query bodies, variables, names, credentials, tokens, photos or beneficiary data.',
    }, { log: false });
  });
}

describe('Issue 40 diagnostic only — restored frontend scope structure', () => {
  it('observes synthetic facility scope structure without editing or treating this as release acceptance', () => {
    Cypress.env('issue40DiagnosticReads', []);
    cy.issue40Login();
    cy.intercept('POST', '**/graphql', (request) => {
      const query = String(request.body?.query || '');
      if (!/\b(locations|userDistricts)\b/.test(query)) return;
      const requestedType = query.match(/\btype\s*:\s*"([RDWV])"/)?.[1] || null;
      request.on('response', (response) => {
        const locationEdges = response.body?.data?.locations?.edges || [];
        const reads = Cypress.env('issue40DiagnosticReads') || [];
        reads.push({ requestedType, httpStatus: response.statusCode, locationCount: locationEdges.length, responseTypes: [...new Set(locationEdges.map((edge) => edge.node?.type).filter(Boolean))], userDistrictsReturned: Boolean(response.body?.data?.userDistricts), errorCount: response.body?.errors?.length || 0 });
        Cypress.env('issue40DiagnosticReads', reads);
      });
    });
    cy.visit('/front/location/healthFacilities');
    cy.get('tbody tr', { timeout: 120000 }).then(($rows) => {
      const code = ['TFAC001', 'TFAC0001'].find((candidate) => $rows.toArray().some((row) => Array.from(row.querySelectorAll('td')).some((cell) => normalize(cell.textContent) === candidate)));
      if (!code) throw new Error('Existing synthetic facility not visible; no fixture fabricated.');
      return cy.get('tbody tr').filter((_,row) => Array.from(row.querySelectorAll('td')).some((cell) => normalize(cell.textContent) === code)).first().find('td').filter((_,cell) => normalize(cell.textContent) === code).first().dblclick();
    });
    cy.location('pathname', { timeout: 120000 }).should('include', '/front/location/healthFacility/');
    safeStructure('entry');
    cy.get('body', { timeout: 120000 }).should(($body) => {
      const active = $body.find('[role="progressbar"]').toArray().filter((bar) => bar.offsetWidth || bar.offsetHeight);
      expect(active.length, 'visible pending progress indicators').to.eq(0);
    });
    safeStructure('settled');
  });
  afterEach(() => safeStructure('final'));
});
