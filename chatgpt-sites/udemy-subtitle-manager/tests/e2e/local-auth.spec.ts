import { expect, test } from "@playwright/test";

test("sign-in page sends users through ChatGPT", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Udemy Subtitle Manager" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with ChatGPT" })).toHaveAttribute("href", "/signin-with-chatgpt?return_to=%2Fdashboard");
});

test("Worker health route is available without database data", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  await expect(response).toBeOK();
  expect(await response.json()).toMatchObject({ status: "ok" });
});
