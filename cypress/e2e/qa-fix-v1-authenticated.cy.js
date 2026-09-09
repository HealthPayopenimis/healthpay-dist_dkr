const QA_ROUTES = [
  { id: 'users', path: '/front/admin/users', expectAdd: true },
  { id: 'locations', path: '/front/location/locations', expectAdd: false },
  { id: 'health-facilities', path: '/front/location/healthFacilities', expectAdd: true },
  { id: 'products', path: '/front/admin/products', expectAdd: true },
  { id: 'medical-services', path: '/front/medical/medicalServices', expectAdd: true },
  { id: 'medical-items', path: '/front/medical/medicalItems', expectAdd: true },
  { id: 'service-pricelists', path: '/front/medical/pricelists/services', expectAdd: true },
  { id: 'item-pricelists', path: '/front/medical/pricelists/items', expectAdd: true },
  { id: 'policy-holders', path: '/front/policyHolders', expectAdd: true },
  { id: 'policy-holder-users', path: '/front/policyHolderUsers', expectAdd: true },
  { id: 'contribution-plans', path: '/front/contributionPlans', expectAdd: true },
  { id: 'contribution-plan-bundles', path: '/front/contributionPlanBundles', expectAdd: true },
  { id: 'payment-plans', path: '/front/paymentPlans', expectAdd: true },
  { id: 'contracts', path: '/front/contracts', expectAdd: true },
  { id: 'payment-cycles', path: '/front/paymentCycles', expectAdd: false },
  { id: 'tasks', path: '/front/tasks', expectAdd: false },
  { id: 'all-tasks', path: '/front/AllTasks', expectAdd: false },
  { id: 'invoices', path: '/front/invoices', expectAdd: false },
  { id: 'bills', path: '/front/bills', expectAdd: false },
  { id: 'reports', path: '/front/tools/reports', expectAdd: false },
]

const RAW_KEY_PATTERN = /\b(?:policyHolder|claim|claim_batch|medical_pricelist|medical|admin|contributionPlan|tasksManagement|tools|paymentCycle|invoice|invoices|bill|paymentPlan|contract)\.[A-Za-z][A-Za-z0-9_.-]+\b/g
const APP_ERROR_PATTERN = /Internal Server Error|Something went wrong|حدث خطأ غير متوقع|انتهت صلاحية الجلسة/i

function visibleActionMetadata(win) {
  const nodes = Array.from(win.document.querySelectorAll('.MuiFab-root, button[aria-label], [title] button, a[href$="/new"]'))
  return nodes
    .filter((node) => {
      const style = win.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })
    .slice(0, 30)
    .map((node) => ({
      tag: node.tagName,
      title: node.getAttribute('title') || node.closest('[title]')?.getAttribute('title') || null,
      ariaLabel: node.getAttribute('aria-label'),
      href: node.getAttribute('href'),
      text: (node.innerText || '').trim().slice(0, 80),
      classHasFab: node.classList.contains('MuiFab-root'),
    }))
}

describe('QA Fix V1 — authenticated route matrix', () => {
  let qaKeys

  before(() => {
    cy.fixture('qa_fix_v1_keys').then((keys) => {
      qaKeys = keys
    })
  })

  QA_ROUTES.forEach(({ id, path, expectAdd }) => {
    it(`Q1 ${id}: renders without reported raw keys or application error`, () => {
      cy.login()
      cy.visit(path, { failOnStatusCode: false })
      cy.location('pathname', { timeout: 60000 }).should('eq', path)
      cy.get('#root', { timeout: 60000 }).should('be.visible')
      cy.get('body', { timeout: 60000 }).should(($body) => {
        expect(/[\u0600-\u06FF]/.test($body.text()), `${id} has Arabic UI text`).to.eq(true)
      })
      cy.wait(750)
      cy.window().then((win) => {
        const text = win.document.body.innerText || ''
        const reportedRawKeys = qaKeys.filter((key) => text.includes(key))
        const allRawKeys = Array.from(new Set(text.match(RAW_KEY_PATTERN) || []))
        const actions = visibleActionMetadata(win)
        expect(reportedRawKeys, `${id} reported QA raw keys`).to.deep.equal([])
        expect(text, `${id} application error`).not.to.match(APP_ERROR_PATTERN)
        if (expectAdd) {
          expect(actions.some((action) => action.classHasFab || /new$/i.test(action.href || '')), `${id} exposes an authorized create action`).to.eq(true)
        }
        cy.writeFile(`cypress/evidence/qa-fix-v1-auth-${id}.json`, {
          id,
          path,
          finalPath: win.location.pathname,
          reportedRawKeys,
          additionalRawKeys: allRawKeys.filter((key) => !qaKeys.includes(key)),
          arabicPresent: /[\u0600-\u06FF]/.test(text),
          expectedCreateAction: expectAdd,
          visibleCreateAction: actions.some((action) => action.classHasFab || /new$/i.test(action.href || '')),
          actions,
        })
      })
    })
  })

  it('Q2 Batch Run: exposes a localized accessible action and preserves required-input disabling', () => {
    cy.login()
    cy.visit('/front/claim_batch')
    cy.location('pathname').should('eq', '/front/claim_batch')
    cy.get('button[aria-label="بدء التسوية الدورية"]', { timeout: 60000 })
      .should('be.visible')
      .and('be.disabled')
    cy.writeFile('cypress/evidence/qa-fix-v1-auth-batch-run.json', {
      path: '/front/claim_batch',
      ariaLabel: 'بدء التسوية الدورية',
      localizedAriaLabelVisible: true,
      disabledWithoutYearAndMonth: true,
      mutationSubmitted: false,
    })
  })

  it('Q3 officer: authenticates, remains outside administration, and can open the existing family list', () => {
    cy.fixture('cred').then((cred) => {
      cy.visit('/front/login')
      cy.get('input[type="text"]', { timeout: 60000 }).first().clear().type(cred.officerUsername)
      cy.get('input[type="password"]').first().clear().type(cred.officerPassword, { log: false })
      cy.get('button[type="submit"]').click()
      cy.location('pathname', { timeout: 60000 }).should('not.eq', '/front/login')
      cy.contains('الإدارة').should('not.exist')
      cy.visit('/front/insuree/families')
      cy.location('pathname').should('eq', '/front/insuree/families')
      cy.get('body').should('contain.text', '29001011234567')
      cy.writeFile('cypress/evidence/qa-fix-v1-auth-officer.json', {
        username: cred.officerUsername,
        administrationMenuVisible: false,
        familiesPathAccessible: true,
        scenarioAHeadVisible: true,
        mutationSubmitted: false,
      })
    })
  })

  it('Q4 registers the complete authenticated QA test inventory', function () {
    const titles = this.test.parent.tests.map((test) => test.title)
    expect(titles.filter((title) => title.startsWith('Q1 '))).to.have.length(QA_ROUTES.length)
    expect(titles).to.include('Q2 Batch Run: exposes a localized accessible action and preserves required-input disabling')
    expect(titles).to.include('Q3 officer: authenticates, remains outside administration, and can open the existing family list')
    expect(titles).to.include('Q4 registers the complete authenticated QA test inventory')
    expect(titles).to.have.length(QA_ROUTES.length + 3)
  })
})
