// Display policy only: does not change account status or application authorization.
const hiddenWorkers=new Set(['codex','김용찬','안준성']);
export const visibleWorkers=workers=>workers.filter(person=>!hiddenWorkers.has(String(person.name).trim().toLowerCase())).map(person=>({...person,position:String(person.name).trim()==='에스에듀'?'공용 계정':person.position||'직급 미지정'}));
export const menuVisible=app=>app.id!=='accounts';
