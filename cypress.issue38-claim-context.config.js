const {defineConfig}=require('cypress');
module.exports=defineConfig({viewportWidth:1440,viewportHeight:1100,video:false,screenshotOnRunFailure:true,e2e:{baseUrl:'https://inspayer.healthpay.tech',defaultCommandTimeout:30000,pageLoadTimeout:120000,requestTimeout:60000,responseTimeout:120000,specPattern:'cypress/e2e/qa-issue38-claim-context.cy.js',supportFile:'cypress/support/qa-v3-readonly.js'}});
