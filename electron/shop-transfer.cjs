const { z } = require('zod')
const { randomUUID } = require('node:crypto')
const { connectionSchema } = require('./shop.cjs')

class ShopRequestError extends Error {
  constructor(message, definitive = false) {
    super(message)
    this.definitive = definitive
  }
}
const productSchema = z.object({
  id: z.number().int().positive(),
  sku: z.string().max(255),
  type: z.string(),
  regular_price: z.string(),
  manage_stock: z.boolean(),
  stock_quantity: z.number().int().safe().nullable(),
})
const previewSchema = z
  .object({
    products: z
      .array(
        z
          .object({
            sku: z.string().trim().min(1).max(255),
            price: z
              .string()
              .regex(/^\d+(?:\.\d{1,2})?$/)
              .refine((value) => Number(value) <= 999_999_999),
            stock: z
              .string()
              .regex(/^\d*$/)
              .refine((value) => !value || Number.isSafeInteger(Number(value))),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    fields: z
      .array(z.enum(['price', 'stock']))
      .min(1)
      .max(2),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.fields).size === value.fields.length &&
      new Set(value.products.map((product) => product.sku.toLowerCase()))
        .size === value.products.length,
  )

function baseUrl(connection) {
  const base = new URL(connection.url)
  base.pathname = base.pathname.replace(/\/+$/, '') + '/'
  return base
}
function equivalent(actual, expected) {
  return Object.entries(expected).every(([key, value]) =>
    key === 'regular_price'
      ? actual[key] !== '' && Number(actual[key]) === Number(value)
      : actual[key] === value,
  )
}
async function request(
  connection,
  fetcher,
  suffix,
  { method = 'GET', body, signal } = {},
) {
  const timeout = AbortSignal.timeout(15_000)
  try {
    const response = await fetcher(
      new URL(
        `wp-json/wc/v3/products${suffix}`,
        baseUrl(connection),
      ).toString(),
      {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${connection.consumerKey}:${connection.consumerSecret}`).toString('base64')}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      },
    )
    if (!response.ok) {
      await response.body?.cancel()
      throw new ShopRequestError(
        response.status === 401 || response.status === 403
          ? 'Zugriff verweigert. WooCommerce-Schluessel mit Lesen/Schreiben benoetigt.'
          : `Shopanfrage fehlgeschlagen (HTTP ${response.status}).`,
        [400, 401, 403, 404, 405, 422].includes(response.status),
      )
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel()
      throw new ShopRequestError('Die Shopantwort ist kein JSON.')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new ShopRequestError('Die Shopantwort ist leer.')
    const chunks = []
    let bytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 256 * 1024) {
        await reader.cancel()
        throw new ShopRequestError('Die Shopantwort ist zu gross.')
      }
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    if (error instanceof ShopRequestError) throw error
    throw new ShopRequestError(
      signal?.aborted
        ? 'Vorgang abgebrochen.'
        : 'Shopanfrage unklar: Zeitlimit, Netzwerk oder Antwortformat pruefen.',
    )
  }
}
async function readProduct(connection, fetcher, id, signal) {
  return productSchema.parse(
    await request(
      connection,
      fetcher,
      `/${id}?_fields=id,sku,type,regular_price,manage_stock,stock_quantity`,
      { signal },
    ),
  )
}
function identity(actual, before) {
  return (
    actual.id === before.id &&
    actual.type === 'simple' &&
    actual.sku === before.sku
  )
}

async function previewTransfer(connection, payload, fetcher, signal) {
  connectionSchema.parse(connection)
  const parsed = previewSchema.safeParse(payload)
  if (!parsed.success)
    throw new Error(
      'Ungueltige Auswahl. Maximal 100 eindeutige Produkte mit gueltigen Preisen und Bestaenden.',
    )
  const entries = []
  for (const product of parsed.data.products) {
    signal?.throwIfAborted()
    const query = new URLSearchParams({
      sku: product.sku,
      per_page: '100',
      status: 'any',
      _fields: 'id,sku,type,regular_price,manage_stock,stock_quantity',
    })
    const raw = await request(connection, fetcher, `?${query}`, { signal })
    const products = z.array(productSchema).max(100).parse(raw)
    const matches = products.filter(
      (item) => item.sku.toLowerCase() === product.sku.toLowerCase(),
    )
    const before = matches.length === 1 ? matches[0] : null
    const desired = {}
    if (parsed.data.fields.includes('price'))
      desired.regular_price = Number(product.price).toFixed(2)
    if (parsed.data.fields.includes('stock') && product.stock !== '')
      desired.stock_quantity = Number(product.stock)
    let reason = ''
    if (matches.length !== 1)
      reason = matches.length
        ? 'Artikelnummer ist im Shop nicht eindeutig.'
        : 'Kein bestehendes Produkt mit dieser Artikelnummer.'
    else if (before.type !== 'simple')
      reason = 'Nur bestehende einfache Produkte werden aktualisiert.'
    else if ('stock_quantity' in desired && !before.manage_stock)
      reason = 'Bestandsverwaltung ist im Shop nicht aktiviert.'
    const changes = before
      ? Object.fromEntries(
          Object.entries(desired).filter(
            ([key, value]) => !equivalent(before, { [key]: value }),
          ),
        )
      : desired
    entries.push({
      sku: product.sku,
      before,
      desired: changes,
      status: reason
        ? 'blocked'
        : Object.keys(changes).length
          ? 'ready'
          : 'unchanged',
      message:
        reason ||
        (Object.keys(changes).length
          ? 'Aenderungen vorhanden.'
          : 'Keine Aenderungen.'),
    })
  }
  return {
    id: randomUUID(),
    url: baseUrl(connection).toString(),
    createdAt: new Date().toISOString(),
    entries,
  }
}

async function executeTransfer(
  connection,
  plan,
  selected,
  fetcher,
  database,
  { signal } = {},
) {
  connectionSchema.parse(connection)
  if (baseUrl(connection).toString() !== plan.url)
    throw new Error(
      'Shopverbindung wurde geaendert. Bitte Vorschau erneut laden.',
    )
  const selectedSchema = z.array(z.string()).min(1).max(100)
  const parsed = selectedSchema.safeParse(selected)
  if (!parsed.success || new Set(selected).size !== selected.length)
    throw new Error('Ungueltige Produktauswahl.')
  const entries = selected.map((sku) =>
    plan.entries.find((entry) => entry.sku === sku && entry.status === 'ready'),
  )
  if (entries.some((entry) => !entry))
    throw new Error(
      'Nur freigegebene Produkte aus der Vorschau duerfen uebertragen werden.',
    )
  const run = await database('startTransfer', { url: plan.url, entries })
  let stop = false
  try {
    for (const entry of run.items) {
      const event = (status, message, observed = null) =>
        database('recordTransfer', {
          runId: run.id,
          itemId: entry.id,
          status,
          message,
          observed,
        })
      if (stop || signal?.aborted) {
        await event('cancelled', 'Nicht uebertragen: Vorgang abgebrochen.')
        continue
      }
      let current
      try {
        current = await readProduct(
          connection,
          fetcher,
          entry.before.id,
          signal,
        )
      } catch {
        await event(
          signal?.aborted ? 'cancelled' : 'failed',
          'Shopstand konnte vor dem Schreiben nicht gelesen werden.',
        )
        continue
      }
      const expected = Object.fromEntries(
        Object.keys(entry.desired).map((key) => [key, entry.before[key]]),
      )
      if (
        !identity(current, entry.before) ||
        !equivalent(current, expected) ||
        ('stock_quantity' in entry.desired &&
          current.manage_stock !== entry.before.manage_stock)
      ) {
        await event(
          'conflict',
          'Shopwerte wurden seit der Vorschau geaendert. Kein Schreibzugriff.',
          current,
        )
        continue
      }
      if (signal?.aborted) {
        await event('cancelled', 'Vor dem Schreiben abgebrochen.')
        continue
      }
      await event(
        'sending',
        'Schreibversuch gestartet; Ergebnis noch nicht bestaetigt.',
        current,
      )
      let writeError = null
      try {
        await request(connection, fetcher, `/${current.id}`, {
          method: 'PUT',
          body: entry.desired,
          signal,
        })
      } catch (error) {
        writeError = error
      }
      if (writeError?.definitive) {
        await event('failed', writeError.message)
        continue
      }
      try {
        const observed = await readProduct(connection, fetcher, current.id)
        if (
          identity(observed, entry.before) &&
          equivalent(observed, entry.desired) &&
          (!('stock_quantity' in entry.desired) || observed.manage_stock)
        ) {
          await event(
            'success',
            writeError
              ? 'Nach unklarer Schreibantwort durch erneutes Lesen bestaetigt.'
              : 'Shopwerte nach Schreiben durch erneutes Lesen bestaetigt.',
            observed,
          )
        } else {
          await event(
            'unknown',
            'Schreibresultat nicht bestaetigt. Nicht automatisch erneut uebertragen.',
            observed,
          )
          stop = true
        }
      } catch {
        await event(
          'unknown',
          'Schreibresultat unklar; erneutes Lesen fehlgeschlagen. Keine automatische Wiederholung.',
        )
        stop = true
      }
    }
    await database('finishTransfer', {
      id: run.id,
      status: signal?.aborted ? 'cancelled' : 'finished',
    })
  } catch {
    await database('finishTransfer', {
      id: run.id,
      status: 'interrupted',
    }).catch(() => {})
    throw new Error(
      'Uebertragung unterbrochen. Historie pruefen; nicht bestaetigte Schreibversuche sind unklar.',
    )
  }
  return database('transferDetail', run.id)
}

async function verifyTransfer(connection, run, fetcher, database) {
  if (baseUrl(connection).toString() !== run.url)
    throw new Error(
      'Gespeicherte Verbindung passt nicht zum Shop dieses Verlaufs.',
    )
  for (const item of run.items.filter((entry) =>
    ['sending', 'unknown'].includes(entry.status),
  )) {
    try {
      const observed = await readProduct(connection, fetcher, item.before.id)
      const confirmed =
        identity(observed, item.before) &&
        equivalent(observed, item.desired) &&
        (!('stock_quantity' in item.desired) || observed.manage_stock)
      await database('recordTransfer', {
        runId: run.id,
        itemId: item.id,
        status: confirmed ? 'success' : 'unknown',
        message: confirmed
          ? 'Gewuenschte Shopwerte bei manueller Nachpruefung bestaetigt.'
          : 'Manuelle Nachpruefung: Shopwerte weichen ab; Ergebnis bleibt unklar.',
        observed,
      })
    } catch {
      await database('recordTransfer', {
        runId: run.id,
        itemId: item.id,
        status: 'unknown',
        message: 'Manuelle Nachpruefung fehlgeschlagen.',
        observed: null,
      })
    }
  }
  return database('transferDetail', run.id)
}

module.exports = { previewTransfer, executeTransfer, verifyTransfer }
