import { expect, test } from "@playwright/test";

test.describe("PinCheck smoke tests", () => {
  test("renders the home page and generates a clean preset circuit", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByLabel("Circuit prompt")).toBeVisible();
    await expect(page.getByText("ESP32 DevKit V1 (30-pin)").first()).toBeVisible();

    await page
      .getByRole("button", { name: "ESP32 Weather Station with OLED & BME280" })
      .click();

    const generate = page.getByRole("button", { name: "generate circuit" });
    await expect(generate).toBeEnabled({ timeout: 15_000 });
    await generate.click();

    await expect(page.getByText(/health 100/).first()).toBeVisible();
    await expect(page.getByText("No critical issues.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Interactive circuit schematic")).toBeVisible();
  });

  test("auto-fix repairs the deliberately buggy preset", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Deliberate Buggy Circuit Demo" }).click();

    const generate = page.getByRole("button", { name: "generate circuit" });
    await expect(generate).toBeEnabled({ timeout: 15_000 });
    await generate.click();

    const autoFix = page.getByRole("button", { name: /Auto-Fix Circuit/ });
    await expect(autoFix).toBeEnabled({ timeout: 15_000 });
    await autoFix.click();

    await expect(page.getByRole("status")).toContainText("Auto-fix applied");
  });

  test("injects and clears faults", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "ESP32 Weather Station with OLED & BME280" }).click();

    const generate = page.getByRole("button", { name: "generate circuit" });
    await expect(generate).toBeEnabled({ timeout: 15_000 });
    await generate.click();

    await page.getByRole("checkbox", { name: /Fault injection/i }).check();
    await expect(page.getByRole("heading", { name: "Fault injection" })).toBeVisible();

    await page.getByRole("button", { name: /Open Circuit/ }).click();
    const faultEntry = page.getByText("open · signal path severed at runtime", { exact: true });
    await expect(faultEntry).toBeVisible();

    await page.getByRole("button", { name: /^clear \d+$/ }).click();
    await expect(faultEntry).toHaveCount(0);
  });

  test("saves a circuit and opens its share page", async ({ page }) => {
    const title = `E2E circuit ${Date.now()}`;
    await page.goto("/");
    await page.getByRole("button", { name: "ESP32 Weather Station with OLED & BME280" }).click();

    const generate = page.getByRole("button", { name: "generate circuit" });
    await expect(generate).toBeEnabled({ timeout: 15_000 });
    await generate.click();

    await page.getByRole("button", { name: "Save & share" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByRole("button", { name: "Save circuit" }).click();

    await expect(dialog.getByText("Share link ready")).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("link", { name: "Open share page" }).click();

    await expect(page).toHaveURL(/\/c\/[A-Za-z0-9_-]+/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByText("No issues detected. This wiring passes every modeled check.")).toBeVisible();

    // The test database is shared across the suite, so remove the row this test created.
    const circuitId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1);
    expect(circuitId).toBeTruthy();
    if (!circuitId) {
      throw new Error("Expected the share URL to contain a circuit id");
    }
    const deleted = await page.request.delete(`/api/circuits/${circuitId}`);
    expect(deleted.status()).toBe(204);

    const gone = await page.request.get(`/api/circuits/${circuitId}`);
    expect(gone.status()).toBe(404);
  });

  test("lists saved circuits in the gallery", async ({ page }) => {
    await page.goto("/gallery");
    await expect(page.getByRole("heading", { name: "Circuit Gallery" })).toBeVisible();
    await expect(page.getByText("ESP32 Weather Station with OLED & BME280").first()).toBeVisible();
  });
});
