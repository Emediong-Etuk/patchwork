import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.fill("#name", "Erin Endtoend");
  await page.fill("#email", email);
  await page.fill("#accessCode", "e2e-access");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/dashboard/);
}

test("rejects a wrong access code", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#name", "Mallory");
  await page.fill("#email", "mallory@example.com");
  await page.fill("#accessCode", "nope");
  await page.click("button[type=submit]");
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect access code" })).toBeVisible();
});

test("APIs require a session", async ({ request }) => {
  expect((await request.get("/api/incidents")).status()).toBe(401);
  expect((await request.post("/api/incidents", { data: {} })).status()).toBe(401);
});

test("report a bug, watch the workflow live, and talk to the room", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, `e2e-${Date.now()}@example.com`);

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Switch simulator" })).toBeVisible();
  await expect(page.getByText("AI provider not configured")).toBeVisible();

  // Validation on the report form.
  await page.getByRole("link", { name: "Report a Bug" }).first().click();
  await expect(page).toHaveURL(/\/incidents\/new/);
  await page.getByRole("button", { name: "Start Investigation" }).click();
  await expect(page.getByText("Title must be at least 5 characters")).toBeVisible();

  await page.getByRole("button", { name: "Use demo scenario" }).click();
  await page.getByRole("button", { name: "Start Investigation" }).click();
  await expect(page).toHaveURL(/\/incidents\/c[a-z0-9]+$/);

  // Without an AI key the run must stop honestly, after the Switch room and branch were created.
  await expect(page.getByText("The workflow stopped")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/AI provider unavailable: ANTHROPIC_API_KEY is not set/).first()).toBeVisible();
  await expect(page.getByText(/Working branch patchwork\/incident-\d+-fix created/)).toBeVisible();
  await expect(page.getByText("Simulated locally")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByText("Approval controls unlock when QA has verified a fix")).toBeVisible();

  // Collaboration room: the incident report was delivered to Triage through the room.
  await page.getByRole("link", { name: "Collaboration room" }).click();
  await expect(page.getByRole("heading", { name: "Collaboration room" })).toBeVisible();
  await expect(page.getByText("Please triage.")).toBeVisible();
  await expect(page.getByText(/Delivered through Switch simulator/).first()).toBeVisible();

  // A human message appears without reloading; the agent's inability to answer is reported live.
  await page.getByLabel("Message the team").fill("Explain why this fix is necessary.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log").getByText("Explain why this fix is necessary.")).toBeVisible();
  await expect(page.getByText(/PATCHWORK_Triage could not reply: ANTHROPIC_API_KEY is not set/)).toBeVisible({ timeout: 15_000 });

  for (const [path, heading] of [["/agents", "Agents"], ["/repositories", "Repositories"], ["/activity", "Activity"], ["/settings", "Settings"], ["/incidents", "Incidents"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (path === "/agents") for (const a of ["Triage", "Investigator", "Fixer", "QA"]) await expect(page.getByText(`PATCHWORK_${a}`, { exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
