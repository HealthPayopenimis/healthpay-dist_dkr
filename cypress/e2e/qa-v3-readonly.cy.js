import '../support/qa-v3-readonly';

const SCENARIO_A_CHF_ID = '29001011234567';
const MALFORMED_CHF_ID = '2900101123456'; // 13 digits; the backend national-ID envelope is exactly 14 digits.
const DUPLICATE_ARABIC = /الرقم القومي.*(?:مكرر|موجود|مستخدم|مسجل|غير متاح)/;
const LENGTH_ARABIC = 'الرقم القومي يجب أن يتكون من 14 رقمًا بالضبط.';
const OPTIONAL_WARD_ARABIC = 'المدينة / الحي (اختياري)';
const REGION_LABEL_ARABIC = 'المحافظة';
const DISTRICT_LABEL_ARABIC = 'المركز / الحي';
const WARD_LABEL_ARABIC = 'المدينة / الحي';
const VILLAGE_LABEL_ARABIC = 'الشياخة / القرية';

const TEST_TITLES = [
  'duplicate ScenarioA head number is rejected on the new family form',
  'malformed 13-digit number is rejected by the real validity query',
  'editing the existing ScenarioA head passes its own UUID to validity and is accepted',
  'new family COD-AB location leaves the optional ward blank and selects the village',
  'legacy location hierarchy selects and clear-reselects every control',
  'registers exactly the complete QA-V3 readonly inventory',
];

function fieldRoot(label) {
  return cy.contains('label', label).filter(':visible').first().closest('.MuiFormControl-root');
}

function inputFor(label) {
  return fieldRoot(label).find('input').first();
}

function waitForNumberValidity(alias = 'insureeNumberValidity') {
  return cy.wait(`@${alias}`, { timeout: 30000 });
}

function watchNumberValidity(alias, expectedUuid) {
  cy.intercept('POST', '**/graphql', (req) => {
    const query = String(req.body?.query || '');
    if (!/insureeNumberValidity/.test(query)) return;
    const variables = req.body?.variables || {};
    expect(variables.insuranceNumber, 'insureeNumberValidity insuranceNumber').to.be.a('string');
    if (expectedUuid === undefined) {
      expect(variables, 'new-form validity variables').not.to.have.property('insureeUuid');
    } else {
      expect(variables.insureeUuid, 'edit-form validity insureeUuid').to.eq(expectedUuid);
    }
    req.alias = alias;
  });
}

function enterNumber(value) {
  inputFor('الرقم القومي').should('be.visible').clear().type(value, { log: false });
}

function selectSuggestion(label, code) {
  const root = fieldRoot(label);
  root.find('input').first().click().clear().type(code, { log: false });
  cy.contains('li', new RegExp(`\\b${Cypress._.escapeRegExp(code)}\\b`), { timeout: 30000 })
    .filter(':visible')
    .first()
    .click();
}

function selectedValue(label) {
  return inputFor(label).invoke('val');
}

function clearPicker(label) {
  const root = fieldRoot(label);
  // LocationPicker exposes the Material-UI clear control; AutoSuggestion's source
  // renders the same trailing IconButton without a translated aria-label.
  root.find('button.MuiAutocomplete-clearIndicator, button[aria-label="clear"]').first().click({ force: true });
}

function getScenarioAUuid() {
  // This is deliberately a browser cy.request with no Authorization header or
  // token logging. The authenticated browser session supplies the server context.
  return cy.window({ log: false }).then((win) => cy.request({
    method: 'POST',
    url: '/api/graphql',
    headers: { 'X-CSRFToken': win.localStorage.getItem('csrfToken'), 'X-Requested-With': 'XMLHttpRequest' },
    body: {
      query: `query ScenarioAHeadUuid {
        insurees(chfId: "${SCENARIO_A_CHF_ID}", ignoreLocation: true, first: 1) {
          edges { node { uuid } }
        }
      }`,
    },
    log: false,
  })).then((response) => {
    expect(response.status, 'authenticated UUID lookup status').to.eq(200);
    expect(response.body?.errors, 'authenticated UUID lookup GraphQL errors').to.not.exist;
    const uuid = response.body?.data?.insurees?.edges?.[0]?.node?.uuid;
    expect(uuid, 'ScenarioA head UUID').to.match(/^[0-9a-f-]{36}$/i);
    return uuid;
  });
}

