export function selectionAt(events, seconds) {
  let current = null;
  for (const event of events || []) {
    if (!Number.isFinite(event?.at) || event.at > seconds) continue;
    if (!current || event.at >= current.at) current = event;
  }
  return current?.p?.operation === 'set' ? current : null;
}
