const SCRIPT_ID = "mappls-web-map-sdk";
const SDK_WAIT_MS = 10_000;

type MapplsSdk = { Map?: unknown; Marker?: unknown };
type MapplsWindow = Window & { Mappls?: MapplsSdk; mappls?: MapplsSdk };

let loader: Promise<MapplsSdk> | null = null;

function getMapplsSdk(): MapplsSdk | undefined {
  if (typeof window === "undefined") return undefined;
  const mapWindow = window as MapplsWindow;
  return mapWindow.mappls?.Map ? mapWindow.mappls : mapWindow.Mappls?.Map ? mapWindow.Mappls : undefined;
}

function waitForMapplsSdk() {
  return new Promise<MapplsSdk>((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      const sdk = getMapplsSdk();
      if (sdk) return resolve(sdk);
      if (Date.now() - startedAt >= SDK_WAIT_MS) {
        console.error("[Mappls] SDK script loaded, but neither window.mappls nor window.Mappls is available.");
        return reject(new Error("MAPPLS_GLOBAL_UNAVAILABLE"));
      }
      window.setTimeout(check, 50);
    };
    check();
  });
}

export function loadMapplsSdk(key: string | undefined) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("MAPPLS_BROWSER_REQUIRED"));
  }

  const browserKey = key?.trim();
  if (!browserKey) {
    console.error("[Mappls] Missing NEXT_PUBLIC_MAPPLS_MAP_SDK_KEY; the browser SDK was not requested.");
    return Promise.reject(new Error("MAPPLS_KEY_MISSING"));
  }

  const availableSdk = getMapplsSdk();
  if (availableSdk) return Promise.resolve(availableSdk);
  if (loader) return loader;

  loader = new Promise<MapplsSdk>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");

    const fail = () => {
      // Browsers intentionally do not expose whether a script error was caused by
      // ERR_BLOCKED_BY_CLIENT, DNS filtering, an extension, or a network failure.
      console.error("[Mappls] Browser SDK script was blocked or failed to load. The fallback map will be used. Check privacy extensions, antivirus/DNS filters, the static key, and the domain whitelist.");
      reject(new Error("MAPPLS_SCRIPT_BLOCKED_OR_FAILED"));
    };
    const ready = () => void waitForMapplsSdk().then(resolve, reject);

    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", fail, { once: true });

    if (existing) {
      // A script inserted elsewhere may already have completed before listeners were attached.
      ready();
      return;
    }

    script.id = SCRIPT_ID;
    script.src = `https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=${encodeURIComponent(browserKey)}`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }).catch((error) => {
    // Keep successful loads singleton, but permit recovery after a transient network/config failure.
    loader = null;
    document.getElementById(SCRIPT_ID)?.remove();
    throw error;
  });

  return loader;
}
