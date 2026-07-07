import { test, expect } from "@playwright/test";

// F5-F smoke suite: login → send message → reaction → thread reply →
// create channel → poll → logout. Uses the seeded "Acme" org test account.
// Each test is independent-ish but runs serially (workers: 1) since they
// share real backend state (messages posted persist across tests).

const EMAIL = "anna@acme.pl";
const PASSWORD = "Haslo!Testowe123";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Hasło").fill(PASSWORD);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL("/");
}

test.describe("chatv2 smoke suite", () => {
  test("login → send a message in #general", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "# general" }).first().click();

    const composer = page.getByPlaceholder(/Napisz na/);
    const uniqueText = `smoke-test-${Date.now()}`;
    await composer.fill(uniqueText);
    await page.getByRole("button", { name: "Wyślij", exact: true }).click();

    await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 10_000 });
  });

  test("react to the last message and open its thread", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "# general" }).first().click();

    const lastRow = page.locator("main [class*=group]").last();
    await lastRow.hover();
    await lastRow.getByTitle("Dodaj reakcję").click();
    await page.getByText("🚀").click();
    await expect(lastRow.getByText("🚀")).toBeVisible();

    await lastRow.getByTitle("Odpowiedz w wątku").click();
    await expect(page.getByText("Wątek")).toBeVisible();
  });

  test("create a new public channel and see it in the sidebar", async ({ page }) => {
    await login(page);
    const channelName = `e2e-${Date.now()}`;
    await page.getByTitle("Utwórz kanał").click();
    await page.getByPlaceholder("np. marketing").fill(channelName);
    await page.getByRole("button", { name: "Utwórz kanał", exact: true }).click();

    await expect(page.getByRole("heading", { name: `# ${channelName}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `# ${channelName}` })).toBeVisible();
  });

  test("create a poll and vote on it", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "# general" }).first().click();

    await page.getByTitle("Utwórz ankietę").click();
    await page.getByPlaceholder(/Pytanie/).fill("E2E test poll?");
    const optionInputs = page.locator('input[placeholder*="Opcja"]');
    await optionInputs.nth(0).fill("Tak");
    await optionInputs.nth(1).fill("Nie");
    await page.getByRole("button", { name: "Utwórz ankietę", exact: true }).click();

    await expect(page.getByText("E2E test poll?")).toBeVisible({ timeout: 10_000 });
    await page.getByText("Tak", { exact: true }).click();
    await expect(page.getByText("100%")).toBeVisible();
  });

  test("logout returns to the login page", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Wyloguj" }).click();
    await expect(page).toHaveURL("/login");
  });
});
