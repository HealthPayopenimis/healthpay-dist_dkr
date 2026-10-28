const CLAIM_LIST_ROUTE = '/front/claim/healthFacilities';
const CLAIM_NEW_ROUTE = '/front/claim/healthFacilities/claim';
const RIGHTS = [111002, 111005];
const FORBIDDEN_RIGHT = 111008;
const ACTOR = 'TFACCLM';
const FACILITY = 'TFAC001';
const CLAIM_CODE = 'TFACC001';
const INSUREE_NID = '29001010190019';
const DIAGNOSIS_CODE = 'TDX001';
const SERVICE_CODE = 'TSVC01';
const EXPLANATION = 'TEST-TFAC — مطالبة اختبارية — ليست مطالبة طبية حقيقية';

// This document is deliberately a read query. It is sent with cy.request only to
// prove the authenticated actor and scope in the same browser session; it never
// contains a mutation field, create input, or write variables.
const SCOPED_ACTOR_READ_QUERY = `query ScopedClaimActorRead {
  user {
    username
    rights
    claimAdmin { id code }
    healthFacility { id }
  }
}`;

function normalized(text) {
  return String(text || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}

function fieldRoot(labels) {
  const expected = (Array.isArray(labels) ? labels : [labels]).map(normalized);
  return cy.get('label').filter((_, element) => {
    const actual = normalized(element.textContent);
    return expected.some((candidate) => actual === candidate || actual.startsWith(`${candidate} `));
  }).filter(':visible').first().closest('.MuiFormControl-root');
}

function enabledField(labels) {
  return fieldRoot(labels).find('input:not(:disabled), textarea:not(:disabled)').first()
    .should('be.visible').should('be.enabled');
}

function assertResponseOk(response, label) {
  expect(response, `${label} response`).to.exist;
  expect(response.statusCode, `${label} HTTP status`).to.eq(200);
  expect(response.body && response.body.errors, `${label} GraphQL errors`).to.not.exist;
}

function normalizeRelayId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (/^\d+$/.test(String(value))) return Number(value);
  try {
    const decoded = atob(String(value));
    const tail = decoded.split(':').pop();
    return /^\d+$/.test(tail) ? Number(tail) : String(value);
  } catch (error) {
    return String(value);
  }
}

function assertRightsAndActor(response) {
  assertResponseOk(response, 'user query');
  const user = response.body?.data?.user;
  expect(user, 'live user payload').to.be.an('object');
  expect(user.username, 'authenticated actor').to.eq(ACTOR);
  const rights = (user.rights || []).map(String);
  expect(rights, 'live rights').to.include.members(RIGHTS.map(String));
  expect(rights, 'review-only right absent').not.to.include(String(FORBIDDEN_RIGHT));
  expect(user.claimAdmin?.code, 'scoped claim administrator').to.eq(ACTOR);
  expect(normalizeRelayId(user.claimAdmin?.id), 'claim administrator id').to.eq(2);
  expect(normalizeRelayId(user.healthFacility?.id), 'user facility id').to.eq(1);
}

function assertReadQueryCannotWrite() {
  expect(SCOPED_ACTOR_READ_QUERY, 'scoped actor query').not.to.match(/\bmutation\b/i);
  expect(SCOPED_ACTOR_READ_QUERY, 'scoped actor query').not.to.match(/\b(create|update|delete|submit|process)[A-Z_]/i);
}

