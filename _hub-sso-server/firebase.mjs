import {initializeApp,getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {createBroker} from './core.mjs';
import {APPS} from './registry.mjs';
// Use managed service identity in a deployed runtime. No secret/key file is bundled or read by this project.
export function firebaseBroker(hubOrigins){
  const app=getApps()[0]||initializeApp({projectId:'fir-lms-prod'}),auth=getAuth(app),db=getFirestore(app);
  const identity={verify:token=>auth.verifyIdToken(token,true),user:uid=>auth.getUser(uid),mint:uid=>auth.createCustomToken(uid),profile:async uid=>{
    const snapshots=await db.getAll(...['users','userProfiles','userAppAccess'].map(c=>db.collection(c).doc(uid)));
    return snapshots.map(s=>s.exists?s.data():{});
  }};
  const tickets=db.collection('_hubSsoTickets');
  const store={put:(key,value)=>tickets.doc(key).set({...value,deleteAfter:new Date(value.expiresAt)}),consume:(key,valid)=>db.runTransaction(async tx=>{const ref=tickets.doc(key),snap=await tx.get(ref),value=snap.data();if(!valid(value))return null;tx.delete(ref);return value;})};
  return createBroker({identity,store,registry:APPS,hubOrigins});
}
