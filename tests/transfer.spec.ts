import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchAuthenticatedElectron } from './auth-helpers'

test('records conflicts and ambiguous writes and only rechecks them with GET', async ({
  playwright,
}) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'catalogdesk-transfer-errors-'),
  )
  const application = await launchAuthenticatedElectron(playwright, {
    args: ['.'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      CATALOGDESK_TEST_USER_DATA: directory,
    },
  })
  try {
    const page = await application.firstWindow()
    await page
      .getByRole('heading', { name: 'Produktkatalog', exact: true })
      .waitFor()
    await page.evaluate(() =>
      window.catalogDesktop!.saveShopConnection({
        url: 'https://example.com/',
        consumerKey: 'ck_' + 'a'.repeat(40),
        consumerSecret: 'cs_' + 'b'.repeat(40),
      }),
    )
    await application.evaluate(({ net }) => {
      const original = net.fetch.bind(net)
      net.fetch = async (input, options) => {
        const url = new URL(String(input))
        if (url.origin !== 'https://example.com')
          return original(input, options)
        if (options?.method === 'PUT')
          throw new Error('Must not write on conflict')
        const product = {
          id: 1,
          sku: 'A',
          type: 'simple',
          regular_price: url.searchParams.has('sku') ? '10.00' : '11.00',
          manage_stock: true,
          stock_quantity: 2,
        }
        return new Response(
          JSON.stringify(url.searchParams.has('sku') ? [product] : product),
          { headers: { 'content-type': 'application/json' } },
        )
      }
    })
    const input = {
      products: [{ sku: 'A', price: '12.50', stock: '4' }],
      fields: ['price' as const],
    }
    let plan = await page.evaluate(
      (payload) => window.catalogDesktop!.previewTransfer(payload),
      input,
    )
    if (!plan.ok) throw new Error(plan.error)
    let run = await page.evaluate(
      (id) =>
        window.catalogDesktop!.executeTransfer({
          planId: id,
          selected: ['A'],
          confirmed: true,
        }),
      plan.value.id,
    )
    expect(run.ok && run.value.items[0].status).toBe('conflict')
    await application.evaluate(({ net }) => {
      const original = net.fetch.bind(net)
      net.fetch = async (input, options) => {
        const url = new URL(String(input))
        if (url.origin !== 'https://example.com')
          return original(input, options)
        if (options?.method === 'PUT')
          throw new Error('simulated connection lost')
        const product = {
          id: 1,
          sku: 'A',
          type: 'simple',
          regular_price: '10.00',
          manage_stock: true,
          stock_quantity: 2,
        }
        return new Response(
          JSON.stringify(url.searchParams.has('sku') ? [product] : product),
          { headers: { 'content-type': 'application/json' } },
        )
      }
    })
    plan = await page.evaluate(
      (payload) => window.catalogDesktop!.previewTransfer(payload),
      input,
    )
    if (!plan.ok) throw new Error(plan.error)
    run = await page.evaluate(
      (id) =>
        window.catalogDesktop!.executeTransfer({
          planId: id,
          selected: ['A'],
          confirmed: true,
        }),
      plan.value.id,
    )
    expect(run.ok && run.value.items[0].status).toBe('unknown')
    if (!run.ok) throw new Error(run.error)
    const runId = run.value.id
    await application.evaluate(({ net }) => {
      const original = net.fetch.bind(net)
      net.fetch = async (input, options) => {
        if (!String(input).startsWith('https://example.com/'))
          return original(input, options)
        if (options?.method !== 'GET')
          throw new Error('Only read reconciliation allowed')
        return new Response(
          JSON.stringify({
            id: 1,
            sku: 'A',
            type: 'simple',
            regular_price: '12.50',
            manage_stock: true,
            stock_quantity: 2,
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
    })
    const verified = await page.evaluate(
      (id) => window.catalogDesktop!.verifyHistory(id),
      runId,
    )
    expect(verified.ok && verified.value.items[0].status).toBe('success')
    expect(
      verified.ok && verified.value.events.map((event) => event.status),
    ).toEqual(['sending', 'unknown', 'success'])
    const list = await page.evaluate(() =>
      window.catalogDesktop!.listHistory(0),
    )
    expect(list.ok && list.value.total).toBe(2)
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('requires approval for shop writes and preserves exact history after restart', async ({
  playwright,
}, testInfo) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'catalogdesk-transfer-'),
  )
  const launch = () =>
    launchAuthenticatedElectron(playwright, {
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
    await page
      .getByRole('heading', { name: 'Produktkatalog', exact: true })
      .waitFor()
    expect(
      await page.evaluate(() =>
        window.catalogDesktop!.executeTransfer({
          planId: 'missing',
          selected: ['A'],
          confirmed: true,
        }),
      ),
    ).toMatchObject({ ok: false })
    const source = {
      filename: 'transfer.csv',
      demo: false,
      dataset: {
        headers: ['SKU', 'Name', 'Price', 'Stock'],
        rows: [['A', 'Notebook', '12.50', '4']],
        delimiter: ',' as const,
      },
      mapping: {
        sku: 'SKU',
        name: 'Name',
        price: 'Price',
        stock: 'Stock',
        category: '',
        description: '',
      },
      options: {
        trim: true,
        normalizePrices: true,
        priceFormat: 'en' as const,
      },
      edits: {},
      excluded: [],
    }
    const saved = await page.evaluate(
      (snapshot) =>
        window.catalogDesktop!.saveProject({ name: 'Transfer Test', snapshot }),
      source,
    )
    expect(saved.ok).toBe(true)
    await page.evaluate(() =>
      window.catalogDesktop!.saveShopConnection({
        url: 'https://example.com/',
        consumerKey: 'ck_' + 'a'.repeat(40),
        consumerSecret: 'cs_' + 'b'.repeat(40),
      }),
    )
    await application.evaluate(({ net }) => {
      const original = net.fetch.bind(net)
      let product = {
        id: 1,
        sku: 'A',
        type: 'simple',
        regular_price: '10.00',
        manage_stock: true,
        stock_quantity: 2,
      }
      net.fetch = async (input, options) => {
        const url = new URL(String(input))
        if (url.origin !== 'https://example.com')
          return original(input, options)
        if (options?.method === 'PUT') {
          const body = JSON.parse(String(options.body))
          if (
            Object.keys(body).sort().join(',') !==
            'regular_price,stock_quantity'
          )
            throw new Error('Forbidden fields')
          product = { ...product, ...body }
        }
        return new Response(
          JSON.stringify(url.searchParams.has('sku') ? [product] : product),
          { headers: { 'content-type': 'application/json' } },
        )
      }
    })
    await page
      .getByRole('button', { name: 'Importprojekte', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Projekt Transfer Test oeffnen' })
      .click()
    await expect(
      page.locator('.stats').getByRole('button', { name: /Exportbereit/ }),
    ).toContainText('1')
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await page
      .getByRole('button', { name: 'An WooCommerce uebertragen', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Bestand', { exact: true }).check()
    await dialog.getByRole('button', { name: 'Shopvorschau laden' }).click()
    await expect(
      dialog.getByRole('checkbox', { name: 'Produkt A freigeben' }),
    ).toBeEnabled()
    await expect(dialog.locator('.transfer-values')).toContainText('10.00')
    expect(
      await page.evaluate(() => window.catalogDesktop!.listHistory(0)),
    ).toMatchObject({ ok: true, value: { total: 0 } })
    await page.screenshot({ path: testInfo.outputPath('preview.png') })
    await dialog.getByRole('checkbox', { name: 'Produkt A freigeben' }).check()
    await dialog.getByRole('button', { name: '1 Produkte freigeben' }).click()
    expect(
      await page.evaluate(() => window.catalogDesktop!.listHistory(0)),
    ).toMatchObject({ ok: true, value: { total: 0 } })
    await dialog
      .getByRole('button', { name: 'Bestaetigen und uebertragen' })
      .click()
    await expect(dialog.getByRole('status')).toContainText('Bestaetigt')
    await dialog.getByRole('button', { name: 'Historie oeffnen' }).click()
    await page
      .getByRole('dialog')
      .locator('.history-runs button')
      .first()
      .click()
    await expect(
      page.getByRole('dialog').locator('.history-events'),
    ).toContainText('Schreibversuch gestartet')
    await page.screenshot({ path: testInfo.outputPath('history.png') })
    await application.close()
    application = await launch()
    page = await application.firstWindow()
    await page
      .getByRole('button', { name: 'Uebertragungshistorie', exact: true })
      .click()
    await page
      .getByRole('dialog')
      .locator('.history-runs button')
      .first()
      .click()
    await expect(
      page.getByRole('dialog').locator('.transfer-table'),
    ).toContainText('12.50')
    const history = await page.evaluate(async () => {
      const list = await window.catalogDesktop!.listHistory(0)
      if (!list.ok) throw new Error('No history')
      return window.catalogDesktop!.historyDetail(list.value.runs[0].id)
    })
    expect(history.ok && history.value.items[0].before.regular_price).toBe(
      '10.00',
    )
    expect(history.ok && history.value.items[0].desired).toEqual({
      regular_price: '12.50',
      stock_quantity: 4,
    })
    expect(history.ok && history.value.items[0].observed?.stock_quantity).toBe(
      4,
    )
    expect(
      history.ok && history.value.events.map((event) => event.status),
    ).toEqual(['sending', 'success'])
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
