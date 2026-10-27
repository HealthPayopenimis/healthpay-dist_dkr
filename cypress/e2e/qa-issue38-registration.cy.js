import '../support/qa-issue38';
function root(label){return cy.get('label').filter((_,e)=>Cypress.$(e).is(':visible')&&e.textContent.includes(label)&&Cypress.$(e).closest('.MuiFormControl-root').find('input:not(:disabled)').length).first().closest('.MuiFormControl-root');}
function type(label,value){root(label).find('input').first().clear().type(value,{log:false,delay:0});}
function pick(label,code){
  root(label).then($r=>{
    if($r.find('input[aria-hidden="true"]').length)cy.wrap($r).find('[role="button"]').first().click();
    else cy.wrap($r).find('input').first().click().clear().type(code,{log:false,delay:0});
  });
  cy.contains('li',new RegExp('^'+Cypress._.escapeRegExp(code)+'(?:\\s|$)'),{timeout:60000}).should('be.visible').click();
}
function query(query,variables={}){
  return cy.window({log:false}).then(w=>cy.request({method:'POST',url:'/api/graphql',headers:{'X-CSRFToken':w.localStorage.getItem('csrfToken'),'X-Requested-With':'XMLHttpRequest'},body:{query,variables},log:false})).then(r=>{expect(r.status).eq(200);expect(r.body.errors).not.exist;return r.body.data;});
}
function birthday(){
  root('تاريخ الميلاد').find('input').click();
  cy.get('[role="dialog"]').contains('button',String(new Date().getFullYear())).click();
  cy.get('[role="dialog"]').contains('.MuiPickersYear-root','1990').scrollIntoView().click();
  // Existing picker is RTL. Assert each actual month before continuing; never save a guessed date.
  const months=['سبتمبر','أغسطس','يوليو','يونيو','مايو','أبريل','مارس','فبراير','يناير'];
  months.forEach(month=>{
    cy.get('[role="dialog"] .MuiPickersCalendarHeader-switchHeader button').first().click();
    cy.get('[role="dialog"] .MuiPickersCalendarHeader-switchHeader').should('contain',month);
  });
  cy.get('[role="dialog"] button.MuiPickersDay-day').filter((_,e)=>e.textContent==='1'&&!e.className.includes('hidden')).first().click();
  cy.get('[role="dialog"]').contains('button','موافق').click();
  root('تاريخ الميلاد').find('input').should('have.value','01-01-1990');
}
function save(){
  cy.get('button.MuiFab-root').filter((_,e)=>!!e.querySelector('svg')).last().should('be.enabled').click();
}
describe('TFAC real UI registration',()=>{
  it('registers the new TFAC family and first-service point through the UI',()=>{
    cy.login();
    query('query {insurees(chfId:"29001010190019",ignoreLocation:true,first:2){edges{node{id uuid family{id uuid} healthFacility{code}}}}}').then(d=>{
      const rows=d.insurees.edges;
      if(rows.length){
        expect(rows).length(1);expect(rows[0].node.healthFacility.code).eq('TFAC001');
        cy.writeFile('cypress/evidence/tfac-registration-existing-skip.json',{outcome:'EXACT_EXISTING_SYNTHETIC_SKIP',insuree:rows[0].node});
        return;
      }
      cy.intercept('POST','**/graphql',req=>{if(/insureeNumberValidity/.test(req.body?.query)&&req.body?.variables?.insuranceNumber==='29001010190019')req.alias='newTfacValidity';});
      cy.visit('/front/insuree/family');
      pick('المحافظة','EG01');pick('المركز / الحي','EG0109');pick('الشياخة / القرية','EG010901');
      root('المدينة / الحي (اختياري)').find('input').should('have.value','');
      type('الرقم القومي','29001010190019');
      cy.wait('@newTfacValidity',{timeout:60000}).then(({response})=>expect(response.body.data.insureeNumberValidity.isValid).eq(true));
      type('اسم العائلة','اختبار TFAC');type('الاسم الأول والأوسط','شخص اختباري — ليس شخصًا حقيقيًا');
      birthday();
      root('النوع').find('[role="button"]').click();cy.contains('li',/^ذكر$/).click();
      pick('المنشأة الصحية','TFAC001');
      cy.screenshot('tfac-registration-filled');
      save();
      cy.wait('@createFamily',{timeout:60000}).then(({response})=>{expect(response.statusCode).eq(200);expect(response.body.errors).not.exist;});
      cy.location('pathname',{timeout:120000}).should('match',/\/front\/insuree\/families\/familyOverview\/[0-9a-f-]{36}$/i);
      query('query {insurees(chfId:"29001010190019",ignoreLocation:true,first:2){edges{node{id uuid chfId lastName otherNames dob gender{code} family{id uuid location{code parent{code type}}} healthFacility{id uuid code}}}}}').then(d=>{
        expect(d.insurees.edges).length(1);const n=d.insurees.edges[0].node;
        expect(n.dob).eq('1990-01-01');expect(n.gender.code).eq('M');expect(n.family.location.code).eq('EG010901');expect(n.family.location.parent.type).eq('D');expect(n.healthFacility.code).eq('TFAC001');
        cy.writeFile('cypress/evidence/tfac-registration-readback.json',{outcome:'UI_SAVE_AND_READBACK_PASS',insuree:n});
      });
      cy.screenshot('tfac-registration-saved-overview');
    });
  });
});
