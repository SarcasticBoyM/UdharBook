const SCRIPT_ID = "mappls-web-map-sdk";
const SDK_WAIT_MS = 10_000;

let loader: Promise<void> | null = null;

function hasMapplsSdk() {
  return Boolean((window as Window & { mappls?: { Map?: unknown } }).mappls?.Map);
}

function waitForMapplsSdk() {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (hasMapplsSdk()) return resolve();
      if (Date.now() - startedAt >= SDK_WAIT_MS) {
        return reject(new Error("Mappls SDK object not found after load"));
      }
      window.setTimeout(check, 50);
    };
    check();
  });
}

export function loadMapplsSdk(key: string) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Mappls SDK can only load in the browser"));
  }
  if (hasMapplsSdk()) return Promise.resolve();
  if (loader) return loader;

  loader = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    let failed = false;

    const ready = () => {
      if (failed) return;
      void waitForMapplsSdk().then(resolve, reject);
    };
    const fail = () => {
      failed = true;
      reject(new Error("SDK script failed"));
    };

    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (existing) {
      ready();
      return;
    }

    script.id = SCRIPT_ID;
    script.src = `https://apis.mappls.com/advancedmaps/api/${encodeURIComponent(key)}/map_sdk?v=3.0&layer=vector`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  });

  return loader;
}
