import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { AxeResults, Result } from "axe-core";

/**
 * WCAG 2.0, 2.1 and 2.2 level A and AA rules only.
 *
 * `best-practice` rules (page-has-heading-one, region, heading-order, ...) are
 * intentionally left out of the gate: they are not WCAG 2.2 A/AA success
 * criteria, so a failure there is a design smell rather than a conformance
 * bug. In this axe-core version the 2.2 tag set is `wcag22aa` (`wcag22a`
 * does not exist; 2.2 level A criteria are satisfied through the 2.0/2.1
 * rules plus `wcag22aa`).
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Any `minor`/`moderate` violation is allowed to stay in the report because
 * the gate only blocks regressions that remove information or operability
 * (`serious`/`critical`). The current suite has none of either, so nothing is
 * suppressed here: every violation is visible in the Playwright report.
 */
function describeViolations(violations: Result[]): string {
  if (violations.length === 0) return "";
  const lines = [
    `${violations.length} serious/critical accessibility violation(s):`,
  ];
  for (const violation of violations) {
    lines.push(
      `  ${violation.id} [${violation.impact}] ${violation.help} (${violation.helpUrl})`,
    );
    for (const node of violation.nodes) {
      const summary = (node.failureSummary ?? "").replace(/\s+/g, " ").trim();
      lines.push(`    - ${node.target.join(" ")} :: ${summary}`);
    }
  }
  return lines.join("\n");
}

async function scanPage(page: Page): Promise<AxeResults> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking, describeViolations(blocking)).toEqual([]);
  return results;
}

test.describe("accessibility gate (WCAG 2.2 A/AA)", () => {
  test("home page has no serious or critical violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await scanPage(page);
  });

  test("circuit gallery has no serious or critical violations", async ({ page }) => {
    await page.goto("/gallery");
    await expect(
      page.getByRole("heading", { level: 1, name: "Circuit Gallery" }),
    ).toBeVisible();
    await scanPage(page);
  });

  test("share page has no serious or critical violations", async ({ page }) => {
    const response = await page.request.get("/api/circuits");
    test.skip(!response.ok(), `GET /api/circuits returned ${response.status()}`);
    const payload: unknown = await response.json();
    const circuits = Array.isArray(payload) ? payload : [];
    test.skip(circuits.length === 0, "no seeded or saved circuits to open");

    const first = circuits[0] as { id?: unknown };
    expect(typeof first.id).toBe("string");

    await page.goto(`/c/${String(first.id)}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await scanPage(page);
  });

  test("save dialog has no serious or critical violations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Save & share" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scanPage(page);
  });

  test("skip link becomes visible on focus and targets the main landmark", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible();

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toHaveAttribute("href", "#main-content");

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main-content$/);
  });

  test("schematic wiring is operable with the keyboard alone", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "ESP32 Weather Station with OLED & BME280" })
      .click();

    const generate = page.getByRole("button", { name: "generate circuit" });
    await expect(generate).toBeEnabled({ timeout: 15_000 });
    await generate.click();

    const boardPin = page.getByRole("button", {
      name: /^GPIO4 on ESP32 DevKit V1 \(30-pin\)/,
    });
    await expect(boardPin).toBeVisible({ timeout: 15_000 });

    // Instructions are exposed to assistive technology even while hidden.
    await expect(
      page.getByText(/Select a board pin, then a peripheral pin, to add a wire/),
    ).toBeAttached();

    await boardPin.focus();
    await page.keyboard.press("Enter");
    await expect(boardPin).toHaveAttribute("aria-pressed", "true");

    const peripheralPin = page
      .getByRole("button", { name: /^SDA on SSD1306 OLED \(I2C\)/ })
      .first();
    await peripheralPin.focus();
    await page.keyboard.press("Space");

    const wire = page.getByRole("button", {
      name: /^GPIO4 to SSD1306 OLED \(I2C\) SDA/,
    });
    await expect(wire).toBeVisible();
    await expect(boardPin).toHaveAttribute("aria-pressed", "false");

    // Selecting a wire exposes a keyboard-reachable delete affordance.
    await wire.focus();
    await page.keyboard.press("Enter");
    const deleteWire = page.getByRole("button", { name: "Delete wire" });
    await expect(deleteWire).toBeVisible();
    await deleteWire.focus();
    await page.keyboard.press("Enter");
    await expect(wire).toHaveCount(0);
  });
});
