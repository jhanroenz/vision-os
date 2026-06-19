import { getAppData, setAppData } from "./repository.js";
import { assertPermission } from "./permissions.js";
import { registryIdFromSlug } from "./paths.js";

export async function handleSchemaAction(slug, manifest, actionId, payload = {}) {
  assertPermission(manifest, "storage");
  const appId = registryIdFromSlug(slug);

  switch (actionId) {
    case "save_form": {
      const { key = "formData", data } = payload;
      if (!key || typeof key !== "string") {
        throw new Error("save_form requires key");
      }
      setAppData(appId, key, data ?? {});
      return { ok: true, key, data: data ?? {} };
    }
    case "append_list": {
      const { key = "items", item } = payload;
      const existing = getAppData(appId, key)?.value ?? [];
      const list = Array.isArray(existing) ? existing : [];
      list.push(item);
      setAppData(appId, key, list);
      return { ok: true, key, items: list };
    }
    case "delete_list_item": {
      const { key = "items", index } = payload;
      const existing = getAppData(appId, key)?.value ?? [];
      const list = Array.isArray(existing) ? [...existing] : [];
      if (typeof index === "number" && index >= 0 && index < list.length) {
        list.splice(index, 1);
      }
      setAppData(appId, key, list);
      return { ok: true, key, items: list };
    }
    default:
      throw new Error(`Unknown schema action: ${actionId}`);
  }
}
