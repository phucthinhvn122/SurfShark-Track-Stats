// apps/web/e2e/activate.spec.ts
import { test, expect } from '@playwright/test';

// End-to-end happy path: landing → activate → status success.
// Assumes API + worker running, with an unused key VPN-A9X2-K8LM seeded.

test('user can activate an unused license', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Activate your/i })).toBeVisible();

  await page.getByRole('link', { name: /Activate now/i }).click();
  await expect(page).toHaveURL(/\/activate/);

  await page.getByPlaceholder('thinh').fill('thinh');
  await page.getByPlaceholder('VPN-A9X2-K8LM').fill('VPN-A9X2-K8LM');
  await page.getByRole('button', { name: 'Activate' }).click();

  // routed to /status/:requestId, polling resolves to success
  await expect(page).toHaveURL(/\/status\//);
  await expect(page.getByText("You're protected")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/days/)).toBeVisible();
});

test('invalid key format is rejected client-side', async ({ page }) => {
  await page.goto('/activate');
  await page.getByPlaceholder('thinh').fill('thinh');
  await page.getByPlaceholder('VPN-A9X2-K8LM').fill('BAD-KEY');
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText(/Invalid format/i)).toBeVisible();
});
