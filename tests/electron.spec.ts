import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import Papa from 'papaparse'

test('restores the SQLite theme before rendering after an Electron restart', async ({
  playwright,
}, testInfo) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'catalogdesk-theme-'))
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
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'Dunkelmodus', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(
      await page.evaluate(() => window.catalogDesktop!.getTheme()),
    ).toEqual({ ok: true, value: 'dark' })
    expect(
      await page.evaluate(() =>
        window.catalogDesktop!.setTheme('invalid' as 'dark'),
      ),
    ).toMatchObject({ ok: false })
    await application.close()
    application = await launch()
    page = await application.firstWindow()
    await expect(
      page.getByRole('button', { name: 'Dunkelmodus', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: testInfo.outputPath('dark-startup.png') })
    await page.getByRole('button', { name: 'Hellmodus', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await application.close()
    application = await launch()
    page = await application.firstWindow()
    await expect(
      page.getByRole('button', { name: 'Hellmodus', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      await page.evaluate(() => window.catalogDesktop!.getTheme()),
    ).toEqual({ ok: true, value: 'light' })
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('remembers encrypted shop credentials across restarts without exposing them to the renderer', async ({
  playwright,
}, testInfo) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'catalogdesk-persistent-shop-'),
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
  const key = 'ck_' + 'c'.repeat(40)
  const secret = 'cs_' + 'd'.repeat(40)
  try {
    let page = await application.firstWindow()
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    let dialog = page.getByRole('dialog')
    await expect(
      dialog.getByLabel('Consumer Key', { exact: true }),
    ).toBeEnabled()
    await dialog.getByLabel('Consumer Key', { exact: true }).fill(key)
    await dialog.getByLabel('Consumer Secret', { exact: true }).fill(secret)
    await dialog
      .getByRole('button', { name: 'Verbindung speichern', exact: true })
      .click()
    await expect(dialog.locator('.project-notice')).toContainText(
      'sicher gespeichert',
    )
    await expect(
      dialog.getByLabel('Consumer Secret', { exact: true }),
    ).toHaveValue('')
    const file = await readFile(
      path.join(directory, 'credentials', 'shop-connection.enc'),
    )
    expect(file.includes(Buffer.from(secret))).toBe(false)
    expect(file.includes(Buffer.from(key))).toBe(false)
    await application.close()
    application = await launch()
    page = await application.firstWindow()
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('button', { name: 'Verbindung pruefen', exact: true }),
    ).toBeEnabled()
    expect(
      await page.evaluate(() => window.catalogDesktop!.savedShopConnection()),
    ).toEqual({ ok: true, value: { url: 'https://catalogdesk.local/' } })
    await expect(
      dialog.getByLabel('Consumer Secret', { exact: true }),
    ).toHaveValue('')
    await application.evaluate(({ net }) => {
      net.fetch = async (input, options) => {
        const expected =
          'Basic ' +
          Buffer.from(
            'ck_' + 'c'.repeat(40) + ':' + 'cs_' + 'd'.repeat(40),
          ).toString('base64')
        if (
          !String(input).startsWith('https://catalogdesk.local/') ||
          options?.headers?.Authorization !== expected
        )
          throw new Error('Invalid credentials or host')
        const importing =
          new URL(String(input)).searchParams.get('per_page') === '100'
        const item = importing
          ? {
              id: 1,
              type: 'simple',
              sku: 'SAVED-1',
              name: 'Saved Connection',
              regular_price: '19.90',
              description: '',
              manage_stock: false,
              stock_quantity: null,
              categories: [],
            }
          : { id: 1, sku: 'SAVED-1' }
        return new Response(JSON.stringify([item]), {
          headers: {
            'content-type': 'application/json',
            'x-wp-total': '1',
            'x-wp-totalpages': '1',
          },
        })
      }
    })
    await dialog
      .getByLabel('Shopadresse (HTTPS)')
      .fill('https://different.example')
    await expect(
      dialog.getByRole('button', { name: 'Verbindung pruefen', exact: true }),
    ).toBeDisabled()
    await dialog
      .getByLabel('Shopadresse (HTTPS)')
      .fill('https://catalogdesk.local/')
    await dialog
      .getByRole('button', { name: 'Verbindung pruefen', exact: true })
      .click()
    await expect(dialog.locator('.shop-result')).toContainText('1 Produkte')
    await page.screenshot({ path: testInfo.outputPath('persistent-shop.png') })
    await dialog
      .getByRole('button', { name: 'Produkte importieren', exact: true })
      .click()
    await expect(page.locator('.product-table tbody tr').first()).toContainText(
      'SAVED-1',
    )
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    await dialog
      .getByRole('button', {
        name: 'Gespeicherte Verbindung loeschen',
        exact: true,
      })
      .click()
    await dialog
      .getByRole('button', {
        name: 'Verbindung endgueltig loeschen',
        exact: true,
      })
      .click()
    await expect(
      dialog.getByRole('button', { name: 'Verbindung pruefen', exact: true }),
    ).toBeDisabled()
    expect(
      await page.evaluate(() => window.catalogDesktop!.savedShopConnection()),
    ).toEqual({ ok: true, value: null })
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('imports all WooCommerce pages with decimal prices and saves the catalog in SQLite', async ({
  playwright,
}, testInfo) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'catalogdesk-shop-import-'),
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
    await application.evaluate(({ net }) => {
      const originalFetch = net.fetch.bind(net)
      net.fetch = async (input, options) => {
        const url = new URL(String(input))
        if (url.origin !== 'https://catalogdesk.local')
          return originalFetch(input, options)
        if (
          options?.method !== 'GET' ||
          options.redirect !== 'error' ||
          url.searchParams.get('per_page') !== '100' ||
          url.searchParams.get('status') !== 'any'
        )
          throw new Error('Unexpected request')
        const pageNumber = Number(url.searchParams.get('page'))
        const data = Array.from(
          { length: pageNumber === 1 ? 100 : 2 },
          (_, index) => {
            const id = (pageNumber - 1) * 100 + index + 1
            if (id === 2) return { id, type: 'variable' }
            return {
              id,
              type: 'simple',
              sku: `SHOP-${id}`,
              name: `Shop Product ${id}`,
              regular_price: '12.50',
              description: '<p>Beschreibung</p>',
              manage_stock: true,
              stock_quantity: 4,
              categories: [{ id: 1, name: 'Papeterie' }],
            }
          },
        )
        return new Response(JSON.stringify(data), {
          headers: {
            'content-type': 'application/json',
            'x-wp-total': '102',
            'x-wp-totalpages': '2',
          },
        })
      }
    })
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    let dialog = page.getByRole('dialog')
    await dialog
      .getByLabel('Consumer Key', { exact: true })
      .fill('ck_' + 'a'.repeat(40))
    await dialog
      .getByLabel('Consumer Secret', { exact: true })
      .fill('cs_' + 'b'.repeat(40))
    await dialog
      .getByRole('button', { name: 'Produkte importieren', exact: true })
      .click()
    await expect(
      page.locator('.stats').getByRole('button', { name: /Exportbereit/ }),
    ).toContainText('101')
    await expect(page.locator('.shop-import-notice')).toContainText(
      'variable (1)',
    )
    await expect(page.locator('.product-table tbody tr').first()).toContainText(
      '12.50',
    )
    await expect(page.locator('.product-table tbody tr').first()).toContainText(
      'SHOP-1',
    )
    await page.screenshot({
      path: testInfo.outputPath('woocommerce-import.png'),
    })
    await page
      .getByRole('button', { name: 'Projekt speichern', exact: true })
      .click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Projektname')).toBeEnabled()
    await dialog.getByLabel('Projektname').fill('Shop Snapshot')
    await dialog
      .getByRole('button', { name: 'Projekt speichern', exact: true })
      .click()
    await expect(dialog.getByRole('status')).toContainText('SQLite gespeichert')
    await page.reload()
    await page
      .getByRole('button', { name: 'Importprojekte', exact: true })
      .click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Projekt Shop Snapshot oeffnen' })
      .click()
    await expect(
      page.locator('.stats').getByRole('button', { name: /Exportbereit/ }),
    ).toContainText('101')
    await page
      .getByRole('button', { name: 'Spaltenzuordnung', exact: true })
      .click()
    await expect(page.getByLabel('Zahlenformat der Quelle')).toHaveValue('en')
    expect(
      await page.evaluate(() => JSON.stringify({ ...localStorage })),
    ).not.toContain('cs_' + 'b'.repeat(40))
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('keeps the old catalog on failed, cancelled and declined shop imports', async ({
  playwright,
}) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'catalogdesk-shop-errors-'),
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
    await page.getByRole('button', { name: 'Beispieldaten laden' }).click()
    await expect(page.locator('.product-table tbody tr')).toHaveCount(12)
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel('Consumer Key', { exact: true })
      .fill('ck_' + 'a'.repeat(40))
    await dialog
      .getByLabel('Consumer Secret', { exact: true })
      .fill('cs_' + 'b'.repeat(40))
    await application.evaluate(({ net }) => {
      net.fetch = async () =>
        new Response('private server error', { status: 401 })
    })
    await dialog
      .getByRole('button', { name: 'Produkte importieren', exact: true })
      .click()
    await expect(dialog.getByRole('alert')).toContainText('Zugriff verweigert')
    await expect(page.locator('.product-table tbody tr')).toHaveCount(12)
    await application.evaluate(({ net }) => {
      net.fetch = (_url, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        )
    })
    await dialog
      .getByRole('button', { name: 'Produkte importieren', exact: true })
      .click()
    await dialog.getByRole('button', { name: 'Import abbrechen' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Import abgebrochen')
    await application.evaluate(({ net }) => {
      net.fetch = async () =>
        new Response(
          JSON.stringify([
            {
              id: 1,
              type: 'simple',
              sku: 'SHOP-1',
              name: 'Shop Product',
              regular_price: '12.50',
              description: '',
              manage_stock: false,
              stock_quantity: null,
              categories: [],
            },
          ]),
          {
            headers: {
              'content-type': 'application/json',
              'x-wp-total': '1',
              'x-wp-totalpages': '1',
            },
          },
        )
    })
    await dialog
      .getByRole('button', { name: 'Produkte importieren', exact: true })
      .click()
    await expect(
      dialog.getByRole('heading', { name: 'Import ersetzen?' }),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click()
    await expect(page.locator('.product-table tbody tr')).toHaveCount(12)
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    await expect(
      dialog.getByLabel('Consumer Secret', { exact: true }),
    ).toHaveValue('')
    await dialog
      .getByLabel('Consumer Key', { exact: true })
      .fill('ck_' + 'a'.repeat(40))
    await dialog
      .getByLabel('Consumer Secret', { exact: true })
      .fill('cs_' + 'b'.repeat(40))
    await dialog
      .getByRole('button', { name: 'Produkte importieren', exact: true })
      .click()
    await dialog
      .getByRole('button', { name: 'Shopimport uebernehmen', exact: true })
      .click()
    await expect(page.locator('.product-table tbody tr')).toHaveCount(1)
    await expect(page.locator('.product-table tbody tr').first()).toContainText(
      'SHOP-1',
    )
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

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

test('checks a read-only shop connection through native IPC and keeps keys out of the renderer', async ({
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
    await expect(dialog.locator('.shop-result')).toContainText('20 Produkte')
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
    await expect(dialog.locator('.shop-result')).toContainText('20 Produkte')
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

test('replaces previously saved read-only keys after a successful test and reuses the new keys for import', async ({
  playwright,
}) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'catalogdesk-replace-shop-'),
  )
  const application = await playwright._electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      CATALOGDESK_TEST_USER_DATA: directory,
    },
  })
  const previous = {
    url: 'https://catalogdesk.local',
    consumerKey: 'ck_' + 'a'.repeat(40),
    consumerSecret: 'cs_' + 'b'.repeat(40),
  }
  const replacement = {
    url: 'https://catalogdesk.local',
    consumerKey: 'ck_' + 'c'.repeat(40),
    consumerSecret: 'cs_' + 'd'.repeat(40),
  }
  try {
    const page = await application.firstWindow()
    await expect
      .poll(() => page.evaluate(() => window.catalogDesktop!.databaseInfo()))
      .toMatchObject({ ok: true })
    expect(
      await page.evaluate(
        (credentials) => window.catalogDesktop!.saveShopConnection(credentials),
        previous,
      ),
    ).toMatchObject({ ok: true })
    await application.evaluate(({ net }, expected) => {
      const original = net.fetch.bind(net)
      const expectedHeader =
        'Basic ' +
        Buffer.from(
          expected.consumerKey + ':' + expected.consumerSecret,
        ).toString('base64')
      net.fetch = async (input, options) => {
        if (!String(input).startsWith('https://catalogdesk.local/wp-json/'))
          return original(input, options)
        if (options.headers.Authorization !== expectedHeader)
          return new Response('Unauthorized', { status: 401 })
        const url = new URL(String(input))
        if (url.searchParams.get('per_page') === '1')
          return new Response(JSON.stringify([{ id: 1, sku: 'SHOP-1' }]), {
            headers: { 'content-type': 'application/json', 'x-wp-total': '1' },
          })
        return new Response(
          JSON.stringify([
            {
              id: 1,
              type: 'simple',
              sku: 'SHOP-1',
              name: 'Notebook',
              regular_price: '12.50',
              description: '',
              manage_stock: false,
              stock_quantity: null,
              categories: [],
            },
          ]),
          {
            headers: {
              'content-type': 'application/json',
              'x-wp-total': '1',
              'x-wp-totalpages': '1',
            },
          },
        )
      }
    }, replacement)
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByLabel('Consumer Key', { exact: true }),
    ).toHaveAttribute('placeholder', 'Sicher gespeichert')
    await dialog
      .getByLabel('Consumer Key', { exact: true })
      .fill(replacement.consumerKey)
    await dialog
      .getByLabel('Consumer Secret', { exact: true })
      .fill(replacement.consumerSecret)
    await dialog
      .getByRole('button', { name: 'Verbindung pruefen', exact: true })
      .click()
    await expect(dialog.locator('.project-notice')).toContainText(
      'sicher gespeichert',
    )
    await expect(
      dialog.getByLabel('Consumer Secret', { exact: true }),
    ).toHaveValue('')
    expect(
      await page.evaluate(() => window.catalogDesktop!.savedShopConnection()),
    ).toEqual({ ok: true, value: { url: 'https://catalogdesk.local/' } })
    await dialog
      .getByRole('button', { name: 'Schliessen', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Shopverbindung', exact: true })
      .click()
    await expect(
      dialog.getByRole('button', { name: 'Produkte importieren', exact: true }),
    ).toBeEnabled()
    await expect(
      dialog.getByLabel('Consumer Key', { exact: true }),
    ).toHaveValue('')
    await dialog
      .getByRole('button', { name: 'Produkte importieren', exact: true })
      .click()
    await expect(page.locator('.product-table tbody tr').first()).toContainText(
      'SHOP-1',
    )
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
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
