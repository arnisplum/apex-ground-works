import { test, expect } from "@playwright/test";

test.describe("marketing launch site", () => {
  test("home page shows contact CTA and no Smart Quote nav", async ({ page }) => {
    await page.goto("/index.html");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toContainText("Contact");
    await expect(page.getByRole("navigation", { name: "Primary" })).not.toContainText(
      "Smart quote",
    );

    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Get in touch" }).click();
    await expect(page.locator("#contact")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tell us about your project" })).toBeVisible();
    await expect(page.locator('form[data-mailto-form]')).toBeVisible();
  });

  test("service page points visitors to contact", async ({ page }) => {
    await page.goto("/services/excavation.html");
    await expect(page.getByRole("heading", { name: "Excavation" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get in touch" }).first()).toHaveAttribute(
      "href",
      "../index.html#contact",
    );
  });
});
