/** Permission checks for user app SDK/API calls. */

const PERMISSION_ALIASES = {
  storage: "storage",
  "files:read": "files:read",
  "agent:prompt": "agent:prompt",
  jobs: "jobs",
  network: "network",
};

export function normalizePermissions(manifest) {
  const raw = manifest?.permissions ?? ["storage"];
  return new Set(
    raw.map((p) => PERMISSION_ALIASES[p] ?? p).filter(Boolean),
  );
}

export function hasPermission(manifest, token) {
  const perms = normalizePermissions(manifest);
  if (token === "network") return false;
  return perms.has(token);
}

export function assertPermission(manifest, token) {
  if (!hasPermission(manifest, token)) {
    throw new Error(`Permission denied: ${token}`);
  }
}

export function filterAllowedSdkMethods(manifest) {
  const methods = [];
  if (hasPermission(manifest, "storage")) {
    methods.push("storage.get", "storage.set", "storage.delete", "storage.list");
  }
  if (hasPermission(manifest, "agent:prompt")) {
    methods.push("agent.prompt");
  }
  methods.push("os.openApp", "os.notify");
  if (hasPermission(manifest, "jobs")) {
    methods.push("jobs.create", "jobs.list", "jobs.run");
  }
  if (hasPermission(manifest, "files:read")) {
    methods.push("files.read");
  }
  return methods;
}
