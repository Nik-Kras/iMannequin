import { expect, test } from './fixtures';

test('first launch: install guide → welcome → models → body → Dress-up', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Keep using it in the browser' }).click();
  await expect(page.getByText('Your photos never leave this phone.')).toBeVisible();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: 'Dress-up' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add bottoms/ })).toBeVisible();
});

test('dress the mannequin and save the outfit', async ({ page }) => {
  await page.goto('./?seed#/dressup');
  await page.getByRole('button', { name: /Add bottoms/ }).click();
  await page.getByRole('button', { name: /Black jeans/ }).click();
  await expect(page.getByRole('button', { name: /Bottoms.*Black jeans/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Save outfit' }).click();
  await page.getByRole('textbox').fill('Office Monday');
  await page.getByRole('dialog').getByRole('button', { name: /Save/ }).click();
  await page.goto('./#/outfits');
  await expect(page.getByText('Office Monday')).toBeVisible();
});

test('wardrobe lists the sample clothes and finds them by description', async ({ page }) => {
  await page.goto('./?seed#/wardrobe');
  await expect(page.getByText('17 items')).toBeVisible();
  await page.getByRole('searchbox').or(page.getByPlaceholder(/Describe it/)).first().fill('red');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Red dress').first()).toBeVisible();
  await expect(page.getByText('Blue jeans')).toHaveCount(0);
});

test('plan a trip', async ({ page }) => {
  await page.goto('./?seed#/trips');
  await page.getByRole('button', { name: /New trip/ }).first().click();
  await page.getByLabel('Name').fill('Lisbon');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByText('Lisbon').first()).toBeVisible();
});

test('Ukrainian everywhere after switching language', async ({ page }) => {
  await page.goto('./?seed#/settings');
  await page.getByRole('button', { name: 'Українська' }).first().click();
  await page.goto('./#/wardrobe');
  await expect(page.getByRole('heading', { name: 'Гардероб' })).toBeVisible();
  await expect(page.getByRole('navigation').getByText('Примірка')).toBeVisible();
});
