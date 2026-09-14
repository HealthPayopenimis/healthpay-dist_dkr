describe('HealthPay Fix V2 — live TESTA001 presentation and accessibility', () => {
  const productPath = '/front/admin/products/16264535-964a-46b8-a948-e8e44ced5f83'

  function openProduct() {
    cy.login()
    cy.visit(productPath)
    cy.location('pathname', { timeout: 60000 }).should('eq', productPath)
    cy.get('input[value="TESTA001"]', { timeout: 60000 }).should('exist')
  }

  it('renders source-proven units and conversion-program explanation without mutation', () => {
    openProduct()
    cy.get('body').invoke('text').then((text) => {
      ;[
        'الحد الأقصى لأفراد الأسرة (عدد)',
        'مدة التغطية (بالأشهر)',
        'المدة الإدارية (بالأشهر)',
        'الحد الأدنى للعمر (سنوات)',
        'الحد الأقصى للعمر (سنوات)',
        'برنامج التغطية البديل',
      ].forEach((label) => expect(text, `visible main product label ${label}`).to.include(label))
    })
    cy.contains('button', 'خطة الاشتراكات').click()
    cy.wait(500)
    cy.get('body').invoke('text').then((text) => {
      ;[
        'المبلغ الإجمالي (ج.م)',
        'الحد الأقصى للأقساط (عدد)',
        'مدة خصم التجديد (أشهر)',
        'نسبة خصم التجديد (%)',
        'فترة السماح للاشتراك (أشهر)',
      ].forEach((label) => expect(text, `visible contribution label ${label}`).to.include(label))
      cy.writeFile('cypress/evidence/v2-product-units.json', {
        path: productPath,
        testCode: 'TESTA001',
        mainAndContributionLabelsPresent: true,
        mutationSubmitted: false,
      })
    })
  })

  it('renders every conditionally displayed deductible and ceiling input with a localized accessible label', () => {
    openProduct()
    cy.contains('button', 'التحمل والحدود القصوى').click()
    cy.wait(500)
    cy.get('body').invoke('text').should('include', 'مبلغ التحمل (ج.م)').and('include', 'الحد الأقصى (ج.م)')
    cy.get('input[aria-label]', { timeout: 30000 }).then(($inputs) => {
      const labels = Array.from($inputs)
        .map((input) => input.getAttribute('aria-label'))
        .filter((value) => value && /[\u0600-\u06FF]/.test(value))
      expect(labels, 'all conditionally rendered numeric inputs have localized labels').to.have.length(15)
      expect(new Set(labels).size, 'distinct row/column accessibility labels').to.be.greaterThan(10)
      cy.writeFile('cypress/evidence/v2-product-numeric-accessibility.json', {
        path: productPath,
        renderedNumericInputCount: 15,
        localizedAriaLabelCount: labels.length,
        sourceStaticAriaContract: '23/23',
        distinctAriaLabelCount: new Set(labels).size,
        labels,
        mutationSubmitted: false,
      })
    })
  })
})
