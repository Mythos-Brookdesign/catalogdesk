import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import Papa from 'papaparse'

test('disables local SQLite project persistence in the browser preview', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Importprojekte', exact: true })
    .click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    'nur in der Electron-App',
  )
  await page.screenshot({ path: testInfo.outputPath('projects-preview.png') })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Beispieldaten laden' }).click()
  await expect(
    page.getByRole('button', { name: 'Projekt speichern', exact: true }),
  ).toBeDisabled()
})

test('keeps WooCommerce credentials out of the browser preview', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Shopverbindung', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Shopadresse (HTTPS)')).toHaveValue(
    'https://catalogdesk.local',
  )
  await expect(
    dialog.getByLabel('Consumer Key', { exact: true }),
  ).toBeDisabled()
  await expect(
    dialog.getByLabel('Consumer Secret', { exact: true }),
  ).toBeDisabled()
  await expect(
    dialog.getByRole('button', { name: 'Verbindung pruefen', exact: true }),
  ).toBeDisabled()
  await expect(
    dialog.getByRole('button', { name: 'Produkte importieren', exact: true }),
  ).toBeDisabled()
  await expect(dialog.getByRole('status')).toContainText(
    'nur in der Electron-App',
  )
  await page.screenshot({ path: testInfo.outputPath('shop-connection.png') })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('reviews a supplier catalog and exports corrected draft products', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.screenshot({ path: testInfo.outputPath('empty.png') })
  await page.getByRole('button', { name: 'Beispieldaten laden' }).click()
  await expect(page.locator('.product-table tbody tr')).toHaveCount(12)
  await expect(
    page.locator('.stats').getByRole('button', { name: /Mit Fehlern/ }),
  ).toContainText('5')
  await expect(
    page.getByRole('button', { name: 'Datensatz 3 bearbeiten' }),
  ).toBeEnabled()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: testInfo.outputPath('catalog.png') })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  expect(
    await page
      .locator('.product-link img')
      .evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'WooCommerce-CSV exportieren' }),
  ).toBeDisabled()
  await page
    .getByRole('button', { name: /Produktkatalog/, exact: false })
    .first()
    .click()
  await page
    .locator('.segmented')
    .getByRole('button', { name: /^Fehler/ })
    .click()
  await expect(page.locator('.product-table tbody tr')).toHaveCount(5)

  for (const [index, label, value] of [
    [3, 'Preis', '129,00'],
    [5, 'Bestand', '2'],
    [9, 'Artikelnummer', 'NL-1009'],
  ] as const) {
    await page
      .getByRole('button', { name: `Datensatz ${index} bearbeiten` })
      .click()
    await page
      .locator('.inspector')
      .getByLabel(new RegExp(`^${label}`))
      .fill(value)
    await page.screenshot({ path: testInfo.outputPath(`editor-${index}.png`) })
    await page
      .getByRole('button', { name: 'Korrektur \u00fcbernehmen' })
      .click()
    await expect(
      page.getByRole('button', { name: `Datensatz ${index} bearbeiten` }),
    ).toHaveCount(0)
  }
  await page
    .getByRole('checkbox', { name: 'Datensatz 8 ausschliessen' })
    .click()
  await expect(
    page.locator('.stats').getByRole('button', { name: /Mit Fehlern/ }),
  ).toContainText('0')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'WooCommerce-CSV exportieren' }),
  ).toBeEnabled()
  const downloading = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'WooCommerce-CSV exportieren' })
    .click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('catalogdesk-woocommerce.csv')
  const output = Papa.parse<Record<string, string>>(
    await readFile((await download.path())!, 'utf8'),
    { header: true },
  ).data
  expect(output).toHaveLength(11)
  expect(output.every((row) => row.Published === '-1')).toBe(true)
  expect(output.find((row) => row.SKU === 'NL-1003')?.['Regular price']).toBe(
    '129.00',
  )
  await page.screenshot({ path: testInfo.outputPath('export.png') })
  expect(errors).toEqual([])
})

test('saves and reuses a mapping profile after reload', async ({ page }) => {
  await page.goto('/')
  const file = {
    name: 'supplier.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Kode;Titel;VK\n001;Notebook;12,50'),
  }
  await page.getByLabel('CSV-Datei auswaehlen').setInputFiles(file)
  await expect(page.locator('.product-table tbody tr')).toHaveCount(1)
  await page
    .getByRole('button', { name: 'Spaltenzuordnung', exact: true })
    .click()
  await expect(page.getByLabel('Quellspalte fuer Artikelnummer')).toBeEnabled()
  await page.getByLabel('Quellspalte fuer Artikelnummer').selectOption('Kode')
  await expect(page.getByLabel('Quellspalte fuer Produktname')).toBeEnabled()
  await page.getByLabel('Quellspalte fuer Produktname').selectOption('Titel')
  await expect(
    page.locator('.stats').getByRole('button', { name: /Exportbereit/ }),
  ).toContainText('1')
  await page
    .getByRole('button', { name: 'Profil speichern', exact: true })
    .click()
  await page.getByLabel('Profilname').fill('Lieferant A')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Profil speichern', exact: true })
    .click()
  await page.reload()
  await page.getByLabel('CSV-Datei auswaehlen').setInputFiles(file)
  await expect(page.locator('.product-table tbody tr')).toHaveCount(1)
  await page
    .getByRole('button', { name: 'Spaltenzuordnung', exact: true })
    .click()
  await expect(page.getByLabel('Zuordnungsprofil')).toBeEnabled()
  await page
    .getByLabel('Zuordnungsprofil')
    .selectOption({ label: 'Lieferant A' })
  await expect(
    page.locator('.stats').getByRole('button', { name: /Exportbereit/ }),
  ).toContainText('1')
  await page
    .getByRole('button', { name: 'Profil speichern', exact: true })
    .click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('rejects malformed imports without replacing the current catalog', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Beispieldaten laden' }).click()
  await expect(page.locator('.product-table tbody tr')).toHaveCount(12)
  await page.getByLabel('CSV-Datei auswaehlen').setInputFiles({
    name: 'broken.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU,SKU\n1,2'),
  })
  await expect(page.getByRole('alert')).toContainText('eindeutig')
  await expect(page.locator('.product-table tbody tr')).toHaveCount(12)
})
