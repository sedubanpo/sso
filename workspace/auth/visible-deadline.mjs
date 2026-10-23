// Count only visible time for UI handshake deadlines. Network/token expiry is unchanged.
export function visibleDeadline(callback, delay, documentObject = globalThis.document, focusWindow = null) {
  let remaining = delay, started = 0, timer = null, stopped = false;
  const inactive = () => documentObject?.hidden || (focusWindow && !documentObject?.hasFocus());
  const pause = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; remaining -= performance.now() - started; }
  };
  const cancel = () => { stopped = true; pause(); documentObject?.removeEventListener('visibilitychange', update); focusWindow?.removeEventListener('focus', update); focusWindow?.removeEventListener('blur', update); };
  const update = () => {
    pause();
    if (stopped || inactive()) return;
    started = performance.now();
    timer = setTimeout(() => {
      timer = null;
      if (inactive()) return; // Visibility delivery can lag a throttled timer.
      cancel(); callback();
    }, Math.max(0, remaining));
  };
  documentObject?.addEventListener('visibilitychange', update);
  focusWindow?.addEventListener('focus', update);
  focusWindow?.addEventListener('blur', update);
  update();
  return cancel;
}
