// Count only visible time for UI handshake deadlines. Network/token expiry is unchanged.
export function visibleDeadline(callback, delay, documentObject = globalThis.document) {
  let remaining = delay, started = 0, timer = null, stopped = false;
  const pause = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; remaining -= performance.now() - started; }
  };
  const cancel = () => { stopped = true; pause(); documentObject?.removeEventListener('visibilitychange', update); };
  const update = () => {
    pause();
    if (stopped || documentObject?.hidden) return;
    started = performance.now();
    timer = setTimeout(() => {
      timer = null;
      if (documentObject?.hidden) return; // Visibility delivery can lag a throttled timer.
      cancel(); callback();
    }, Math.max(0, remaining));
  };
  documentObject?.addEventListener('visibilitychange', update);
  update();
  return cancel;
}
