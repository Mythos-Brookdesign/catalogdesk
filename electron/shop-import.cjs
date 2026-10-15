const { z } = require('zod')
const { connectionSchema } = require('./shop.cjs')

class ShopImportError extends Error {}

const productSchema = z
  .object({
    id: z.number().int().positive(),
    type: z.string().max(80),
    sku: z.string(),
    name: z.string(),
    regular_price: z.string(),
    description: z.string(),
    manage_stock: z.boolean(),
    stock_quantity: z.number().int().safe().nullable(),
    categories: z
      .array(
        z
          .object({ id: z.number().int().positive(), name: z.string() })
          .passthrough(),
      )
      .max(1000),
  })
  .passthrough()
const pageSchema = z
  .array(
    z.union([
      productSchema.extend({ type: z.literal('simple') }),
      z
        .object({
          id: z.number().int().positive(),
          type: z
            .string()
            .max(80)
            .refine((type) => type !== 'simple'),
        })
        .passthrough(),
    ]),
  )
  .max(100)

function countHeader(response, name) {
  const value = response.headers.get(name)
  if (
    value === null ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new ShopImportError(
      'Die API liefert keine gueltigen Seitennavigationsdaten.',
    )
  return Number(value)
}

async function importShopProducts(
  payload,
  fetcher,
  { signal, onProgress = () => {} } = {},
) {
  const parsed = connectionSchema.safeParse(payload)
  if (!parsed.success)
    return {
      ok: false,
      error:
        'Bitte eine gueltige HTTPS-Shopadresse und WooCommerce-Schluessel eingeben.',
    }
  const { url, consumerKey, consumerSecret } = parsed.data
  const base = new URL(url)
  base.pathname = base.pathname.replace(/\/+$/, '') + '/'
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const deadline = setTimeout(abort, 120_000)
  let pageTimer
  let total = null
  let pages = null
  let bytes = 0
  const ids = new Set()
  const rows = []
  const catalogProducts = []
  const skipped = new Map()
  let lastId = 0
  try {
    for (let page = 1; page <= (pages ?? 1); page++) {
      controller.signal.throwIfAborted()
      const endpoint = new URL('wp-json/wc/v3/products', base)
      endpoint.search = new URLSearchParams({
        per_page: '100',
        page: String(page),
        status: 'any',
        orderby: 'id',
        order: 'asc',
        _fields:
          'id,type,parent_id,sku,name,slug,status,regular_price,sale_price,price,description,short_description,manage_stock,stock_quantity,stock_status,backorders,weight,dimensions,categories,tags,brands,attributes,default_attributes,meta_data',
      }).toString()
      pageTimer = setTimeout(abort, 15_000)
      const response = await fetcher(endpoint.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
          Accept: 'application/json',
        },
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) {
        await response.body?.cancel()
        if (response.status === 401 || response.status === 403)
          throw new ShopImportError(
            'Zugriff verweigert. Schluessel und Leseberechtigung pruefen.',
          )
        throw new ShopImportError(
          `Der Shop antwortet mit HTTP ${response.status}. Der Import wurde nicht uebernommen.`,
        )
      }
      const currentTotal = countHeader(response, 'x-wp-total')
      const currentPages = countHeader(response, 'x-wp-totalpages')
      if (currentTotal > 50_000 || currentPages > 500) {
        await response.body?.cancel()
        throw new ShopImportError('Maximal 50.000 Shopprodukte pro Import.')
      }
      if (
        currentPages !== Math.ceil(currentTotal / 100) ||
        (total !== null && (total !== currentTotal || pages !== currentPages))
      ) {
        await response.body?.cancel()
        throw new ShopImportError(
          'Der Shopkatalog hat sich waehrend des Imports geaendert oder die Seitennavigation ist ungueltig. Bitte erneut importieren.',
        )
      }
      total = currentTotal
      pages = currentPages
      if (
        !response.headers
          .get('content-type')
          ?.toLowerCase()
          .includes('application/json')
      ) {
        await response.body?.cancel()
        throw new ShopImportError(
          'Der Shop liefert kein JSON. Shopadresse und REST-API pruefen.',
        )
      }
      const reader = response.body?.getReader()
      if (!reader) throw new ShopImportError('Die API-Antwort ist leer.')
      const chunks = []
      let pageBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        pageBytes += value.byteLength
        bytes += value.byteLength
        if (pageBytes > 5 * 1024 * 1024 || bytes > 30 * 1024 * 1024) {
          await reader.cancel()
          throw new ShopImportError(
            'Der Shopimport ist zu gross. Maximal 5 MB pro Seite und 30 MB insgesamt.',
          )
        }
        chunks.push(Buffer.from(value))
      }
      clearTimeout(pageTimer)
      const result = pageSchema.safeParse(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      )
      if (
        !result.success ||
        result.data.length !==
          Math.min(100, Math.max(0, total - (page - 1) * 100))
      )
        throw new ShopImportError(
          'Die API-Antwort ist ungueltig oder unvollstaendig. Der Import wurde nicht uebernommen.',
        )
      for (const product of result.data) {
        if (ids.has(product.id) || product.id <= lastId)
          throw new ShopImportError(
            'Die API liefert doppelte oder unsortierte Produkte. Bitte erneut importieren.',
          )
        ids.add(product.id)
        lastId = product.id
        catalogProducts.push({
          id: product.id,
          parentId:
            Number.isSafeInteger(product.parent_id) && product.parent_id > 0
              ? product.parent_id
              : null,
          type: product.type,
          sku: typeof product.sku === 'string' ? product.sku : '',
          name: typeof product.name === 'string' ? product.name : '',
          payload: product,
        })
        if (product.type !== 'simple') {
          skipped.set(product.type, (skipped.get(product.type) ?? 0) + 1)
          continue
        }
        const categories = product.categories
          .map((category) => category.name.replaceAll(',', '\\,'))
          .join(', ')
        rows.push([
          product.sku,
          product.name,
          product.regular_price,
          product.manage_stock && product.stock_quantity !== null
            ? String(product.stock_quantity)
            : '',
          categories,
          product.description,
        ])
      }
      onProgress({ loaded: ids.size, total, page, pages })
    }
    controller.signal.throwIfAborted()
    if (!rows.length)
      throw new ShopImportError(
        total === 0
          ? 'Der Shop enthaelt keine lesbaren Produkte.'
          : 'Keine einfachen Produkte gefunden. Der bisherige Katalog bleibt erhalten.',
      )
    const dataset = {
      headers: [
        'SKU',
        'Name',
        'Regular price',
        'Stock',
        'Categories',
        'Description',
      ],
      rows,
      delimiter: ',',
    }
    if (Buffer.byteLength(JSON.stringify(dataset)) > 30 * 1024 * 1024)
      throw new ShopImportError('Der aufbereitete Katalog ist zu gross.')
    return {
      ok: true,
      url: base.toString(),
      dataset,
      catalogProducts,
      imported: rows.length,
      total,
      skipped: [...skipped].map(([type, count]) => ({ type, count })),
      importedAt: new Date().toISOString(),
    }
  } catch (error) {
    if (controller.signal.aborted)
      return {
        ok: false,
        error: signal?.aborted
          ? 'Import abgebrochen. Der bisherige Katalog bleibt erhalten.'
          : 'Zeitlimit erreicht: maximal 15 Sekunden pro Seite und 2 Minuten insgesamt.',
      }
    return {
      ok: false,
      error:
        error instanceof ShopImportError
          ? error.message
          : 'Shopimport fehlgeschlagen. HTTPS-Zertifikat, Erreichbarkeit und API pruefen. Weiterleitungen sind nicht erlaubt.',
    }
  } finally {
    clearTimeout(deadline)
    clearTimeout(pageTimer)
    signal?.removeEventListener('abort', abort)
  }
}

module.exports = { importShopProducts }
