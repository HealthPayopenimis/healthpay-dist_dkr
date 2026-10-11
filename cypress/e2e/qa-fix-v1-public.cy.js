describe('QA Fix V1 — public browser contract', () => {
  const rawKeyPattern = /\b(?:core|admin|location|claim|claim_batch|product|invoice|payment|policy|contribution|tools)\.[A-Za-z][A-Za-z0-9_.-]+\b/

  beforeEach(() => {
    cy.clearCookies()
    cy.clearLocalStorage()
  })

  it('P1 defaults a clean unauthenticated session to Arabic and RTL', () => {
    cy.visit('/front/login', {
      onBeforeLoad(win) {
        win.localStorage.clear()
      },
    })
    cy.location('pathname').should('eq', '/front/login')
    cy.get('html').should('have.attr', 'dir', 'rtl')
    cy.contains('label', 'اسم المستخدم').should('be.visible')
    cy.contains('label', 'كلمة المرور').should('be.visible')
    cy.get('input[type="text"]').should('be.visible')
    cy.get('input[type="password"]').should('be.visible')
    cy.contains('button', /^دخول$/).should('be.visible')
    cy.contains('هل نسيت كلمة المرور؟').should('be.visible')
    cy.get('#root').invoke('text').should('include', 'HealthPay Payer System')
    cy.title().should('include', 'HealthPay Payer System')
    cy.get('#root').invoke('text').then((text) => {
      expect(text).not.to.match(rawKeyPattern)
      cy.writeFile('cypress/evidence/qa-fix-v1-public-arabic.json', {
        path: '/front/login',
        direction: 'rtl',
        usernameLabel: 'اسم المستخدم',
        passwordLabel: 'كلمة المرور',
        loginLabel: 'دخول',
        forgotPasswordLabel: 'هل نسيت كلمة المرور؟',
        rawKeyPatternFound: false,
      })
    })
  })

  it('P2 preserves an explicit English public-language cookie override', () => {
    cy.setCookie('publicPageLanguage', 'en')
    cy.visit('/front/login')
    cy.get('html').should('have.attr', 'dir', 'rtl')
    cy.contains('label', 'Username').should('be.visible')
    cy.contains('label', 'Password').should('be.visible')
    cy.get('input[type="text"]').should('be.visible')
    cy.get('input[type="password"]').should('be.visible')
    cy.contains('button', /^Log In$/i).should('be.visible')
    cy.writeFile('cypress/evidence/qa-fix-v1-public-cookie-override.json', {
      cookie: 'publicPageLanguage=en',
      direction: 'rtl-global-shell',
      usernameLabel: 'Username',
      passwordLabel: 'Password',
      loginLabel: 'Log In',
    })
  })

  it('P3 redirects an unauthenticated protected route without exposing raw keys', () => {
    cy.visit('/front/admin/users', { failOnStatusCode: false })
    cy.location('pathname').should('eq', '/front/login')
    cy.get('#root').invoke('text').then((text) => {
      expect(text).not.to.match(rawKeyPattern)
    })
    cy.get('html').should('have.attr', 'dir', 'rtl')
    cy.writeFile('cypress/evidence/qa-fix-v1-public-protected-redirect.json', {
      requestedPath: '/front/admin/users',
      finalPath: '/front/login',
      direction: 'rtl',
      rawKeyPatternFound: false,
    })
  })

  it('P4 registers the complete public test inventory', function () {
    const titles = this.test.parent.tests.map((test) => test.title)
    expect(titles).to.deep.equal([
      'P1 defaults a clean unauthenticated session to Arabic and RTL',
      'P2 preserves an explicit English public-language cookie override',
      'P3 redirects an unauthenticated protected route without exposing raw keys',
      'P4 registers the complete public test inventory',
    ])
  })
})
