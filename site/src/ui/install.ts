let installed = false;

export function loadInstallAssets(): void {
  if (installed) return;
  installed = true;
  for (const [rel, href] of [
    ["icon", "./favicon.svg"],
    ["apple-touch-icon", "./apple-touch-icon.png"],
    ["manifest", "./manifest.webmanifest"],
  ] as const) {
    const link =
      document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`) ??
      document.createElement("link");
    link.rel = rel;
    link.href = href;
    if (rel === "icon") link.type = "image/svg+xml";
    if (rel === "apple-touch-icon") link.sizes.add("180x180");
    if (!link.isConnected) document.head.append(link);
  }
}
