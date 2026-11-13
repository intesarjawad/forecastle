import { expect, test } from "vitest";
import sourceHtml from "../../index.html?raw";

test("the source page title uses the working name", () => {
  expect(sourceHtml.match(/<title>(.*?)<\/title>/u)?.[1]).toBe("Forecastle");
});
