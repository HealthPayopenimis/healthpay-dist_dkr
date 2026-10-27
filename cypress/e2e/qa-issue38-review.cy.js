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

/*
 * Optional reviewer stage. It deliberately performs no action for TFACCLM and
 * records the rights/actor blocker. Run the same spec with the approved hpadmin
 * fixture after creation/submission when the live claim reaches status 4.
 */
describe('HealthPay Issue38 — optional hpadmin review and processing', () => {
  it('reviews/delivers and processes only when hpadmin rights visibly support each stage', () => {
    cy.fixture('cred', { log: false }).then((credential) => {
      evidence.actor = credential.username;
      if (credential.username !== 'hpadmin') {
        evidence.stages.push({
          stage: 'review-processing',
          result: 'NOT_RUN',
          blocker: 'Provider actor TFACCLM is not a reviewer; rerun this stage with approved hpadmin credentials.',
        });
        writeEvidence();
        cy.log('Review/processing stage intentionally not run: requires approved hpadmin actor.');
        return;
      }

      cy.login();
      loadUniqueTargetForLifecycle('pre-review reconciliation').then((detail) => {
        if (Number(detail.status) !== 4) {
          evidence.stages.push({
            stage: 'review-processing',
            result: 'STOP_UNSUPPORTED_STATUS',
            blocker: `Review UI requires main status 4; live status is ${detail.status}.`,
            claim: detail,
          });
          writeEvidence();
          return;
        }

        cy.visit(REVIEWS_ROUTE);
        cy.location('pathname').should('eq', REVIEWS_ROUTE);
        applyClaimCodeFilter(CLAIM_CODE);
        findAndSelectClaim(CLAIM_CODE);
        visibleButtonMatching(/Select For Review|اختيار للمراجعة/)
          .filter(':visible')
          .first()
          .should('not.be.disabled')
          .click();
        captureMutation('@selectClaimsForReview', 'selectClaimsForReview');

        cy.wait(1000);
        readClaim(detail.uuid).then((selected) => {
          expect(Number(selected.status)).to.eq(4);
          expect(Number(selected.reviewStatus)).to.be.oneOf([4, 8]);
          if (Number(selected.reviewStatus) !== 4) {
            evidence.stages.push({
              stage: 'review-selection',
              result: 'STOP_UNSUPPORTED_REVIEW_STATUS',
              claim: selected,
            });
            writeEvidence();
            return;
          }

          cy.visit(`${REVIEWS_ROUTE}/review/${detail.uuid}`);
          cy.location('pathname').should('include', `${REVIEWS_ROUTE}/review/${detail.uuid}`);
          screenshot('review-detail-before-approval');

          cy.get('button')
            .filter((_, element) => Cypress.$(element).is(':visible') && Cypress.$(element).find('svg[data-testid="ThumbUpIcon"]').length > 0)
            .first()
            .should('exist')
            .click();
          screenshot('review-detail-approved');

          cy.get('button.MuiFab-root:visible').filter(':not(:disabled)').last().click();
          captureMutation('@saveClaimReview', 'saveClaimReview');
          cy.wait(500);

          cy.get('button')
            .filter((_, element) => Cypress.$(element).is(':visible') && Cypress.$(element).find('svg[data-testid="CheckIcon"]').length > 0)
            .first()
            .should('exist')
            .click();
          captureMutation('@deliverClaimsReview', 'deliverClaimsReview');
          screenshot('review-delivered');

          cy.wait(1000);
          readClaim(detail.uuid).then((delivered) => {
            expect(Number(delivered.status)).to.eq(4);
            expect(Number(delivered.reviewStatus)).to.eq(8);
            evidence.stages.push({
              stage: 'review-delivery',
              result: 'PASS',
              mainStatus: delivered.status,
              reviewStatus: delivered.reviewStatus,
              claim: delivered,
            });
            writeEvidence();

            cy.visit(REVIEWS_ROUTE);
            applyClaimCodeFilter(CLAIM_CODE);
            findAndSelectClaim(CLAIM_CODE);
            const processButton = visibleButtonMatching(/Process Selected|معالجة المحدد|معالجة/).filter(':visible').first();
            processButton.should('exist').and('not.be.disabled').click();
            captureMutation('@processClaims', 'processClaims');
            screenshot('processed-list');

            cy.wait(1000);
            readClaim(detail.uuid).then((processed) => {
              expect(Number(processed.status), 'actual process result').to.be.oneOf([8, 16]);
              evidence.stages.push({
                stage: 'processing',
                result: 'PASS',
                mainStatus: processed.status,
                dateProcessed: processed.dateProcessed,
                approved: processed.approved,
                valuated: processed.valuated,
                claim: processed,
              });
              writeEvidence();
            });
          });
        });
      });
    });
  });
});
