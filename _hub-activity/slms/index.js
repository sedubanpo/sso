const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
initializeApp();
exports.hubActivityApi=onCall({region:'asia-northeast3',timeoutSeconds:30,memory:'256MiB',maxInstances:5},async request=>{if(Object.keys(request.data||{}).length)throw new HttpsError('invalid-argument','수신 계정을 지정할 수 없습니다.');try{return await require('./hub-activity').list(getFirestore(),request.auth?.uid);}catch(error){if(error instanceof HttpsError)throw error;throw new HttpsError('unavailable','업무 알림을 불러오지 못했습니다.');}});
