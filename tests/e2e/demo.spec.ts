import { expect, test } from "@playwright/test";
test("review, adjust, approve, restart, and separately confirm a demo event", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Demo mode", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try the sample conversation" }).click();
  await page.getByRole("button", { name: /Alex · Demo conversation/ }).click();
  await page.getByRole("button", { name: /Prepare proposal/ }).click();
  await expect(page.getByRole("heading", { name: "Coffee with Alex" })).toBeVisible();
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Coffee and a catch-up");
  await page.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coffee and a catch-up" })).toBeVisible();
  await page.getByRole("button", { name: "Create demo review" }).click();
  await expect(page.getByText("Awaiting approval", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve demo change" }).click();
  await expect(page.getByText("Awaiting calendar confirmation", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Activity/ }).click();
  await page.getByRole("button", { name: /Coffee and a catch-up/ }).click();
  await expect(page.getByText("Awaiting calendar confirmation", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  await expect(page.getByText("Demo flow complete.", { exact: true })).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/demo-confirmed.png", fullPage: true });
});
test("shows live setup and prevents live access in the browser demo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect Beeper" })).toBeDisabled();
  await expect(
    page.getByText("This browser preview supports demo mode.", { exact: false }),
  ).toBeVisible();
});
