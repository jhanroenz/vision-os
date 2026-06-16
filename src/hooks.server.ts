import '$lib/server/env';
import { initVisionOS } from '$lib/server/init';
import type { Handle } from '@sveltejs/kit';

let initialized = false;

export const handle: Handle = async ({ event, resolve }) => {
  if (!initialized) {
    await initVisionOS();
    initialized = true;
  }
  return resolve(event);
};