describe('HealthPay QA-V3 — readonly browser contract', () => {
  it(TEST_TITLES[0], () => {
    cy.login();
    watchNumberValidity('newDuplicateValidity');
    cy.visit('/front/insuree/family');
    cy.get('#root', { timeout: 60000 }).should('be.visible');
    inputFor('الرقم القومي').should('be.visible');

    enterNumber(SCENARIO_A_CHF_ID);
    waitForNumberValidity('newDuplicateValidity').then(({ request }) => {
      expect(request.body.query).to.include('insureeNumberValidity');
      expect(request.body.variables).to.deep.include({ insuranceNumber: SCENARIO_A_CHF_ID });
      expect(request.body.variables).not.to.have.property('insureeUuid');
    });
    fieldRoot('الرقم القومي').invoke('text').should('match', DUPLICATE_ARABIC);
  });

  it(TEST_TITLES[1], () => {
    cy.login();
    watchNumberValidity('malformedValidity');
    cy.visit('/front/insuree/family');
    cy.get('#root', { timeout: 60000 }).should('be.visible');

    enterNumber(MALFORMED_CHF_ID);
    waitForNumberValidity('malformedValidity').then(({ request }) => {
      expect(request.body.query).to.include('insureeNumberValidity');
      expect(request.body.variables).to.deep.include({ insuranceNumber: MALFORMED_CHF_ID });
      expect(request.body.variables).not.to.have.property('insureeUuid');
    });
    fieldRoot('الرقم القومي').invoke('text').should('contain', LENGTH_ARABIC);
  });

  it(TEST_TITLES[2], () => {
    cy.login();
    getScenarioAUuid().then((uuid) => {
      watchNumberValidity('editValidity', uuid);
      cy.visit(`/front/insuree/insurees/insuree/${uuid}`);
      cy.get('#root', { timeout: 60000 }).should('be.visible');
      inputFor('الرقم القومي').should('have.value', SCENARIO_A_CHF_ID);

      // Re-enter the same value so the real edit-path validity query is observed.
      enterNumber(SCENARIO_A_CHF_ID);
      waitForNumberValidity('editValidity').then(({ request }) => {
        expect(request.body.query).to.include('insureeNumberValidity');
        expect(request.body.variables).to.deep.include({
          insuranceNumber: SCENARIO_A_CHF_ID,
          insureeUuid: uuid,
        });
      });
      fieldRoot('الرقم القومي').invoke('text').should('not.match', DUPLICATE_ARABIC);
      cy.location('pathname').should('include', `/front/insuree/insurees/insuree/${uuid}`);
    });
  });

  it(TEST_TITLES[3], () => {
    cy.login();
    cy.visit('/front/insuree/family');
    cy.get('#root', { timeout: 60000 }).should('be.visible');

    selectSuggestion(REGION_LABEL_ARABIC, 'EG01');
    selectSuggestion(DISTRICT_LABEL_ARABIC, 'EG0109');
    fieldRoot(OPTIONAL_WARD_ARABIC).should('be.visible');
    selectedValue(OPTIONAL_WARD_ARABIC).should('eq', '');
    selectSuggestion(VILLAGE_LABEL_ARABIC, 'EG010901');
    selectedValue(VILLAGE_LABEL_ARABIC).should('contain', 'EG010901');
    // Do not click Save: this is a UI state assertion only.
  });

  it(TEST_TITLES[4], () => {
    cy.login();
    cy.visit('/front/insuree/family');
    cy.get('#root', { timeout: 60000 }).should('be.visible');

    selectSuggestion(REGION_LABEL_ARABIC, 'EG-01');
    selectSuggestion(DISTRICT_LABEL_ARABIC, 'EG-01-D01');
    selectSuggestion(WARD_LABEL_ARABIC, 'EG-01-D01-W01');
    selectSuggestion(VILLAGE_LABEL_ARABIC, 'EG-01-D01-W01-V01');
    selectedValue(REGION_LABEL_ARABIC).should('contain', 'EG-01');
    selectedValue(DISTRICT_LABEL_ARABIC).should('contain', 'EG-01-D01');
    selectedValue(WARD_LABEL_ARABIC).should('contain', 'EG-01-D01-W01');
    selectedValue(VILLAGE_LABEL_ARABIC).should('contain', 'EG-01-D01-W01-V01');

    // Exercise the clear path and reselect path for the dependent controls.
    clearPicker(VILLAGE_LABEL_ARABIC);
    clearPicker(WARD_LABEL_ARABIC);
    selectSuggestion(WARD_LABEL_ARABIC, 'EG-01-D01-W01');
    selectSuggestion(VILLAGE_LABEL_ARABIC, 'EG-01-D01-W01-V01');
    selectedValue(WARD_LABEL_ARABIC).should('contain', 'EG-01-D01-W01');
    selectedValue(VILLAGE_LABEL_ARABIC).should('contain', 'EG-01-D01-W01-V01');
  });

  it(TEST_TITLES[5], function () {
    const titles = this.test.parent.tests.map((test) => test.title);
    expect(titles, 'QA-V3 readonly test inventory').to.deep.eq(TEST_TITLES);
    expect(titles).to.have.length(6);
  });
});
