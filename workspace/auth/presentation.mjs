// Display policy only: does not change account status or application authorization.
const hiddenWorkers=new Set(['codex','김용찬','안준성']);
export const visibleWorkers=workers=>workers.filter(person=>!hiddenWorkers.has(String(person.name).trim().toLowerCase())).map(person=>({...person,position:String(person.name).trim()==='에스에듀'?'공용 계정':person.position||'직급 미지정'}));
export const menuVisible=app=>app.id!=='accounts';
export const availableApps=(apps,actor)=>apps.filter(app=>menuVisible(app)&&actor?.apps?.includes(app.id)&&(actor.role==='staff'||!app.staff));
export function introGroups(apps,actor){
 const allowed=availableApps(apps,actor);
 return (actor?.role==='staff'?[{label:'수업 지원',staff:false},{label:'데스크 · 학원 운영',staff:true}]:[{label:'나의 수업과 학생',staff:false}]).map(group=>({...group,apps:allowed.filter(app=>!!app.staff===group.staff)})).filter(group=>group.apps.length);
}
