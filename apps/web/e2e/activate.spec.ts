// apps/web/e2e/activate.spec.ts
import { test, expect } from '@playwright/test';

// End-to-end happy path: landing -> login -> status success.
// Assumes API + worker running, with an unused key VPN-A9X2-K8LM seeded.
test('user can activate with a valid device code and license key', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Activate your/i })).toBeVisible();

  await page.getByRole('link', { name: /Login with code/i }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByPlaceholder('ABCDEF').fill('ABC123');
  await page.getByPlaceholder('VPN-A9X2-K8LM').fill('VPN-A9X2-K8LM');
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page).toHaveURL(/\/status\//);
  await expect(page.getByText("You're protected")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Expires/i)).toBeVisible();
});

test('invalid key format is rejected client-side', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('ABCDEF').fill('ABC123');
  await page.getByPlaceholder('VPN-A9X2-K8LM').fill('BAD-KEY');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText(/Invalid format/i)).toBeVisible();
});
