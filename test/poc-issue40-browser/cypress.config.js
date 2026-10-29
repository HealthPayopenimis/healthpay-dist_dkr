const { defineConfig } = require('cypress');

module.exports = defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  retries: 0,
  viewportWidth: 1440,
  viewportHeight: 1100,
  defaultCommandTimeout: 30000,
  requestTimeout: 60000,
  responseTimeout: 120000,
  pageLoadTimeout: 120000,
  e2e: {
    baseUrl: process.env.CYPRESS_baseUrl || 'https://inspayer.healthpay.tech',
    fixturesFolder: false,
    supportFile: 'cypress/support/issue40-readonly.js',
    specPattern: 'cypress/e2e/issue40-catchment-readonly.cy.js',
    screenshotsFolder: 'cypress/evidence/screenshots',
  },
});
