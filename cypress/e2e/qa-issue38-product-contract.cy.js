function root(label){return cy.get('label').filter((_,e)=>e.textContent.replace(/\*/g,'').replace(/\s+/g,' ').trim()===label).first().closest('.MuiFormControl-root');}
describe('TFAC policy product transport contract — read only',()=>{
 it('captures actual picker errors and a separate read-only DateTime control',()=>{
  const reads=[];cy.login();cy.fixture('tfac-records',{log:false}).then(records=>{
   cy.intercept('POST','**/graphql',req=>{const q=String(req.body?.query||'');if(!/\bmutation\b/.test(q)&&q.includes('ProductFragment')){const body=JSON.parse(JSON.stringify(req.body));req.continue(res=>reads.push({request:body,httpStatus:res.statusCode,response:res.body}));}});
   cy.visit('/front/policy/policy/_NEW_/'+records.familyUuid);
   root('برنامج التغطية').find('input:not(:disabled)').first().click().clear().type('TQAC001',{log:false,delay:0});
   cy.wrap(null).should(()=>{expect(reads.some(r=>r.request.variables?.search==='TQAC001'),'actual searched picker response captured').eq(true);});
   cy.then(()=>{
    const actual=reads.filter(r=>r.request.variables?.search==='TQAC001').pop();
    cy.screenshot('tfac-product-picker-contract',{capture:'viewport'});
    const control=JSON.parse(JSON.stringify(actual.request));for(const k of ['dateFrom','dateTo']){if(typeof control.variables[k]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(control.variables[k]))control.variables[k]+='T00:00:00';}
    cy.window({log:false}).then(w=>cy.request({method:'POST',url:'/api/graphql',headers:{'X-CSRFToken':w.localStorage.getItem('csrfToken'),'X-Requested-With':'XMLHttpRequest'},body:control,failOnStatusCode:false,log:false})).then(r=>{
     cy.writeFile('cypress/evidence/tfac-product-picker-contract.json',{actor:'hpadmin',uiSearch:'TQAC001',actualPickerReads:reads,isolatedReadOnlyControl:{request:control,httpStatus:r.status,response:r.body},businessMutations:0},{log:false});
    });
   });
  });
 });
});
