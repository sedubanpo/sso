// Recovery is mailbox possession proof. DOB only narrows an account; it never authorizes a reset.
export const RECOVERY_REPLY={message:'입력한 정보와 일치하는 계정이 있으면 복구 이메일로 안내를 보냅니다. 받은편지함과 스팸함을 확인해 주세요.'};
export function validateRecoveryInput(body){
 const email=String(body?.email||'').trim().toLowerCase(),birthDate=String(body?.birthDate||'');
 if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||email.endsWith('@sedu-auth.local'))throw Error('실제 복구 이메일을 입력해 주세요.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)||new Date(birthDate+'T00:00:00Z').toISOString().slice(0,10)!==birthDate)throw Error('생년월일을 확인해 주세요.');
 return {email,birthDate};
}
export function createRecovery({consumeQuota,findProfiles,getUser,createResetLink,sendMail}){
 return async function recover(body,requestKey){
  const {email,birthDate}=validateRecoveryInput(body);
  // Shared durable quota is mandatory. Both requester and mailbox limits precede any lookup/mail.
  if(!await consumeQuota({requestKey,email}))return RECOVERY_REPLY;
  const matches=(await findProfiles(email)).filter(p=>String(p.contactEmail||'').trim().toLowerCase()===email&&p.birthDate===birthDate);
  if(matches.length!==1)return RECOVERY_REPLY;
  const account=await getUser(matches[0].uid);
  if(!account||account.disabled||!account.email)return RECOVERY_REPLY;
  const link=await createResetLink(account.email);
  // Never return the reset link to the requester or send it to an address supplied independently of the profile.
  await sendMail({to:matches[0].contactEmail.trim(),link});
  return RECOVERY_REPLY;
 };
}