function assertScopedActorByReadQuery() {
  assertReadQueryCannotWrite();
  cy.window({ log: false }).then((windowObject) => cy.request({
    method: 'POST',
    url: '/api/graphql',
    log: false,
    headers: {
      'X-CSRFToken': windowObject.localStorage.getItem('csrfToken') || '',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: { query: SCOPED_ACTOR_READ_QUERY },
  })).then((response) => assertRightsAndActor({ statusCode: response.status, body: response.body }));
}

function chooseToday(labels) {
  fieldRoot(labels).find('input').first().should('be.visible').then(($input) => {
    if ($input.is(':disabled')) {
      expect(String($input.val() || ''), 'disabled source date value').to.not.equal('');
      return;
    }
    cy.wrap($input).click();
    cy.get('[role="dialog"] button.MuiPickersDay-day').filter((_, element) =>
      !element.className.includes('hidden') && element.textContent.trim() === String(new Date().getDate()),
    ).last().click();
    cy.get('[role="dialog"] button').filter((_, element) =>
      /موافق|OK|Accept|Done/.test(normalized(element.textContent)),
    ).last().click();
    cy.wrap($input).should(($dateInput) => {
      expect(String($dateInput.val() || ''), 'visible date picker result').to.not.equal('');
    });
  });
}

function visibleAddFab() {
  return cy.get('button.MuiFab-root:visible').last();
}

function addReadinessText($button) {
  const parent = $button.parent();
  return normalized([
    $button.attr('aria-label'),
    $button.attr('title'),
    $button.attr('aria-describedby'),
    parent.attr('title'),
    parent.text(),
  ].filter(Boolean).join(' '));
}

function waitForVisibleAddReadiness() {
  let observedLoadingDisabled = false;
  visibleAddFab().should(($button) => {
    expect($button, 'visible Add Claim control').to.be.visible;
    if ($button.is(':disabled')) {
      observedLoadingDisabled = true;
      // A disabled state must be operator-understandable, not a silent race.
      expect(addReadinessText($button), 'disabled Add Claim explanation').to.match(
        /loading|wait|retry|facility|administrator|جاري|انتظار|إعادة|مسؤول|منشأة/i,
      );
    } else {
      expect($button.attr('aria-busy'), 'Add Claim busy state').not.to.eq('true');
    }
  }).should('not.be.disabled');
  cy.location('pathname').should('eq', CLAIM_LIST_ROUTE);
  return cy.wrap(null, { log: false }).then(() => ({ observedLoadingDisabled }));
}

function assertScopedNewFormContext() {
  cy.location('pathname').should('eq', CLAIM_NEW_ROUTE);
  cy.get('#root').should('be.visible');
  fieldRoot(['المنشأة الصحية', 'Health Facility']).find('input').first()
    .should('be.visible').should('be.disabled').invoke('val').should('include', FACILITY);
  fieldRoot(['مسؤول المطالبات', 'Claim Administrator']).find('input').first()
    .should('be.visible').should('be.disabled').invoke('val').should('include', ACTOR);
}

function openClaimFormFromList(attempt) {
  cy.visit(CLAIM_LIST_ROUTE);
  cy.location('pathname').should('eq', CLAIM_LIST_ROUTE);
  waitForVisibleAddReadiness();
  visibleAddFab().should('be.enabled').click();
  assertScopedNewFormContext();
  assertScopedActorByReadQuery();
  cy.get('#root').then(($root) => {
    const controls = [];
    $root.find('label').each((_, label) => {
      const group = Cypress.$(label).closest('.MuiFormControl-root');
      controls.push({
        label: normalized(label.textContent),
        inputs: group.find('input,textarea').map((__, input) => ({
          tag: input.tagName,
          disabled: input.disabled,
          type: input.type,
        })).get(),
      });
    });
    cy.writeFile(`cypress/evidence/tfac-claim-control-metadata-${attempt || 'single'}.json`, { controls }, { log: false });
  });
}

function openFreshDeepNewForm() {
  // Direct navigation is the supported fresh route. The test does not inject
  // Redux/localStorage state or fabricate a response; the application must load
  // real user context before rendering the form.
  cy.visit(CLAIM_NEW_ROUTE);
  assertScopedNewFormContext();
  assertScopedActorByReadQuery();
}

function fillCoreClaimFields() {
  chooseToday(['تاريخ الزيارة من', 'Visit Date From', 'تاريخ بداية الزيارة']);
  chooseToday(['تاريخ المطالبة', 'Date Claimed', 'تاريخ تقديم المطالبة']);

  const insuree = enabledField(['الرقم القومي', 'Insuree No.']).clear().type(INSUREE_NID, { log: false });
  cy.wait('@tfacInsureePicker').then(({ response }) => {
    assertResponseOk(response, 'insuree picker');
    const edges = response.body?.data?.insurees?.edges || [];
    expect(edges.filter((edge) => edge.node?.chfId === INSUREE_NID), 'authorized insuree result').to.have.length(1);
  });
  insuree.should('have.value', INSUREE_NID);
  fieldRoot(['الاسم', 'Name']).find('input').first().should('not.have.value', '');

  const diagnosis = enabledField(['التشخيص الرئيسي', 'Main Diagnosis']).click().type(DIAGNOSIS_CODE, { delay: 0 });
  cy.wait('@tfacDiagnosisPicker').then(({ response }) => {
    assertResponseOk(response, 'diagnosis picker');
    const edges = response.body?.data?.diagnosesStr?.edges || [];
    expect(edges.some((edge) => edge.node?.code === DIAGNOSIS_CODE), 'authorized diagnosis result').to.eq(true);
  });
  cy.get('[role="option"]:visible').contains(DIAGNOSIS_CODE).click();
  enabledField(['توضيح', 'Explanation']).clear().type(EXPLANATION, { log: false });
}

function addSupportedService() {
  cy.get('input[placeholder*="خدمة طبية"]:not(:disabled)').filter(':visible').first().click().clear().type(SERVICE_CODE, { delay: 0 });
  cy.wait('@tfacServicePicker').then(({ response }) => {
    assertResponseOk(response, 'source-backed service picker');
    const edges = response.body?.data?.medicalServicesStr?.edges || [];
    expect(edges.some((edge) => edge.node?.code === SERVICE_CODE), 'facility price-list service result').to.eq(true);
    const node = edges.find((edge) => edge.node?.code === SERVICE_CODE)?.node;
    cy.writeFile('cypress/evidence/tfac-service-contract-metadata.json', {
      codeMatches: node?.code === SERVICE_CODE,
      packagetype: node?.packagetype ?? null,
      serviceSetArray: Array.isArray(node?.serviceSet),
      servicesLinkedArray: Array.isArray(node?.servicesLinked),
      returnedFields: Object.keys(node || {}),
    }, { log: false });
  });
  cy.get('[role="option"]:visible').contains(SERVICE_CODE).click();
  cy.document({ log: false }).then((document) => {
    const tables = Array.from(document.querySelectorAll('table')).filter((table) => table.querySelector('input[placeholder*="خدمة طبية"]'));
    const rows = tables.flatMap((table) => Array.from(table.querySelectorAll('tr'))).map((row) => ({
      cells: row.querySelectorAll('td').length,
      inputs: Array.from(row.querySelectorAll('input')).map((input) => ({
        type: input.type, disabled: input.disabled,
        containsServiceCode: String(input.value).includes(SERVICE_CODE),
        quantityOne: String(input.value) === '1', amountHundred: Number(input.value) === 100,
        empty: String(input.value) === '',
      })),
    }));
    cy.writeFile('cypress/evidence/tfac-actual-service-table-rows.json', { rows }, { log: false });
  });
  cy.get('.MuiAutocomplete-root input').filter((_, input) => input.value.includes(SERVICE_CODE)).first().closest('tr').within(() => {
    cy.get('input').eq(1).should('have.value', '1');
    cy.get('input').eq(2).clear().type('100.00', { delay: 0 }).should(($input) => expect(Number($input.val())).to.eq(100));
  });
}

function recordEntryEvidence(file, extra = {}) {
  cy.then(() => cy.writeFile(`cypress/evidence/${file}`, {
    actor: ACTOR,
    facility: FACILITY,
    claimAdmin: ACTOR,
    claimCode: CLAIM_CODE,
    claimMutationSubmitted: false,
    countBusinessForwarded: Cypress.env('countBusinessForwarded') || 0,
    ...extra,
    note: 'Metadata only; no response/request bodies, query text, variables, credentials, tokens, passwords, or raw user records are recorded.',
  }, { log: false }));
}

describe('HealthPay TFACCLM — scoped claim read-only acceptance', () => {
  beforeEach(() => {
    Cypress.env('qaRuntimeErrors', []);
    cy.on('uncaught:exception', (error) => {
      const errors = Cypress.env('qaRuntimeErrors') || [];
      errors.push({
        name: error.name,
        undefinedPropertyRead: /Cannot read properties of undefined/.test(String(error.message)),
        mapPropertyRead: /reading ['"]map['"]/.test(String(error.message)),
        claimChildPanelOwner: /ClaimChildPanel/.test(String(error.stack || '')),
      });
      Cypress.env('qaRuntimeErrors', errors);
      return false;
    });
  });
  afterEach(function () {
    cy.document({ log: false }).then((document) => {
      const $root = Cypress.$(document.getElementById('root'));
      const labels = $root.find('label').map((_, label) => ({
        text: normalized(label.textContent),
        visible: Cypress.$(label).is(':visible'),
      })).get();
      const inputs = $root.find('input:not([type="password"]):not([type="hidden"]),textarea').map((_, input) => ({
        name: input.name,
        placeholder: input.placeholder,
        disabled: input.disabled,
        visible: Cypress.$(input).is(':visible'),
      })).get();
      const file = this.currentTest.title.includes('fresh/deep') ? 'fresh' : this.currentTest.title.includes('transport') ? 'transport' : 'list';
      cy.writeFile(`cypress/evidence/tfac-context-dom-${file}.json`, {
        labels, inputs,
        pathname: document.defaultView.location.pathname,
        runtimeErrors: Cypress.env('qaRuntimeErrors') || [],
        rootPresent: $root.length > 0,
        status: $root.find('[role="alert"],[role="status"],[aria-busy]').map((_, element) => normalized(element.textContent)).get(),
      }, { log: false });
      cy.then(() => expect(Cypress.env('qaRuntimeErrors') || [], 'no uncaught application errors').to.have.length(0));
    });
  });
  it('reaches scoped editable entry readiness through three independent normal list-to-Add transitions', () => {
    cy.login();
    [1, 2, 3].forEach((attempt) => {
      openClaimFormFromList(attempt);
      enabledField(['رقم المطالبة', 'Claim Code']).should('be.enabled');
      enabledField(['توضيح', 'Explanation']).should('be.enabled');
      cy.then(() => expect(Cypress.env('countBusinessForwarded'), 'business mutations forwarded before save').to.eq(0));
    });
    recordEntryEvidence('tfac-repeated-entry-readiness.json', {
      independentTransitions: 3,
      entryFieldsEditable: true,
      reviewRightPresent: false,
      saveClicked: false,
      outcome: 'SCOPED_ENTRY_READY_WITHOUT_REVIEW',
    });
  });

  it('supports a fresh/deep new-entry route with loaded real user context and editable entry fields', () => {
    cy.login();
    openFreshDeepNewForm();
    enabledField(['رقم المطالبة', 'Claim Code']).should('be.enabled');
    enabledField(['توضيح', 'Explanation']).clear().type(EXPLANATION, { log: false }).should('be.enabled');
    cy.then(() => expect(Cypress.env('countBusinessForwarded'), 'business mutations forwarded on fresh route').to.eq(0));
    recordEntryEvidence('tfac-fresh-deep-entry-readiness.json', {
      freshDeepRoute: true,
      loadedUserContext: true,
      entryFieldsEditable: true,
      saveClicked: false,
      outcome: 'FRESH_DEEP_ENTRY_READY',
    });
  });

  it('locally fails exact TFACC001 create transport twice and proves form unlock/retry without backend persistence', () => {
    cy.login();
    openClaimFormFromList('save');
    fillCoreClaimFields();
    addSupportedService();

    const claimCode = enabledField(['رقم المطالبة', 'Claim Code']).clear().type(CLAIM_CODE, { delay: 0 });
    cy.wait('@tfacClaimCodeValidation').then(({ response }) => {
      assertResponseOk(response, 'claim-code validation');
      expect(response.body?.data?.isValid, 'synthetic claim-code validation').to.eq(true);
    });
    claimCode.should('have.value', CLAIM_CODE);

    const attemptCreateAndProveUnlock = () => {
      cy.get('button.MuiFab-root:visible').filter(':not(:disabled)').last().should('exist').click();
      cy.wait('@tfacCreateClaim', { timeout: 30000 }).then(({ request, response }) => {
        expect(request.method, 'simulated createClaim method').to.eq('POST');
        expect(response, 'backend response after local forceNetworkError').to.not.exist;
      });
      fieldRoot(['رقم المطالبة', 'Claim Code']).find('input').first().should('be.enabled');
      cy.get('button.MuiFab-root:visible').filter(':not(:disabled)').last().should('exist');
    };

    attemptCreateAndProveUnlock();
    attemptCreateAndProveUnlock();
    cy.then(() => expect(Cypress.env('countBusinessForwarded'), 'business mutations forwarded').to.eq(0));
    recordEntryEvidence('tfac-create-transport-simulation.json', {
      service: SERVICE_CODE,
      quantity: '1',
      requestedAmount: '100.00',
      attempted: true,
      attemptedTransportFailures: 2,
      simulatedNetworkError: true,
      formUnlockedAfterFailure: true,
      retryUnlockedAndReattempted: true,
      persistedBackendAcceptance: false,
      createClaimContinued: false,
      classification: 'NOT_PERSISTED_BACKEND_ACCEPTANCE',
      outcome: 'LOCAL_TRANSPORT_FAILURE_UNLOCK_RETRY_PROVEN',
    });
  });
});
