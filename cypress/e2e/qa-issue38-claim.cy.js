/*
 * HealthPay Issue38 — TFAC claim lifecycle (UI mutations only)
 *
 * Run with the guarded support file supplied by the parent. The support file's
 * POST /graphql interceptor is the mutation allowlist; this spec never sends a
 * business mutation through cy.request. cy.request is used only for exact
 * readbacks/pre-reads required to prevent duplicate creation and reconcile the
 * persisted lifecycle state.
 *
 * Primary actor: TFACCLM (claim administrator TFACCLM, scoped to TFAC001).
 * Optional reviewer stage: run this same stage with the approved hpadmin
 * fixture only; no user/role/configuration changes are made here.
 */

const CLAIM_LIST_ROUTE = '/front/claim/healthFacilities';
const CLAIM_NEW_ROUTE = '/front/claim/healthFacilities/claim';
const REVIEWS_ROUTE = '/front/claim/reviews';

const CLAIM_CODE = 'TFACC001';
const INSUREE_NID = '29001010190019';
const FACILITY_CODE = 'TFAC001';
const CLAIM_ADMIN_CODE = 'TFACCLM';
const SERVICE_CODE = 'TSVC01';
const DIAGNOSIS_CODE = 'TDX001';
const SYNTHETIC_EXPLANATION = 'TEST-TFAC — مطالبة اختبارية — ليست مطالبة طبية حقيقية';

const EXPECTED_IDS = {
  claimAdminId: 2,
  diagnosisId: 1,
  facilityId: 1,
  insureeId: 33,
  serviceId: 2,
};

const evidence = {
  sourceContract: '/home/ubuntu/healthpay-issue38-oct27/contracts-claim-cycle.md',
  sourceModules: [
    '/home/ubuntu/healthpay-dev-fixes/coverage-modules/fe-claim',
    '/home/ubuntu/healthpay-dev-fixes/coverage-modules/fe-medical',
    '/home/ubuntu/healthpay-dev-fixes/healthpay-fe-core_js',
  ],
  syntheticOnly: true,
  actor: null,
  target: {
    code: CLAIM_CODE,
    insureeNationalId: INSUREE_NID,
    facilityCode: FACILITY_CODE,
    claimAdminCode: CLAIM_ADMIN_CODE,
    diagnosisCode: DIAGNOSIS_CODE,
    serviceCode: SERVICE_CODE,
    quantity: '1',
    requestedAmount: '100.00',
    explanation: SYNTHETIC_EXPLANATION,
  },
  operations: [],
  stages: [],
};

