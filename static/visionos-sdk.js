(function () {
  const SOURCE = "visionos-app";
  const meta = document.querySelector('meta[name="visionos-app-id"]');
  const appId = meta?.getAttribute("content") || "";

  function slugFromMeta() {
    return appId;
  }

  function rpc(method, args) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const origin = window.location.origin;

      function onMessage(event) {
        if (event.origin !== origin) return;
        const data = event.data;
        if (!data || data.source !== "visionos-host") return;
        if (data.requestId !== requestId) return;
        window.removeEventListener("message", onMessage);
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      }

      window.addEventListener("message", onMessage);
      window.parent.postMessage(
        { source: SOURCE, appId: slugFromMeta(), method, args, requestId },
        origin,
      );
    });
  }

  window.visionOS = {
    storage: {
      get: (key) => rpc("storage.get", { key }),
      set: (key, value) => rpc("storage.set", { key, value }),
      delete: (key) => rpc("storage.delete", { key }),
      list: () => rpc("storage.list", {}),
    },
    agent: {
      prompt: (message) => rpc("agent.prompt", { message }),
    },
    os: {
      openApp: (targetAppId, props) => rpc("os.openApp", { appId: targetAppId, props }),
      notify: (title, body) => rpc("os.notify", { title, body }),
    },
    jobs: {
      create: (opts) => rpc("jobs.create", opts || {}),
      list: () => rpc("jobs.list", {}),
      run: (jobId) => rpc("jobs.run", { jobId }),
    },
  };
})();
