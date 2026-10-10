import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import Papa from 'papaparse'

test('persists corrected import projects across a full Electron restart', async ({
  playwright,
}, testInfo) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'catalogdesk-projects-'),
  )
  const launch = () =>
    playwright._electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        CATALOGDESK_TEST_USER_DATA: directory,
      },
    })
  let application = await launch()
  try {
    let page = await application.firstWindow()
    await page.getByRole('button', { name: 'Beispieldaten laden' }).click()
    await expect(
      page.getByRole('button', { name: 'Datensatz 3 bearbeiten' }),
    ).toBeEnabled()
    await page
      .getByRole('button', { name: 'Projekt speichern', exact: true })
      .click()
    let library = page.getByRole('dialog')
    await expect(library.getByLabel('Projektname')).toBeEnabled()
    await library.getByLabel('Projektname').fill('Nordlicht Import')
    await library
      .getByRole('button', { name: 'Projekt speichern', exact: true })
      .click()
    await expect(library.getByRole('status')).toContainText(
      'SQLite gespeichert',
    )
    await library
      .getByRole('button', { name: 'Schliessen', exact: true })
      .click()
    await expect(page.locator('.project-state')).toContainText(
      'Gespeichert: Nordlicht Import',
    )
    await page.getByRole('button', { name: 'Datensatz 3 bearbeiten' }).click()
    await page
      .locator('.inspector')
      .getByLabel(/^Preis/)
      .fill('129,00')
    await page
      .getByRole('button', { name: 'Korrektur \u00fcbernehmen' })
      .click()
    await expect(
      page.getByRole('button', { name: 'Datensatz 8 bearbeiten' }),
    ).toBeEnabled()
    await page
      .getByRole('checkbox', { name: 'Datensatz 8 ausschliessen' })
      .check()
    await expect(page.locator('.project-state')).toContainText('Ungespeichert')
    await page
      .getByRole('button', { name: 'Projekt speichern', exact: true })
      .click()
    await library.getByRole('button', { name: 'Projekt aktualisieren' }).click()
    await expect(library.getByRole('status')).toContainText(
      'SQLite gespeichert',
    )
    await page.screenshot({ path: testInfo.outputPath('saved-project.png') })
    const info = await page.evaluate(() =>
      window.catalogDesktop!.databaseInfo(),
    )
    expect(info.ok).toBe(true)
    await application.close()
    if (!info.ok) throw new Error('Database info unavailable')
    expect((await readFile(info.value.path)).subarray(0, 16).toString()).toBe(
      'SQLite format 3\0',
    )

    application = await launch()
    page = await application.firstWindow()
    await page
      .getByRole('button', { name: 'Importprojekte', exact: true })
      .click()
    library = page.getByRole('dialog')
    await library
      .getByRole('button', { name: 'Projekt Nordlicht Import oeffnen' })
      .click()
    await expect(page.locator('.product-table tbody tr')).toHaveCount(12)
    await expect(page.locator('.project-state')).toContainText(
      'Gespeichert: Nordlicht Import',
    )
    await expect(
      page.getByRole('checkbox', { name: 'Datensatz 8 ausschliessen' }),
    ).toBeChecked()
    await expect(page.locator('.product-table tbody tr').nth(2)).toContainText(
      '129.00',
    )
    await page.getByRole('button', { name: 'Datensatz 3 bearbeiten' }).click()
    await expect(page.locator('.inspector').getByLabel(/^Preis/)).toHaveValue(
      '129,00',
    )
    await page.getByRole('button', { name: 'Editor schliessen' }).last().click()
    const stored = await page.evaluate(async () => {
      const list = await window.catalogDesktop!.listProjects()
      if (!list.ok) throw new Error(list.error)
      return window.catalogDesktop!.loadProject(list.value[0].id)
    })
    expect(stored.ok && stored.value.revision).toBe(2)
    expect(stored.ok && stored.value.snapshot.mapping.price).toBe(
      'Verkaufspreis',
    )
    expect(stored.ok && stored.value.snapshot.options.priceFormat).toBe('de')
    await page
      .getByRole('button', { name: 'Importprojekte', exact: true })
      .click()
    await library
      .getByRole('button', { name: 'Projekt Nordlicht Import loeschen' })
      .click()
    await library.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(
      library.getByRole('button', { name: 'Projekt Nordlicht Import oeffnen' }),
    ).toBeVisible()
    await library
      .getByRole('button', { name: 'Projekt Nordlicht Import loeschen' })
      .click()
    await library.getByRole('button', { name: 'Endgueltig loeschen' }).click()
    await expect(
      library.getByRole('button', { name: 'Projekt Nordlicht Import oeffnen' }),
    ).toHaveCount(0)
    expect(
      await page.evaluate(() =>
        window.catalogDesktop!.loadProject("' OR 1=1 --"),
      ),
    ).toMatchObject({ ok: false })
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

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
