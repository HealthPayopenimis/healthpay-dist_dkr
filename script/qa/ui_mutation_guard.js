function guardMutation(query, variables, records) {
  const q=String(query||'');
  if(!/\bmutation\b/.test(q))return 'READ';
  if(/\b(tokenAuth|getCsrfToken|refreshToken|verifyToken|tokenRefresh)\s*\(/.test(q))return 'AUTH';
  const m=q.match(/\b(createFamily|createPolicy|createPremium|createClaim|updateClaim|submitClaims|selectClaimsForFeedback|deliverClaimFeedback|selectClaimsForReview|saveClaimReview|deliverClaimsReview|processClaims)\s*\(/);
  if(!m)throw new Error('TFAC guard denied unapproved mutation');
  const op=m[1], all=q+' '+JSON.stringify(variables||{});
  const has=(value)=>value!==undefined&&value!==null&&all.includes(String(value));
  const exactField=(name,value)=>{
    const input=variables?.input;
    if(input&&Object.prototype.hasOwnProperty.call(input,name))return String(input[name])===String(value);
    const pattern=new RegExp('\\b'+name+'\\s*:\\s*"?'+String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"?(?=[\\s,}])');
    return pattern.test(q);
  };
  if(op==='createFamily'){
    if(!has('29001010190019')||!has('TFAC')||/\buuid\s*:/.test(q)||variables?.input?.uuid)throw new Error('Only the new synthetic TFAC family may be created');
  }else if(op==='createPolicy'){
    if(!records.familyId||!exactField('familyId',records.familyId)||!exactField('productId',records.productId)||!exactField('officerId',records.officerId))throw new Error('Policy must use only new TFAC fixture IDs');
  }else if(op==='createPremium'){
    if(!records.policyId||!exactField('policyId',records.policyId)||!has('TEST-TFAC-0001'))throw new Error('Premium must use new TFAC policy/receipt');
  }else if(op==='createClaim'){
    if(!has('TFACC001')||!exactField('insureeId',records.insureeId)||!exactField('adminId',records.claimAdminId)||!exactField('healthFacilityId',records.facilityId)||!exactField('icdId',records.diagnosisId)||!exactField('serviceId',records.serviceId)||/\bitemId\s*:\s*\d/.test(q))throw new Error('Claim must use only the service-only TFAC fixture');
  }else{
    if(!records.claimUuid||!has(records.claimUuid))throw new Error('Claim lifecycle target must be the new TFAC claim');
    const match=q.match(/\buuids\s*:\s*\[([^\]]*)\]/);
    if(match){
      const ids=[...match[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
      if(ids.length!==1||ids[0]!==records.claimUuid)throw new Error('Only the single new claim UUID is allowed');
    }
    const uuidTarget=variables?.input?.uuid||variables?.input?.claimUuid;
    if(uuidTarget&&uuidTarget!==records.claimUuid)throw new Error('Incorrect claim UUID target');
  }
  if(has('TESTA001')||has('29001011234567'))throw new Error('Frozen Scenario A is never a mutation target');
  return op;
}
module.exports={guardMutation};
