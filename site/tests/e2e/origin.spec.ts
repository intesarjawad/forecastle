import { expect, test } from "@playwright/test";

test("the card and its assets stay on the preview origin", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("A preview base URL is required.");
  const origin = new URL(baseURL).origin;
  const requests: string[] = [];
  const external: string[] = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (new URL(url).origin !== origin) {
      external.push(url);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Forecastle" })).toBeVisible();
  // The install links are added after first paint, once the browser is idle, so a busy runner reaches this later.
  await page.locator('link[rel="manifest"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifest) throw new Error("Missing manifest.");
    const response = await fetch(manifest.href);
    const data: { icons: { src: string }[] } = await response.json();
    await Promise.all(data.icons.map((icon) => fetch(new URL(icon.src, manifest.href))));
  });
  expect(requests.some((url) => url.endsWith(".woff2"))).toBe(true);
  expect(external).toEqual([]);
  expect(requests.every((url) => url.startsWith(`${origin}/`))).toBe(true);
});
