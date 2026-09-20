import {createConnection} from './connection.mjs?v=20260920';
// Separate lifecycle: opening a tab must never dispose the embedded app.
export function openAppTab({appId,entry,brokerUrl,getIdToken,onState=()=>{},windowObject=window,connect=createConnection}){
 const target=windowObject.open('about:blank','_blank');
 if(!target){onState('blocked');return null;}
 let connection;
 try{connection=connect({appId,entry,brokerUrl,getIdToken,target,onState,windowObject});target.location.replace(connection.url);}
 catch{connection?.stop();target.close();onState('error');return null;}
 return {connection,target};
}
