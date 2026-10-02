export function installLeaveGuard(target=window){
 const warn=event=>{event.preventDefault();event.returnValue='';};
 target.addEventListener('beforeunload',warn);
 return ()=>target.removeEventListener('beforeunload',warn);
}
