import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("direct Edit upload → Preview → Recent → download preserves bytes", async ({ page }) => {
  const fixture = path.resolve("../../test/fixtures/sample.pdf");
  await page.goto("/edit");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page).toHaveURL(/\/edit\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "sample.pdf" })).toBeVisible();
  await expect(page.getByText("Ini Preview, bukan Editor native")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit text" })).toBeDisabled();
  await expect(page.locator("iframe")).toHaveAttribute("src", /\/api\/documents\/.+\/content/);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Unduh original" }).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const [original, downloaded] = await Promise.all([
    readFile(fixture),
    readFile(downloadedPath as string),
  ]);
  const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  expect(sha256(downloaded)).toBe(sha256(original));

  await page.goto("/recent");
  const row = page.getByRole("row").filter({ hasText: "sample.pdf" }).first();
  await expect(row.getByRole("link", { name: "Preview" })).toBeVisible();
});

test("public navigation is tool-first and legacy tools redirect", async ({ page }) => {
  await page.goto("/");
  for (const name of ["Edit PDF", "Merge", "Split", "Compress", "All Tools", "Recent Files"]) {
    await expect(page.getByRole("navigation").getByRole("link", { name, exact: true })).toBeVisible();
  }
  await page.goto("/tools/merge");
  await expect(page).toHaveURL(/\/merge$/);
  await expect(page.getByRole("heading", { name: "Gabungkan PDF" })).toBeVisible();
});
