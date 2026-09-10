const ROUTES = [
  { id: 'claim-entry-list', path: '/front/claim/healthFacilities', module: 'fe-claim' },
  { id: 'claim-new', path: '/front/claim/healthFacilities/claim', module: 'fe-claim' },
  { id: 'claim-reviews', path: '/front/claim/reviews', module: 'fe-claim' },
  { id: 'invoices', path: '/front/invoices', module: 'fe-invoice' },
  { id: 'invoice-new', path: '/front/invoices/invoice', module: 'fe-invoice' },
  { id: 'tasks', path: '/front/tasks', module: 'fe-tasks_management' },
  { id: 'all-tasks', path: '/front/AllTasks', module: 'fe-tasks_management' },
  { id: 'task-groups', path: '/front/tasks/groups', module: 'fe-tasks_management' },
  { id: 'extracts', path: '/front/tools/extracts', module: 'fe-tools' },
  { id: 'registers', path: '/front/tools/registers', module: 'fe-tools' },
  { id: 'my-profile', path: '/front/profile/myProfile', module: 'fe-profile' },
  { id: 'medical-services', path: '/front/medical/medicalServices', module: 'fe-medical' },
  { id: 'medical-service-new', path: '/front/medical/medicalServices/new', module: 'fe-medical' },
  { id: 'medical-items', path: '/front/medical/medicalItems', module: 'fe-medical' },
  { id: 'medical-item-new', path: '/front/medical/medicalItems/new', module: 'fe-medical' },
  { id: 'service-pricelists', path: '/front/medical/pricelists/services', module: 'fe-medical_pricelist' },
  { id: 'item-pricelists', path: '/front/medical/pricelists/items', module: 'fe-medical_pricelist' },
  { id: 'batch-run', path: '/front/claim_batch', module: 'fe-claim_batch' },
  { id: 'roles', path: '/front/roles', module: null },
  { id: 'role-new', path: '/front/roles/role', module: null },
  { id: 'product-new', path: '/front/admin/products/new', module: null },
  { id: 'family-overview', path: '/front/insuree/families/familyOverview/e456ef2f-6a84-4408-ad3d-3ab2e90d30bf', module: null },
]

const APP_ERROR_PATTERN = /Internal Server Error|Something went wrong|حدث خطأ غير متوقع|انتهت صلاحية الجلسة/i
const RAW_KEY_PATTERN = /\b(?:claim|invoice|invoices|bill|tasksManagement|tools|profile|medical|medical_pricelist|claim_batch|core|location|insuree|policy|product)\.[A-Za-z][A-Za-z0-9_.-]+\b/g

function visible(node, win) {
  const style = win.getComputedStyle(node)
  const rect = node.getBoundingClientRect()
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
}

function metadata(win) {
  const text = win.document.body.innerText || ''
  const labels = Array.from(win.document.querySelectorAll('label, h1, h2, h3, h4, h5, h6, th'))
    .filter((node) => visible(node, win))
    .map((node) => (node.innerText || '').trim())
    .filter(Boolean)
    .slice(0, 120)
  const actions = Array.from(win.document.querySelectorAll('button, a[role="button"], .MuiFab-root'))
    .filter((node) => visible(node, win))
    .map((node) => ({
      tag: node.tagName,
      text: (node.innerText || '').trim().slice(0, 120),
      title: node.getAttribute('title') || node.closest('[title]')?.getAttribute('title') || null,
      ariaLabel: node.getAttribute('aria-label'),
      disabled: !!node.disabled || node.getAttribute('aria-disabled') === 'true',
      href: node.getAttribute('href'),
      className: String(node.className || '').slice(0, 180),
    }))
    .slice(0, 120)
  const inputs = Array.from(win.document.querySelectorAll('input, textarea, [role="combobox"]'))
    .filter((node) => visible(node, win))
    .map((node) => ({
      name: node.getAttribute('name'),
      type: node.getAttribute('type'),
      maxLength: node.maxLength >= 0 ? node.maxLength : null,
      valuePresent: !!node.value,
      readOnly: !!node.readOnly,
      disabled: !!node.disabled,
      ariaLabel: node.getAttribute('aria-label'),
    }))
    .slice(0, 120)
  return { text, labels, actions, inputs }
}

describe('HealthPay Fix V2 — read-only live validation', () => {
  let missingByModule
  const findings = []

  before(() => {
    cy.fixture('v2_missing_arabic_keys').then((value) => {
      missingByModule = value
    })
  })

  ROUTES.forEach(({ id, path, module }) => {
    it(`${id}: inventories the live page without mutation`, () => {
      cy.login()
      cy.visit(path, { failOnStatusCode: false })
      cy.get('#root', { timeout: 60000 }).should('be.visible')
      cy.wait(1200)
      cy.window().then((win) => {
        const m = metadata(win)
        const moduleMissing = module ? (missingByModule[module]?.missing_keys || []) : []
        const visibleMissingKeys = moduleMissing.filter((key) => m.text.includes(key))
        const additionalRawKeys = Array.from(new Set(m.text.match(RAW_KEY_PATTERN) || []))
          .filter((key) => !visibleMissingKeys.includes(key))
        const record = {
          id,
          requestedPath: path,
          finalPath: win.location.pathname,
          arabicPresent: /[\u0600-\u06FF]/.test(m.text),
          appError: APP_ERROR_PATTERN.test(m.text),
          visibleMissingKeys,
          additionalRawKeys,
          bodyTextSample: m.text.slice(0, 1200),
          labels: m.labels,
          actions: m.actions,
          inputs: m.inputs,
          mutationSubmitted: false,
        }
        findings.push(record)
        cy.writeFile(`cypress/evidence/v2-${id}.json`, record)
        expect(record.appError, `${id} application error`).to.eq(false)
        expect(record.finalPath, `${id} should remain authenticated`).not.to.eq('/front/login')
        expect(record.visibleMissingKeys, `${id} known V2 raw keys`).to.deep.eq([])
        expect(record.additionalRawKeys, `${id} additional raw keys`).to.deep.eq([])
      })
    })
  })

  it('writes the complete V2 route inventory and proves no mutation was submitted', () => {
    cy.writeFile('cypress/evidence/v2-route-summary.json', {
      routeCount: ROUTES.length,
      findings,
      mutationSubmitted: false,
    })
    expect(findings).to.have.length(ROUTES.length)
    expect(findings.every((item) => item.mutationSubmitted === false)).to.eq(true)
  })
})
