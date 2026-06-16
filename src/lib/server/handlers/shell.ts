import { cancelShellSession, isShellWaiting } from '../shellSession.js';
import { json } from '../http.js';

export function cancel(threadId: string) {
  const cancelled = cancelShellSession(threadId);
  return json({ ok: cancelled });
}

export function status(threadId: string) {
  return json({ waiting: isShellWaiting(threadId) });
}
