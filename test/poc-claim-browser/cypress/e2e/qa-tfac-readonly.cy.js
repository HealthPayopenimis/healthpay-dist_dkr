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
  // The deployed user document is the source of truth. Some deployments omit
  // healthFacility.code from the projection, so facility scope is checked via
  // the dedicated facility/admin bootstrap responses below instead.
  if (user.healthFacility?.id !== undefined) expect(normalizeRelayId(user.healthFacility.id)).to.eq(1);
}

function assertFacilityBootstrap(response) {
  assertResponseOk(response, 'facility bootstrap');
  const node = response.body?.data?.healthFacilities?.edges?.[0]?.node;
  expect(node, 'facility bootstrap node').to.be.an('object');
  expect(node.code, 'facility code').to.eq(FACILITY);
  expect(normalizeRelayId(node.id), 'facility id').to.eq(1);
  expect(node.location, 'facility location').to.be.an('object');
  expect(node.location.parent, 'facility full path parent').to.be.an('object');
}

function assertAdminBootstrap(response) {
  assertResponseOk(response, 'claim-admin bootstrap');
  const nodes = response.body?.data?.claimAdmins?.edges?.map((edge) => edge.node) || [];
  const admin = nodes.find((node) => node.code === ACTOR);
  expect(admin, 'scoped claim-admin bootstrap result').to.be.an('object');
  expect(normalizeRelayId(admin.id), 'claim-admin id').to.eq(2);
  if (admin.healthFacility?.id !== undefined) expect(normalizeRelayId(admin.healthFacility.id)).to.eq(1);
  if (admin.healthFacility?.code !== undefined) expect(admin.healthFacility.code).to.eq(FACILITY);
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

function waitForListBootstrap() {
  cy.wait('@tfacFacilityBootstrap').then(({ response }) => assertFacilityBootstrap(response));
  cy.wait('@tfacAdminBootstrap').then(({ response }) => assertAdminBootstrap(response));
}

function openClaimFormFromList() {
  cy.visit(CLAIM_LIST_ROUTE);
  cy.location('pathname').should('eq', CLAIM_LIST_ROUTE);
  waitForListBootstrap();
  cy.get('button.MuiFab-root:visible').filter(':not(:disabled)').last().should('exist').click();
  cy.location('pathname').should('eq', CLAIM_NEW_ROUTE);
  cy.get('#root').should('be.visible');
  // React Query may reuse/cancel its hook request across route transitions.
  // Prove the live actor/rights through a fixed query in this browser session,
  // and prove actual application readiness through visible enabled controls.
  cy.window({ log: false }).then((windowObject) => cy.request({
    method: 'POST', url: '/api/graphql', log: false,
    headers: {
      'X-CSRFToken': windowObject.localStorage.getItem('csrfToken') || '',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: { query: 'query ScopedClaimActorRead { user { username rights claimAdmin { id code } healthFacility { id } } }' },
  })).then((response) => assertRightsAndActor({ statusCode: response.status, body: response.body }));
  cy.get('#root').then(($root) => {
    const controls = [];
    $root.find('label').each((_, label) => {
      const group = Cypress.$(label).closest('.MuiFormControl-root');
      controls.push({ label: normalized(label.textContent), inputs: group.find('input,textarea').map((__, input) => ({ tag: input.tagName, disabled: input.disabled, type: input.type })).get() });
    });
    cy.writeFile('cypress/evidence/tfac-claim-control-metadata.json', { controls }, { log: false });
  });
  fieldRoot(['المنشأة الصحية', 'Health Facility']).find('input').first().should('be.disabled').invoke('val').should('include', FACILITY);
  fieldRoot(['مسؤول المطالبات', 'Claim Administrator']).find('input').first().should('be.disabled').invoke('val').should('include', ACTOR);
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
  });
  cy.get('[role="option"]:visible').contains(SERVICE_CODE).click();
  cy.get('.MuiAutocomplete-root input').filter((_, input) => input.value.includes(SERVICE_CODE)).first().closest('tr').within(() => {
    cy.get('input').eq(1).should('have.value', '1');
    cy.get('input').eq(2).clear().type('100.00', { delay: 0 }).should(($input) => expect(Number($input.val())).to.eq(100));
  });
}

function recordEntryEvidence(file, extra = {}) {
  cy.writeFile(`cypress/evidence/${file}`, {
    actor: ACTOR,
    facility: FACILITY,
    claimAdmin: ACTOR,
    claimCode: CLAIM_CODE,
    claimMutationSubmitted: false,
    countBusinessForwarded: Cypress.env('countBusinessForwarded') || 0,
    ...extra,
    note: 'Metadata only; no response/request bodies, query text, variables, credentials, tokens, or passwords are recorded.',
  }, { log: false });
}

describe('HealthPay TFACCLM — scoped claim read-only acceptance', () => {
  it('opens the real claim form from the list and reaches editable entry readiness without saving', () => {
    cy.login();
    openClaimFormFromList();
    fillCoreClaimFields();
    expect(Cypress.env('countBusinessForwarded'), 'business mutations forwarded before save').to.eq(0);
    cy.get('button.MuiFab-root:visible').filter(':not(:disabled)').last().should('exist');
    recordEntryEvidence('tfac-entry-form-ready.json', {
      insureeNationalId: INSUREE_NID,
      diagnosis: DIAGNOSIS_CODE,
      explanationFilled: true,
      saveClicked: false,
    });
  });

  it('uses normal list-to-Add Claim readiness, selects a real service/date, then locally fails exact createClaim and unlocks the form', () => {
    cy.login();
    openClaimFormFromList();
    fillCoreClaimFields();
    addSupportedService();

    const claimCode = enabledField(['رقم المطالبة', 'Claim Code']).clear().type(CLAIM_CODE, { delay: 0 });
    cy.wait('@tfacClaimCodeValidation').then(({ response }) => {
      assertResponseOk(response, 'claim-code validation');
      expect(response.body?.data?.isValid, 'synthetic claim-code validation').to.eq(true);
    });
    claimCode.should('have.value', CLAIM_CODE);

    cy.get('button.MuiFab-root:visible').filter(':not(:disabled)').last().should('exist').click();
    cy.wait('@tfacCreateClaim', { timeout: 30000 }).then(({ request, response }) => {
      expect(request.method, 'simulated createClaim method').to.eq('POST');
      expect(response, 'backend response after local forceNetworkError').to.not.exist;
    });

    // saveClaimWithRecovery should clear lockNew/isSaved after the local transport rejection.
    fieldRoot(['رقم المطالبة', 'Claim Code']).find('input').first().should('be.enabled');
    cy.get('button.MuiFab-root:visible').filter(':not(:disabled)').last().should('exist');
    expect(Cypress.env('countBusinessForwarded'), 'business mutations forwarded').to.eq(0);
    recordEntryEvidence('tfac-create-transport-simulation.json', {
      service: SERVICE_CODE,
      quantity: '1',
      requestedAmount: '100.00',
      attempted: true,
      simulatedNetworkError: true,
      persistedBackendAcceptance: false,
      createClaimContinued: false,
      classification: 'NOT_PERSISTED_BACKEND_ACCEPTANCE',
    });
  });
});
