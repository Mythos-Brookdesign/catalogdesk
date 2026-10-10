import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import Papa from 'papaparse'

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
