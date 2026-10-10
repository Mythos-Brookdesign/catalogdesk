import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import Papa from 'papaparse'

test('checks a read-only shop connection through native IPC without storing keys', async ({
  playwright,
}, testInfo) => {
  const application = await playwright._electron.launch({
    args: ['.'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })
  try {
    const page = await application.firstWindow()
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    const key = 'ck_' + 'a'.repeat(40)
    const secret = 'cs_' + 'b'.repeat(40)
    await page.screenshot({ path: testInfo.outputPath('shop-form.png') })
    const fill = async () => {
      await dialog.getByLabel('Consumer Key', { exact: true }).fill(key)
      await dialog.getByLabel('Consumer Secret', { exact: true }).fill(secret)
    }
    await expect(
      dialog.getByLabel('Consumer Secret', { exact: true }),
    ).toHaveAttribute('type', 'password')
    await application.evaluate(({ net }) => {
      net.fetch = async (url, options) => {
        if (
          url !==
            'https://catalogdesk.local/wp-json/wc/v3/products?per_page=1&page=1&status=any&_fields=id%2Csku' ||
          options?.method !== 'GET' ||
          options?.redirect !== 'error' ||
          options?.credentials !== 'omit'
        )
          throw new Error('Unexpected request')
        return new Response(JSON.stringify([{ id: 1, sku: 'NL-1001' }]), {
          headers: { 'content-type': 'application/json', 'x-wp-total': '20' },
        })
      }
    })
    await fill()
    await dialog
      .getByRole('button', { name: 'Verbindung pruefen', exact: true })
      .click()
    await expect(dialog.getByRole('status')).toContainText('20 Produkte')
    await expect(
      dialog.getByLabel('Consumer Key', { exact: true }),
    ).toHaveValue('')
    await expect(
      dialog.getByLabel('Consumer Secret', { exact: true }),
    ).toHaveValue('')
    expect(
      await page.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }),
      ),
    ).not.toContain(secret)
    await page.screenshot({ path: testInfo.outputPath('shop-checked.png') })
    await dialog
      .getByRole('button', { name: 'Schliessen', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    await expect(dialog.getByRole('status')).toContainText('20 Produkte')
    await expect(
      dialog.getByLabel('Consumer Secret', { exact: true }),
    ).toHaveValue('')
    await application.evaluate(({ net }) => {
      net.fetch = async () =>
        new Response('Do not forward server errors', { status: 401 })
    })
    await fill()
    await expect(dialog.getByRole('status')).toHaveCount(0)
    await dialog
      .getByRole('button', { name: 'Verbindung pruefen', exact: true })
      .click()
    await expect(dialog.getByRole('alert')).toContainText('Zugriff verweigert')
    await dialog
      .getByRole('button', { name: 'Schliessen', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    await expect(
      dialog.getByLabel('Consumer Secret', { exact: true }),
    ).toHaveValue('')
  } finally {
    await application.close()
  }
})

test('runs the isolated production desktop app and opens and saves local CSV files', async ({
  playwright,
}, testInfo) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'catalogdesk-test-'))
  const source = path.join(directory, 'supplier.csv')
  const output = path.join(directory, 'products.csv')
  await writeFile(source, 'SKU;Name;Preis;Bestand\n001;Notebook;12,50;4')
  const application = await playwright._electron.launch({
    args: ['.'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })
  try {
    const page = await application.firstWindow()
    await expect(
      page.getByRole('heading', { name: 'Produktkatalog', exact: true }),
    ).toBeVisible()
    expect(page.url()).toBe('catalog://app/index.html')
    expect(
      await page.evaluate(() => typeof window.catalogDesktop?.openCsv),
    ).toBe('function')
    expect(
      await page.evaluate(
        () => typeof (window as unknown as { require?: unknown }).require,
      ),
    ).toBe('undefined')
    const preferences = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    )
    expect(preferences.contextIsolation).toBe(true)
    expect(preferences.sandbox).toBe(true)
    expect(preferences.nodeIntegration).toBe(false)
    await application.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      })
    }, source)
    await application.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, output)
    await page.getByRole('button', { name: 'Datei oeffnen' }).first().click()
    await expect(
      page.locator('.stats').getByRole('button', { name: /Exportbereit/ }),
    ).toContainText('1')
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await page
      .getByRole('button', { name: 'WooCommerce-CSV exportieren' })
      .click()
    await expect(page.getByRole('status')).toContainText(
      'WooCommerce-CSV gespeichert.',
    )
    const data = Papa.parse<Record<string, string>>(
      await readFile(output, 'utf8'),
      { header: true },
    ).data
    expect(data[0].SKU).toBe('001')
    expect(data[0]['Regular price']).toBe('12.50')
    expect(data[0].Published).toBe('-1')
    await page.screenshot({ path: testInfo.outputPath('electron.png') })
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
