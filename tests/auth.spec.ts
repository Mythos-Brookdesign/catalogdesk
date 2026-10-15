import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('bootstraps an administrator, manages a reader and enforces role restrictions', async ({
  playwright,
}) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'catalogdesk-auth-e2e-'),
  )
  const application = await playwright._electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      CATALOGDESK_TEST_USER_DATA: directory,
    },
  })
  try {
    const page = await application.firstWindow()
    await expect(
      page.getByRole('heading', { name: 'Administrator einrichten' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Produktkatalog', exact: true }),
    ).toHaveCount(0)
    await page.getByLabel('Benutzername').fill('Shop-Admin')
    await page.getByLabel('Anzeigename').fill('Shop Administrator')
    await page
      .locator('input[type="password"]')
      .nth(0)
      .fill('First-Secure-Password-2026!')
    await page
      .locator('input[type="password"]')
      .nth(1)
      .fill('First-Secure-Password-2026!')
    await page.getByRole('button', { name: 'Administrator einrichten' }).click()
    await expect(
      page.getByRole('heading', { name: 'Produktkatalog', exact: true }),
    ).toBeVisible()
    await expect(page.locator('.account-tag')).toContainText('Administrator')
    await page.getByRole('button', { name: 'Benutzerkonten verwalten' }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('Benutzername').fill('viewer')
    await dialog.getByLabel('Anzeigename').fill('Katalog Leser')
    await dialog
      .locator('input[type="password"]')
      .fill('Reader-Long-Password-2026!')
    await dialog.getByLabel('Rolle').selectOption('reader')
    await dialog.getByRole('button', { name: 'Benutzer anlegen' }).click()
    await expect(dialog.locator('.user-list')).toContainText('viewer')
    await dialog.getByRole('button', { name: 'Schliessen' }).click()
    await page.getByRole('button', { name: 'Abmelden' }).click()
    await expect(
      page.getByRole('heading', { name: 'Anmelden', exact: true }),
    ).toBeVisible()
    await page.getByLabel('Benutzername').fill('viewer')
    await page
      .locator('input[type="password"]')
      .fill('Reader-Long-Password-2026!')
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click()
    await expect(page.locator('.account-tag')).toContainText('Leser')
    await expect(
      page.getByRole('button', { name: 'Benutzerkonten verwalten' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Shopverbindung' }),
    ).toBeDisabled()
    await page.getByRole('button', { name: 'Beispieldaten laden' }).click()
    await expect(
      page.getByRole('button', { name: 'Datensatz 3 bearbeiten' }),
    ).toBeDisabled()
    expect(
      await page.evaluate(() =>
        window.catalogDesktop!.saveShopConnection({
          url: 'https://example.com',
          consumerKey: 'ck_' + 'a'.repeat(40),
          consumerSecret: 'cs_' + 'b'.repeat(40),
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('Benutzerrolle'),
    })
    expect(
      await page.evaluate(() => window.catalogDesktop!.discoverShopRest(null)),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('Benutzerrolle'),
    })
    expect(
      await page.evaluate(() =>
        window.catalogDesktop!.setUserActive({
          id: '00000000-0000-4000-8000-000000000000',
          active: false,
        }),
      ),
    ).toMatchObject({ ok: false })
    expect(
      await page.evaluate(() => window.catalogDesktop!.backupDatabase()),
    ).toMatchObject({ ok: false })
    expect(
      await page.evaluate(() => window.catalogDesktop!.restoreDatabase()),
    ).toMatchObject({ ok: false })
    expect(
      await page.evaluate(() =>
        window.catalogDesktop!.saveShopProductTaxonomies({
          url: 'https://example.com/',
          productId: 1,
          taxonomies: { categories: [], tags: [], brands: [] },
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('Benutzerrolle'),
    })
    await page.getByRole('button', { name: 'Abmelden' }).click()
    await page.getByLabel('Benutzername').fill('SHOP-ADMIN')
    await page
      .locator('input[type="password"]')
      .fill('First-Secure-Password-2026!')
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click()
    await expect(page.locator('.account-tag')).toContainText('Administrator')
    await page.getByRole('button', { name: 'Benutzerkonten verwalten' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Benutzername').fill('editor')
    await dialog.getByLabel('Anzeigename').fill('Katalog Bearbeiter')
    await dialog
      .locator('input[type="password"]')
      .fill('Editor-Long-Password-2026!')
    await dialog.getByLabel('Rolle').selectOption('editor')
    await dialog.getByRole('button', { name: 'Benutzer anlegen' }).click()
    await expect(dialog.locator('.user-list')).toContainText('editor')
    await dialog.getByRole('button', { name: 'Schliessen' }).click()
    await page.getByRole('button', { name: 'Abmelden' }).click()
    await page.getByLabel('Benutzername').fill('editor')
    await page
      .locator('input[type="password"]')
      .fill('Editor-Long-Password-2026!')
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click()
    await expect(page.locator('.account-tag')).toContainText('Bearbeiter')
    const preview = await page.evaluate(() =>
      window.catalogDesktop!.previewTransfer({
        products: [{ sku: 'A', price: '12.50', stock: '4' }],
        fields: ['price'],
      }),
    )
    expect(preview).toMatchObject({ ok: false })
    expect(preview.ok ? '' : preview.error).not.toContain('Benutzerrolle')
    expect(
      await page.evaluate(() =>
        window.catalogDesktop!.executeTransfer({
          planId: 'missing',
          selected: ['A'],
          confirmed: true,
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('Benutzerrolle'),
    })
    expect(
      await page.evaluate(() =>
        window.catalogDesktop!.setUserActive({
          id: '00000000-0000-4000-8000-000000000000',
          active: false,
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('Benutzerrolle'),
    })
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