function normalized(text) {
  return String(text || '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldRoot(label) {
  return cy
    .get('label')
    .filter((_, element) => {
      const actual = normalized(element.textContent);
      const expected = Array.isArray(label) ? label.map(normalized) : [normalized(label)];
      return expected.some((candidate) => actual === candidate || actual.startsWith(`${candidate} `));
    })
    .filter(':visible')
    .first()
    .closest('.MuiFormControl-root');
}

function visibleButtonMatching(pattern) {
  return cy.get('button').filter((_, element) => {
    const $element = Cypress.$(element);
    return $element.is(':visible') && pattern.test(normalized($element.text()));
  });
}

function writeEvidence() {
  cy.writeFile('cypress/evidence/issue38-claim-ready.json', evidence, { log: false });
}

function screenshot(stage) {
  cy.screenshot(`issue38-claim-${stage}`, { capture: 'viewport' });
}

function graphqlRead(query, label) {
  return cy.window({ log: false }).then((windowObject) =>
    cy.request({
      method: 'POST',
      url: '/api/graphql',
      headers: {
        'X-CSRFToken': windowObject.localStorage.getItem('csrfToken') || '',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: { query },
      failOnStatusCode: false,
      log: false,
    }),
  ).then((response) => {
    expect(response.status, `${label} HTTP status`).to.eq(200);
    expect(response.body && response.body.errors, `${label} GraphQL errors`).to.not.exist;
    return response.body;
  });
}

const CLAIM_SUMMARY_PROJECTION = `
  uuid code status dateClaimed dateFrom claimed approved feedbackStatus reviewStatus
  healthFacility { id uuid code }
  insuree { id uuid chfId }
`;

function readClaimsByCode() {
  return graphqlRead(
    `query Issue38ClaimCodeRead {
      claims(code_Icontains: "${CLAIM_CODE}", first: 20) {
        totalCount
        edges { node { ${CLAIM_SUMMARY_PROJECTION} } }
      }
    }`,
    'claim code pre-read',
  ).then((body) => body?.data?.claims?.edges?.map((edge) => edge.node) || []);
}

function readClaim(uuid) {
  return graphqlRead(
    `query Issue38ClaimRead {
      claim(uuid: "${uuid}") {
        uuid code status dateFrom dateClaimed claimed approved valuated dateProcessed
        feedbackStatus reviewStatus
        healthFacility { id uuid code name }
        admin { id uuid code lastName otherNames }
        insuree { id uuid chfId lastName otherNames }
        icd { id code name }
        services {
          id product { id uuid }
          service { id code name packagetype }
          qtyProvided priceAsked qtyApproved priceApproved priceValuated status
        }
        items { id item { id code } qtyProvided priceAsked status }
      }
    }`,
    `claim readback ${uuid}`,
  ).then((body) => body?.data?.claim || null);
}

function setGuardTarget(claimUuid) {
  const current = Cypress.env('tfacRecords') || {};
  Cypress.env('tfacRecords', { ...current, claimUuid });
  Cypress.env('claimUuid', claimUuid);
}

function recordOperation(operation, request, response) {
  evidence.operations.push({
    operation,
    actor: Cypress.env('qaActor') || null,
    requestedAt: new Date().toISOString(),
    request: {
      operationPresent: String(request?.body?.query || '').includes(operation),
      variables: request?.body?.variables || null,
    },
    response: {
      httpStatus: response?.statusCode,
      errors: response?.body?.errors || null,
      data: response?.body?.data || null,
    },
  });
}

function chooseToday(label) {
 fieldRoot(label).find('input').first().should('be.visible').click();
 cy.get('[role="dialog"] button.MuiPickersDay-day').filter((_,e)=>!e.className.includes('hidden')&&e.textContent.trim()===String(new Date().getDate())).last().click();
 cy.contains('[role="dialog"] button',/^موافق$/).click();
}
function pk(id){if(typeof id==='number'||/^\d+$/.test(String(id)))return Number(id);return Number(atob(id).split(':').pop());}

function assertReadonlyContext() {
  fieldRoot('المنشأة الصحية').find('input').first().should('be.disabled').invoke('val').should('include','TFAC001');
  fieldRoot('مسؤول المطالبات').find('input').first().should('be.disabled').invoke('val').should('include','TFACCLM');
}

function captureMutation(alias, operation) {
  return cy.wait(alias, { timeout: 120000 }).then(({ request, response }) => {
    expect(request.body?.query, `${operation} operation`).to.include(operation);
    expect(response?.statusCode, `${operation} HTTP status`).to.eq(200);
    expect(response?.body?.errors, `${operation} GraphQL errors`).to.not.exist;
    recordOperation(operation, request, response);
    writeEvidence();
    return { request, response };
  });
}

function exactExistingClaimStop(stage, claims) {
  const exact = claims.filter((claim) => claim.code === CLAIM_CODE);
  evidence.stages.push({
    stage,
    result: exact.length ? 'STOP_EXISTING_CONFLICT' : 'CLEAR_TO_CREATE',
    existing: exact.map((claim) => ({ uuid: claim.uuid, code: claim.code, status: claim.status })),
  });
  writeEvidence();
  expect(
    exact,
    `No existing ${CLAIM_CODE} claim may be reused or duplicated; terminal/entered statuses must be reconciled separately`,
  ).to.have.length(0);
}

function loadUniqueTargetForLifecycle(stage, expectedStatus) {
  return readClaimsByCode().then((claims) => {
    const exact = claims.filter((claim) => claim.code === CLAIM_CODE);
    expect(exact, `${stage}: exactly one persisted ${CLAIM_CODE} target`).to.have.length(1);
    const target = exact[0];
    expect(target.uuid, `${stage}: persisted claim UUID`).to.be.a('string').and.not.empty;
    if (expectedStatus !== undefined) {
      expect(target.status, `${stage}: expected pre-mutation main status`).to.eq(expectedStatus);
    }
    setGuardTarget(target.uuid);
    return readClaim(target.uuid).then((detail) => {
      expect(detail, `${stage}: detail readback`).to.exist;
      evidence.stages.push({
        stage,
        result: 'READBACK',
        claim: detail,
      });
      writeEvidence();
      return detail;
    });
  });
}

function findAndSelectClaim(code) {
  const claimRow = cy.contains('tr', code, { timeout: 60000 }).filter(':visible').first();
  claimRow.should('exist');
  claimRow.find('input[type="checkbox"]').first().should('be.visible').click();
  return claimRow;
}

function applyClaimCodeFilter(code) {
  fieldRoot('رقم المطالبة').find('input').first().should('be.visible').clear().type(code, { delay: 0 });
  cy.wait(800);
  cy.get('button')
    .filter((_, element) => {
      const $element = Cypress.$(element);
      return $element.is(':visible') && $element.find('svg[data-testid="SearchIcon"]').length > 0;
    })
    .first()
    .should('exist')
    .click();
}

function assertTargetFields(detail, expectedStatus) {
  expect(detail.code).to.eq(CLAIM_CODE);
  expect(Number(detail.status)).to.eq(expectedStatus);
  expect(Number(detail.claimed)).to.eq(100);
  expect(detail.dateClaimed).to.be.a('string').and.not.empty;
  expect(detail.dateFrom).to.be.a('string').and.not.empty;
  expect(pk(detail.healthFacility?.id)).to.eq(EXPECTED_IDS.facilityId);
  expect(detail.healthFacility?.code).to.eq(FACILITY_CODE);
  expect(pk(detail.admin?.id)).to.eq(EXPECTED_IDS.claimAdminId);
  expect(detail.admin?.code).to.eq(CLAIM_ADMIN_CODE);
  expect(pk(detail.insuree?.id)).to.eq(EXPECTED_IDS.insureeId);
  expect(detail.insuree?.chfId).to.eq(INSUREE_NID);
  expect(pk(detail.icd?.id)).to.eq(EXPECTED_IDS.diagnosisId);
  expect(detail.icd?.code).to.eq(DIAGNOSIS_CODE);
  expect(detail.services).to.have.length(1);
  expect(detail.services[0].service.code).to.eq(SERVICE_CODE);
  expect(Number(detail.services[0].qtyProvided)).to.eq(1);
  expect(Number(detail.services[0].priceAsked)).to.eq(100);
  expect(detail.items || []).to.have.length(0);
}

describe('HealthPay Issue38 — TFAC claim create and submit', () => {
  beforeEach(() => {
    cy.fixture('cred', { log: false }).then((credential) => {
      evidence.actor = credential.username;
      Cypress.env('qaActor', credential.username);
    });
  });

  it('creates exactly one service-only TFAC claim through the visible form', () => {
    cy.intercept('POST','**/graphql',req=>{const q=String(req.body?.query||'');if(q.includes('healthFacilities')&&/\bid\s*:/.test(q))req.alias='tfacFacilityBootstrap';if(q.includes('query ClaimAdminPicker'))req.alias='tfacAdminBootstrap';});
    cy.login();
    cy.fixture('tfac-records', { log: false }).then((records) => {
      expect(records.familyId, 'TFAC family fixture').to.eq(9);
      expect(records.insureeId, 'TFAC insuree fixture').to.eq(EXPECTED_IDS.insureeId);
      expect(records.productId, 'TFAC product fixture').to.eq(4);
      expect(records.policyId, 'TFAC active policy fixture').to.eq(5);
      expect(records.claimAdminId, 'TFAC claim-admin fixture').to.eq(EXPECTED_IDS.claimAdminId);
    });

    // Exact query-only duplicate pre-read. Any existing exact code is a hard stop,
    // including an already-terminal record; this spec never creates a second row.
    readClaimsByCode().then((claims) => exactExistingClaimStop('pre-create duplicate reconciliation', claims));

    cy.visit(CLAIM_LIST_ROUTE);
    cy.location('pathname').should('eq', CLAIM_LIST_ROUTE);
    cy.wait('@tfacFacilityBootstrap').then(({response})=>{expect(response.statusCode).eq(200);expect(response.body.errors).not.exist;expect(response.body.data.healthFacilities.edges[0].node.code).eq('TFAC001');});
    cy.wait('@tfacAdminBootstrap').then(({response})=>{expect(response.statusCode).eq(200);expect(response.body.errors).not.exist;expect(response.body.data.claimAdmins.edges.some(e=>e.node.code==='TFACCLM')).eq(true);});
    cy.contains('button', /Create new claim|إنشاء مطالبة جديدة/).should('not.exist');
    cy.get('button.MuiFab-root:visible').filter(':not(:disabled)').last().should('exist').click();
    cy.location('pathname').should('eq', CLAIM_NEW_ROUTE);
    cy.get('#root').should('be.visible');
    screenshot('new-form-context');

    assertReadonlyContext();

    const codeInput = fieldRoot('رقم المطالبة').find('input').first();
    codeInput.should('be.visible').invoke('attr', 'maxlength').then((maxLength) => {
      evidence.codeMaxLength = Number(maxLength);
      expect(Number(maxLength), 'deployed claim-code maxlength').to.be.at.least(CLAIM_CODE.length);
    });

    // Use only visible calendar controls; do not type dates or bypass date widgets.
    chooseToday(['تاريخ الزيارة من', 'تاريخ بداية الزيارة']);
    chooseToday(['تاريخ المطالبة', 'تاريخ تقديم المطالبة']);

    // The source default is O; record the visible value without forcing a hidden value.
    fieldRoot('نوع الزيارة').should('contain.text', 'أخرى');

    cy.intercept('POST', '**/graphql', (request) => {
      const query = String(request.body?.query || '');
      if (/query DiagnosisPicker/.test(query)) request.alias = 'issue38DiagnosisPicker';
      if (/query \(\$searchString: String/.test(query) && query.includes('medicalServicesStr')) {
        request.alias = 'issue38ServicePicker';
      }
      if (/validateClaimCode/.test(query)) request.alias = 'issue38ClaimCodeValidation';
      if (/insurees\(chfId:/.test(query)) request.alias = 'issue38InsureePicker';
    });

    const insureeRoot = fieldRoot('الرقم القومي');
    insureeRoot.find('input:not(:disabled)').first().clear().type(INSUREE_NID, { delay: 0 });
    cy.wait('@issue38InsureePicker', { timeout: 60000 }).then(({ response }) => {
      expect(response?.statusCode).to.eq(200);
      expect(response?.body?.errors).to.not.exist;
      const edges = response?.body?.data?.insurees?.edges || [];
      expect(edges.filter((edge) => edge.node?.chfId === INSUREE_NID), 'real insuree picker result').to.have.length(1);
    });
    insureeRoot.find('input').first().should('have.value', INSUREE_NID);
    fieldRoot('الاسم').find('input').first().should('not.have.value', '');

    const diagnosisRoot = fieldRoot(['التشخيص الرئيسي', 'التشخيص الرئيسي (ICD)']);
    diagnosisRoot.find('input:not(:disabled)').first().click().clear().type(DIAGNOSIS_CODE, { delay: 0 });
    cy.wait('@issue38DiagnosisPicker', { timeout: 60000 }).then(({ response }) => {
      expect(response?.statusCode).to.eq(200);
      expect(response?.body?.errors).to.not.exist;
      const edges = response?.body?.data?.diagnosesStr?.edges || [];
      expect(edges.some((edge) => edge.node?.code === DIAGNOSIS_CODE), 'authorized synthetic diagnosis picker result').to.eq(true);
    });
    cy.get('[role="option"]', { timeout: 60000 }).filter(':visible').contains(DIAGNOSIS_CODE).click();

    // This is the explicit synthetic explanation from the reviewed fixture.
    fieldRoot(['توضيح', 'الشرح / المبررات']).find('input:not(:disabled)').first().clear().type(SYNTHETIC_EXPLANATION, { delay: 0 });

    // The source-backed service picker is the only child row; no item is invented.
    cy.contains(/Services|الخدمات/).should('be.visible');
    cy.get('.MuiAutocomplete-root input:not(:disabled)')
      .filter(':visible')
      .last()
      .click()
      .clear()
      .type(SERVICE_CODE, { delay: 0 });
    cy.wait('@issue38ServicePicker', { timeout: 60000 }).then(({ response }) => {
      expect(response?.statusCode).to.eq(200);
      expect(response?.body?.errors).to.not.exist;
      const edges = response?.body?.data?.medicalServicesStr?.edges || [];
      expect(edges.some((edge) => edge.node?.code === SERVICE_CODE), 'facility price-list service picker result').to.eq(true);
    });
    cy.get('[role="option"]', { timeout: 60000 }).filter(':visible').contains(SERVICE_CODE).click();

    const serviceRow = cy.contains('tr', SERVICE_CODE, { timeout: 60000 }).filter(':visible').first();
    serviceRow.should('exist');
    serviceRow.find('input').eq(1).should('be.visible').invoke('val').then((value) => expect(Number(value)).to.eq(1));
    serviceRow.find('input').eq(2).should('be.visible').clear().type('100.00', { delay: 0 });
    serviceRow.find('input').eq(2).invoke('val').then((value) => expect(Number(value)).to.eq(100));

    codeInput.clear().type(CLAIM_CODE, { delay: 0 });
    cy.wait('@issue38ClaimCodeValidation', { timeout: 60000 }).then(({ response }) => {
      expect(response?.statusCode).to.eq(200);
      expect(response?.body?.errors).to.not.exist;
      expect(response?.body?.data?.isValid, 'claim code validation').to.eq(true);
    });
    codeInput.should('have.value', CLAIM_CODE);
    screenshot('filled-before-create');

    const saveButton = cy.get('button.MuiFab-root:visible').filter(':not(:disabled)').last();
    saveButton.should('exist').click();
    captureMutation('@createClaim', 'createClaim');

    cy.wait(1000);
    fieldRoot('رقم المطالبة').find('input').first().should('have.value', CLAIM_CODE);
    readClaimsByCode().then((claims) => {
      const exact = claims.filter((claim) => claim.code === CLAIM_CODE);
      expect(exact, 'post-create exact claim readback').to.have.length(1);
      expect(exact[0].status, 'post-create main status').to.eq(2);
      setGuardTarget(exact[0].uuid);
      return readClaim(exact[0].uuid).then((detail) => {
        assertTargetFields(detail, 2);
        evidence.claimUuid = detail.uuid;
        evidence.stages.push({ stage: 'create', result: 'PASS', claim: detail });
        writeEvidence();
        screenshot('created-claim-readback');
      });
    });
  });

  it('submits the created claim through the visible Submit Selected action', () => {
    cy.login();
    loadUniqueTargetForLifecycle('pre-submit reconciliation', 2).then((detail) => {
      assertTargetFields(detail, 2);
      screenshot('pre-submit-readback');
    });

    cy.visit(CLAIM_LIST_ROUTE);
    cy.location('pathname').should('eq', CLAIM_LIST_ROUTE);
    applyClaimCodeFilter(CLAIM_CODE);
    findAndSelectClaim(CLAIM_CODE);

    visibleButtonMatching(/Submit Selected|إرسال المحدد/)
      .filter(':visible')
      .first()
      .should('not.be.disabled')
      .click();
    captureMutation('@submitClaims', 'submitClaims');
    screenshot('submitted-list');

    cy.wait(1000);
    readClaimsByCode().then((claims) => {
      const exact = claims.filter((claim) => claim.code === CLAIM_CODE);
      expect(exact, 'post-submit exact claim readback').to.have.length(1);
      const submitted = exact[0];
      setGuardTarget(submitted.uuid);
      return readClaim(submitted.uuid).then((detail) => {
        expect(Number(detail.status), 'post-submit main status must change from Entered').to.be.oneOf([4, 8, 16]);
        expect(Number(detail.claimed)).to.eq(100);
        expect(detail.dateClaimed).to.be.a('string').and.not.empty;
        evidence.claimUuid = detail.uuid;
        evidence.stages.push({
          stage: 'submit',
          result: 'PASS',
          mainStatus: detail.status,
          claim: detail,
        });
        writeEvidence();
      });
    });
  });
});

