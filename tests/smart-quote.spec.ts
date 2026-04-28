import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

function loadRootEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env", "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [
            line.slice(0, index).trim(),
            line.slice(index + 1).trim().replace(/^["']|["']$/g, ""),
          ];
        }),
    );
  } catch {
    return {};
  }
}

test.afterEach(async ({ request }) => {
  const env = loadRootEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  await request.delete(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/quote_requests?customer_email=eq.playwright%40example.com`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal",
      },
    },
  );
});

test("Smart Quote saves details and shows AI preview", async ({ page }) => {
  await page.goto("/quote.html");

  await page.getByLabel("Name").fill("Playwright Test");
  await page.getByLabel("Project address").fill("123 Browser Test Road");
  await page.getByLabel("Phone number").fill("555-0199");
  await page.getByLabel("Email").fill("playwright@example.com");
  await page
    .getByLabel("Describe the work")
    .fill(
      "Browser test quote for drainage work beside a foundation wall after heavy rain.",
    );
  await page.setInputFiles("#q-attachments", {
    name: "WhatsApp Image test.png",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    ),
  });

  await page.getByRole("button", { name: "Generate project summary" }).click();

  await expect(page).toHaveURL(/quote-preview\.html/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Project summary" })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText("Request received")).toBeVisible();
  await expect(page.locator("#quote-document-summary")).toContainText("Browser test quote");
  await expect(page.locator("#quote-document-gallery img")).toBeVisible();
});
