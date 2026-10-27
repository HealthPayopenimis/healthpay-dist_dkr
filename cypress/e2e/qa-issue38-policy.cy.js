/*
 * TFAC policy + contribution UI scenario.
 *
 * This spec intentionally uses only the real UI for writes.  The authenticated
 * GraphQL helper below is read-only and is used for the exact idempotence check
 * and post-save proof.  qa-issue38.js is auto-loaded by Cypress configuration;
 * do not import it here because it owns the strict mutation guard/intercept.
 */

const INSUREE_NID = '29001010190019';
const FACILITY_VILLAGE = 'EG010901';
const PRODUCT_CODE = 'TQAC001';
const OFFICER_CODE = 'TFACOFF';
const RECEIPT = 'TEST-TFAC-0001';
const AMOUNT = '1000.00';

function normalized(value) {
  return String(value || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}

function labelRoot(labels) {
  const wanted = (Array.isArray(labels) ? labels : [labels]).map(normalized);
  return cy.get('label').filter((_, element) => {
    return Cypress.$(element).is(':visible') && wanted.includes(normalized(element.textContent));
  }).should('have.length.at.least', 1).first().closest('.MuiFormControl-root');
}

function visibleInput(labels) {
  return labelRoot(labels).find('input:not(:disabled)').first().should('be.visible');
}

function typeField(labels, value) {
  visibleInput(labels).clear().type(value, { log: false, delay: 0 });
}

function chooseVisibleOption(optionLabels) {
  const wanted = (Array.isArray(optionLabels) ? optionLabels : [optionLabels]).map(normalized);
  cy.get('li').filter((_, element) => {
    return Cypress.$(element).is(':visible') && wanted.includes(normalized(element.textContent));
  }).should('have.length.at.least', 1).first().click();
}

function chooseAutocomplete(labels, search, optionPrefix) {
  labelRoot(labels).then(($root) => {
    const input = $root.find('input:not(:disabled)').first();
    if(input.attr('aria-hidden') === 'true') cy.wrap($root).find('[role="button"]').first().click();
    else cy.wrap(input).click().clear().type(search, { log: false, delay: 0 });
  });
  cy.get('li').filter((_, element) => {
    const text = normalized(element.textContent);
    return Cypress.$(element).is(':visible') && text.startsWith(optionPrefix);
  }).should('have.length.at.least', 1).first().click();
}

function chooseSelect(labels, optionLabels) {
  labelRoot(labels).find('[role="button"]').first().should('be.visible').click();
  chooseVisibleOption(optionLabels);
}

function readOnlyGraphql(query, variables = {}) {
  return cy.window({ log: false }).then((window) => cy.request({
    method: 'POST',
    url: '/api/graphql',
    headers: {
      'X-CSRFToken': window.localStorage.getItem('csrfToken'),
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: { query, variables },
    log: false,
  })).then((response) => {
    expect(response.status).to.eq(200);
    expect(response.body.errors, JSON.stringify(response.body.errors || [])).to.not.exist;
    return response.body.data;
  });
}

function exactFixtureId(records, name, alternate) {
  const value = records[name] ?? (alternate ? records[alternate] : undefined);
  expect(value, `tfac-records.${name}`).to.not.be.undefined;
  expect(value, `tfac-records.${name}`).to.not.be.null;
  return value;
}

function familyUuidFrom(records) {
  return records.familyUuid || records.family?.uuid || records.insuree?.familyUuid || records.insuree?.family?.uuid;
}

function setToday(labels) {
  const today = new Date();
  const day = String(today.getDate());
  visibleInput(labels).click();
  cy.get('[role="dialog"]').should('be.visible').find('button.MuiPickersDay-day').filter((_, element) => {
    return !element.className.includes('hidden') && normalized(element.textContent) === day;
  }).last().click();
  cy.get('[role="dialog"]').find('button').filter((_, element) => {
    return /^(OK|موافق)$/.test(normalized(element.textContent));
  }).should('have.length.at.least', 1).first().click();
}

function saveFab() {
  cy.get('button.MuiFab-root').filter((_, element) => {
    return Cypress.$(element).is(':visible') && !element.disabled && !!element.querySelector('svg');
  }).last().should('be.enabled').click();
}

function policyReadback() {
  return readOnlyGraphql(`
    query {
      policies(
        first: 20
        showHistory: true
        insureePolicies_Insuree_ChfId: "${INSUREE_NID}"
        product_Code: "${PRODUCT_CODE}"
        officer_Code: "${OFFICER_CODE}"
      ) {
        totalCount
        edges {
          node {
            id uuid stage status value enrollDate startDate expiryDate sumPremiums
            family {
              id uuid
              headInsuree { chfId }
              location { code type parent { code type } }
            }
            product { id uuid code name }
            officer { id uuid code lastName otherNames }
          }
        }
      }
    }
  `).then((data) => data.policies.edges.map((edge) => edge.node));
}

function contributionReadback(policyUuid) {
  return readOnlyGraphql(`
    query {
      premiums(
        first: 20
        showHistory: true
        policy_Uuid: "${policyUuid}"
        receipt: "${RECEIPT}"
      ) {
        totalCount
        edges {
          node {
            id uuid amount receipt payDate payType isPhotoFee
            policy { id uuid family { id uuid } product { code } officer { code } }
          }
        }
      }
    }
  `).then((data) => data.premiums.edges.map((edge) => edge.node));
}

function writeFixtureRecords(records) {
  Cypress.env('tfacRecords', records);
  return cy.writeFile('cypress/fixtures/tfac-records.json', records, { log: false });
}

describe('TFAC policy and contribution UI creation', () => {
  it('creates the policy and its cash contribution, or performs an exact existing-record skip', () => {
    cy.login();

    cy.fixture('tfac-records', { log: false }).then((fixtureRecords) => {
      const records = { ...fixtureRecords };
      const familyUuid = familyUuidFrom(records);
      expect(familyUuid, 'tfac-records.familyUuid').to.be.a('string').and.not.be.empty;

      // These IDs are the only catalog/relationship IDs permitted to reach
      // createPolicy.  The strict guard supplied by qa-issue38.js enforces them.
      exactFixtureId(records, 'familyId', 'family.id');
      exactFixtureId(records, 'productId', 'product.id');
      exactFixtureId(records, 'officerId', 'officer.id');

      policyReadback().then((existingPolicies) => {
        expect(existingPolicies.length, 'exact TFAC policy matches').to.be.at.most(1);
        let policy = existingPolicies[0] || null;
        let policyMutationResponse = null;

        const continueWithPolicy = () => {
          expect(policy, 'new or existing TFAC policy').to.exist;
          expect(policy.uuid, 'TFAC policy UUID').to.be.a('string').and.not.be.empty;

          records.policyUuid = policy.uuid;
          if (policy.id !== undefined && policy.id !== null) records.policyId = /^\d+$/.test(String(policy.id)) ? Number(policy.id) : Number(atob(policy.id).split(':').pop());
          Cypress.env('tfacRecords', records);

          contributionReadback(policy.uuid).then((existingContributions) => {
            expect(existingContributions.length, 'exact TFAC contribution matches').to.be.at.most(1);
            if (existingContributions.length === 1) {
              const contribution = existingContributions[0];
              expect(contribution.receipt).to.eq(RECEIPT);
              expect(String(contribution.amount)).to.eq(AMOUNT);
              expect(contribution.payType).to.eq('C');
              cy.writeFile('cypress/evidence/tfac-policy-contribution.json', {
                outcome: 'EXACT_EXISTING_SYNTHETIC_SKIP',
                actor: 'hpadmin',
                policy: {
                  id: policy.id,
                  uuid: policy.uuid,
                  status: policy.status,
                  productCode: policy.product.code,
                  officerCode: policy.officer.code,
                },
                contribution: {
                  id: contribution.id,
                  uuid: contribution.uuid,
                  receipt: contribution.receipt,
                  amount: contribution.amount,
                  payType: contribution.payType,
                },
              }, { log: false });
              return;
            }

            // If the policy was read back, use it; otherwise the UI-created
            // policy was already read back before this continuation ran.
            cy.intercept('POST', '**/graphql', (request) => {
              if (/validatePremiumCode/.test(String(request.body?.query || ''))) {
                request.alias = 'tfacReceiptValidation';
              }
            });
            cy.visit(`/front/contribution/new/${policy.uuid}`);
            labelRoot(['تاريخ السداد', 'Payment Date']).should('be.visible');
            setToday(['تاريخ السداد', 'Payment Date']);
            chooseSelect(['طريقة السداد', 'Payment Type'], ['نقدًا', 'Cash']);
            typeField(['رقم الإيصال', 'Receipt No.'], RECEIPT);
            labelRoot(['قيمة الاشتراك', 'المبلغ', 'Amount']).find('input').first().should('be.visible').then(($amount) => {
              if ($amount.is(':disabled')) {
                expect(String($amount.val()).replace(/,/g, ''), 'source-controlled one-installment amount').to.match(/^1000(?:\.00)?$/);
              } else {
                cy.wrap($amount).clear().type(AMOUNT, { log: false, delay: 0 });
              }
            });
            cy.wait('@tfacReceiptValidation', { timeout: 60000 }).then(({ response }) => {
              expect(response.statusCode).to.eq(200);
              expect(response.body.errors).not.to.exist;
              expect(response.body.data.isValid).to.eq(true);
            });
            saveFab();
            cy.get('[role="dialog"]', { timeout: 60000 }).should('be.visible').within(() => {
              cy.get('button').filter((_, element) => /^(OK|موافق)$/.test(normalized(element.textContent)))
                .should('have.length.at.least', 1).first().click();
            });
            cy.wait('@createPremium', { timeout: 60000 }).then(({ response }) => {
              expect(response.statusCode).to.eq(200);
              expect(response.body.errors).not.to.exist;
            });
            cy.location('pathname', { timeout: 120000 }).should('match', /\/front\/insuree\/families\/familyOverview\/[0-9a-f-]{36}$/i);

            contributionReadback(policy.uuid).then((createdContributions) => {
              expect(createdContributions.length, 'new TFAC contribution readback').to.eq(1);
              const contribution = createdContributions[0];
              expect(contribution.receipt).to.eq(RECEIPT);
              expect(String(contribution.amount)).to.eq(AMOUNT);
              expect(contribution.payType).to.eq('C');
              policyReadback().then((finalPolicies) => {
                expect(finalPolicies.length, 'final TFAC policy readback').to.eq(1);
                const finalPolicy = finalPolicies[0];
                expect(finalPolicy.family.headInsuree.chfId).to.eq(INSUREE_NID);
                expect(finalPolicy.family.location.code).to.eq(FACILITY_VILLAGE);
                expect(finalPolicy.family.location.type).to.eq('V');
                expect(finalPolicy.family.location.parent.type).to.eq('D');
                expect(finalPolicy.product.code).to.eq(PRODUCT_CODE);
                expect(finalPolicy.officer.code).to.eq(OFFICER_CODE);
                cy.writeFile('cypress/evidence/tfac-policy-contribution.json', {
                  outcome: 'UI_SAVE_AND_READBACK_PASS',
                  actor: 'hpadmin',
                  policy: {
                    id: finalPolicy.id,
                    uuid: finalPolicy.uuid,
                    status: finalPolicy.status,
                    value: finalPolicy.value,
                    productCode: finalPolicy.product.code,
                    officerCode: finalPolicy.officer.code,
                    familyId: finalPolicy.family.id,
                  },
                  contribution: {
                    id: contribution.id,
                    uuid: contribution.uuid,
                    receipt: contribution.receipt,
                    amount: contribution.amount,
                    payType: contribution.payType,
                  },
                  mutationResponse: policyMutationResponse,
                }, { log: false });
              });
            });
          });
        };

        if (policy) {
          continueWithPolicy();
          return;
        }

        cy.visit(`/front/insuree/families/familyOverview/${familyUuid}`);
        cy.contains('button', /^إضافة وثيقة$/).should('be.visible').click();
        cy.location('pathname').should('include', '/front/policy/policy/_NEW_/');
        setToday(['تاريخ الاشتراك','Enrollment Date']);
        labelRoot(['برنامج التغطية', 'Product']).should('be.visible');
        chooseAutocomplete(['برنامج التغطية', 'Product'], PRODUCT_CODE, PRODUCT_CODE);
        labelRoot(['مسؤول التسجيل', 'Officer']).should('be.visible');
        chooseAutocomplete(['مسؤول التسجيل', 'Officer'], OFFICER_CODE, OFFICER_CODE);
        labelRoot(['القيمة', 'Value']).find('input').should(($input) => {
          expect($input.val(), 'calculated policy value').to.not.equal('');
        });
        saveFab();
        cy.wait('@createPolicy', { timeout: 60000 }).then(({ response }) => {
          expect(response.statusCode).to.eq(200);
          expect(response.body.errors).not.to.exist;
          policyMutationResponse = response.body.data?.createPolicy || null;
        });
        cy.location('pathname', { timeout: 120000 }).should('match', /\/front\/insuree\/families\/familyOverview\/[0-9a-f-]{36}$/i);
        policyReadback().then((createdPolicies) => {
          expect(createdPolicies.length, 'new TFAC policy readback').to.eq(1);
          policy = createdPolicies[0];
          if (records.policyId === undefined || records.policyId === null) records.policyId = policy.id;
          writeFixtureRecords(records).then(() => continueWithPolicy());
        });
      });
    });
  });
});
