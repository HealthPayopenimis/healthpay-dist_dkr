function root(label){return cy.get('label').filter((_,e)=>e.textContent.replace(/\*/g,'').replace(/\s+/g,' ').trim()===label).first().closest('.MuiFormControl-root');}
describe('TFAC claim entry context — read only',()=>{
 it('observes supported admin selection and visible Add Claim context',()=>{
  cy.login();cy.visit('/front/claim/healthFacilities');
  root('مسؤول المطالبات').find('input:not(:disabled)').first().click().clear().type('TESTTFAC',{log:false,delay:0});
  cy.contains('li',/^TESTTFAC\s/).should('be.visible').click();
  cy.screenshot('tfac-claim-context-list',{capture:'viewport'});
  cy.get('button.MuiFab-root').filter((_,e)=>Cypress.$(e).is(':visible')&&!e.disabled).last().click();
  cy.location('pathname').should('include','/claim/claim');
  cy.contains('label','رقم المطالبة').should('exist');
  cy.get('body').then($body=>{
   const fields=[];for(const label of ['المنشأة الصحية','مسؤول المطالبات']){$body.find('label').filter((_,e)=>e.textContent.replace(/\*/g,'').replace(/\s+/g,' ').trim()===label).each((_,e)=>{const r=Cypress.$(e).closest('.MuiFormControl-root');fields.push({label,inputs:r.find('input').toArray().map(i=>({value:i.value,disabled:i.disabled,readOnly:i.readOnly})),text:r.text()});});}
   cy.writeFile('cypress/evidence/tfac-claim-entry-context.json',{actor:'hpadmin',fields,claimMutationSubmitted:false},{log:false});
  });cy.screenshot('tfac-claim-context-new-form',{capture:'viewport'});
 });
});
