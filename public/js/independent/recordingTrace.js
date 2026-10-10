const snapshot = (value) => JSON.parse(JSON.stringify(value));

export function createInitialStateTrace(sessionId, result, occurredAt = Date.now()) {
  if (!sessionId || !result?.ok || !result.state) return null;
  return { sessionId, revision: result.state.revision ?? null, state: snapshot(result.state), occurredAt };
}

export function createServerActionTrace(action, result, occurredAt = Date.now()) {
  if (!result?.ok || !result.state) return null;
  return {
    action: action?.type || 'unknown',
    command: snapshot(action),
    state: snapshot(result.state),
    revision: result.state.revision ?? null,
    eventTypes: (result.events || []).map((item) => item.type).filter(Boolean),
    occurredAt,
  };
}

export function notifyRecordingServerAction(hook, action, result) {
  try { hook?.(action, result); } catch { /* optional recording cannot affect gameplay */ }
}
