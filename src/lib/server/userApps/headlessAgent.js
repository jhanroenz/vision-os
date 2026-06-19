/** Minimal headless agent turn for scheduled app jobs. */
export async function runHeadlessAgentPrompt({ appId, appName, prompt }) {
  console.log(`[userApps] Headless agent job for ${appName} (${appId}): ${prompt.slice(0, 120)}`);
  return { ok: true, note: "Headless agent prompt recorded (v1 stub)" };
}
