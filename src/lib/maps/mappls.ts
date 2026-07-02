let loader: Promise<void> | null = null;
export function loadMapplsSdk(key: string) {
  if (typeof window === "undefined") return Promise.reject(new Error("Map is client-only."));
  if ((window as Window & { mappls?: unknown }).mappls) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://apis.mappls.com/advancedmaps/api/${encodeURIComponent(key)}/map_sdk?layer=vector&v=3.0`;
    script.async = true; script.defer = true; script.onload = () => resolve(); script.onerror = () => reject(new Error("Mappls SDK failed to load."));
    document.head.appendChild(script);
  });
  return loader;
}
