// Keep the selected desk frame laid out while authentication starts. A display:none
// frame can defer browser work required by its login bootstrap. The opaque gate
// covers it; inert and aria-hidden prevent interaction until authenticated.
export function presentFrames(frames, selected, state, host) {
  const preparing = selected === 'desk' && state === 'pending';
  host.classList.toggle('is-preparing', preparing);
  for (const [id, frame] of frames) {
    const ready = id === selected && state === 'ready';
    frame.hidden = !(ready || (id === selected && preparing));
    frame.inert = !ready;
    if (ready) frame.removeAttribute('aria-hidden');
    else frame.setAttribute('aria-hidden', 'true');
  }
}
