import { exports } from "cloudflare:workers";
import { expect, test } from "vitest";

test("an unknown route returns 404", async () => {
  const response = await exports.default.fetch("https://example.test/unknown");
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("Not found");
});
