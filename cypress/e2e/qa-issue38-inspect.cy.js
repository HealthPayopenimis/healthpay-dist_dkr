import '../support/qa-v3-readonly';
function capture(name) {
  cy.document().then((doc) => {
    const visible=(e)=>Cypress.$(e).is(':visible');
    const inputs=[...doc.querySelectorAll('input')].filter(visible).map(e=>({id:e.id,type:e.type,value:e.value,readonly:e.readOnly,disabled:e.disabled,ariaLabel:e.getAttribute('aria-label')}));
    const labels=[...doc.querySelectorAll('label')].filter(visible).map(e=>({for:e.htmlFor,text:e.textContent}));
    const buttons=[...doc.querySelectorAll('button')].filter(visible).map(e=>({text:e.textContent,ariaLabel:e.getAttribute('aria-label'),title:e.getAttribute('title'),disabled:e.disabled,svg:e.querySelector('svg')?.getAttribute('data-testid')}));
    return cy.writeFile(`cypress/evidence/${name}.json`,{inputs,labels,buttons,bodyText:doc.body.innerText});
  });
}
describe('TFAC QA read-only control inspection',()=>{
  it('observes five facilities and exact family/date controls without saving',()=>{
    cy.login();
    cy.visit('/front/healthFacilities');
    cy.get('#root',{timeout:60000}).should('be.visible');
    capture('tfac-facility-inspect');
    cy.visit('/front/insuree/family');
    cy.get('label',{timeout:60000}).contains('الرقم القومي').should('be.visible');
    capture('tfac-family-controls');
    cy.get('label').filter((_,e)=>Cypress.$(e).is(':visible')&&e.textContent.includes('تاريخ الميلاد')).first().closest('.MuiFormControl-root').find('input').click();
    cy.get('[role="dialog"]').should('be.visible');
    capture('tfac-date-dialog');
    cy.screenshot('tfac-date-dialog');
    cy.contains('button','إلغاء').click();
  });
});
