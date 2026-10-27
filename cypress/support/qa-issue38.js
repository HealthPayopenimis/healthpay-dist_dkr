const {guardMutation}=require('../../script/qa/ui_mutation_guard');
let events=[];
Cypress.Commands.add('login',()=>{
  cy.fixture('cred',{log:false}).then(c=>{
    cy.visit('/front/login');
    cy.get('input[type="text"]',{timeout:120000}).first().clear().type(c.username,{log:false});
    cy.get('input[type="password"]').first().clear().type(c.password,{log:false});
    cy.get('button[type="submit"]').click();
    cy.url({timeout:60000}).should('not.include','/front/login');
    cy.request({url:'/api/core/users/current_user/',log:false}).its('status').should('eq',200);
  });
});
beforeEach(()=>{
  events=[];
  cy.fixture('tfac-records',{log:false}).then(r=>Cypress.env('tfacRecords',r));
  cy.fixture('cred',{log:false}).then(c=>{if(!['hpadmin','TFACCLM'].includes(c.username))throw new Error('Exact approved TFAC UI actor required');Cypress.env('qaActor',c.username);});
  cy.intercept('POST','**/graphql',req=>{
    const op=guardMutation(req.body?.query,req.body?.variables,Cypress.env('tfacRecords')||{});
    if(op==='AUTH'||op==='READ')return;
    const event={operation:op,requestBody:req.body,actor:Cypress.env('qaActor'),requestedAt:new Date().toISOString()};events.push(event);
    req.alias=op;
    req.continue(res=>{event.httpStatus=res.statusCode;event.responseBody=res.body;event.respondedAt=new Date().toISOString();});
  });
});
afterEach(function(){
  cy.writeFile('cypress/evidence/tfac-'+this.currentTest.title.replace(/[^a-z0-9-]/gi,'_')+'-operations.json',{test:this.currentTest.title,state:this.currentTest.state,events});
});
