import Papa from 'papaparse'

export const fields = [
  { key: 'sku', label: 'Artikelnummer', required: true },
  { key: 'name', label: 'Produktname', required: true },
  { key: 'price', label: 'Preis', required: true },
  { key: 'stock', label: 'Bestand', required: false },
  { key: 'category', label: 'Kategorien', required: false },
  { key: 'description', label: 'Beschreibung', required: false },
] as const

export type Field = (typeof fields)[number]['key']
export type Mapping = Record<Field, string>
export type Product = Record<Field, string>
export type Dataset = { headers: string[]; rows: string[][]; delimiter: string }
export type Options = {
  trim: boolean
  normalizePrices: boolean
  priceFormat: 'de' | 'en'
}
export type Issue = { field: Field; message: string }
export type CatalogRow = {
  index: number
  original: Product
  product: Product
  issues: Issue[]
  changes: Field[]
  excluded: boolean
}
export type Analysis = {
  rows: CatalogRow[]
  missing: Field[]
  valid: number
  invalid: number
  changed: number
  excluded: number
}
export type AnalyzeInput = {
  dataset: Dataset
  mapping: Mapping
  options: Options
  edits: Record<number, Partial<Product>>
  excluded: number[]
}

export const defaultOptions: Options = {
  trim: true,
  normalizePrices: true,
  priceFormat: 'de',
}
export const emptyMapping: Mapping = {
  sku: '',
  name: '',
  price: '',
  stock: '',
  category: '',
  description: '',
}
export const MAX_FILE_SIZE = 10 * 1024 * 1024
export const MAX_ROWS = 50_000

export function parseCsv(text: string): Dataset {
  if (!text.trim()) throw new Error('Die CSV-Datei ist leer.')
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy',
  })
  if (parsed.errors.length)
    throw new Error(
      `CSV konnte nicht gelesen werden: ${parsed.errors[0].message}`,
    )
  const [rawHeaders, ...rows] = parsed.data
  const headers = rawHeaders?.map((header) => header.trim()) ?? []
  if (headers.length < 2)
    throw new Error(
      'Mindestens zwei Spalten werden benoetigt. Unterstuetzt werden Komma, Semikolon und Tabulator.',
    )
  if (headers.some((header) => !header))
    throw new Error('Jede Spalte braucht eine Ueberschrift.')
  if (new Set(headers).size !== headers.length)
    throw new Error('Spaltenueberschriften muessen eindeutig sein.')
  if (!rows.length) throw new Error('Die Datei enthaelt keine Produktzeilen.')
  if (rows.length > MAX_ROWS)
    throw new Error('Maximal 50.000 Produktzeilen pro Import sind erlaubt.')
  const mismatch = rows.findIndex((row) => row.length !== headers.length)
  if (mismatch !== -1)
    throw new Error(
      `Datensatz ${mismatch + 1} hat ${rows[mismatch].length} statt ${headers.length} Spalten.`,
    )
  return { headers, rows, delimiter: parsed.meta.delimiter }
}

const aliases: Record<Field, string[]> = {
  sku: ['sku', 'artikelnummer', 'artnr', 'artikelnr', 'article number'],
  name: ['name', 'produktname', 'produkt', 'bezeichnung', 'product name'],
  price: ['preis', 'price', 'regular price', 'verkaufspreis', 'vk'],
  stock: ['bestand', 'stock', 'lagerbestand', 'menge'],
  category: [
    'kategorie',
    'kategorien',
    'category',
    'categories',
    'warengruppe',
  ],
  description: ['beschreibung', 'description', 'langtext'],
}

export function suggestMapping(headers: string[]): Mapping {
  return Object.fromEntries(
    fields.map(({ key }) => [
      key,
      headers.find((header) => aliases[key].includes(header.toLowerCase())) ??
        '',
    ]),
  ) as Mapping
}

export function normalizePrice(
  value: string,
  format: Options['priceFormat'],
): string | null {
  const plain = value.replace(/\s*(?:EUR|€)\s*$/i, '').trim()
  const pattern =
    format === 'de'
      ? /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/
      : /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/
  if (!pattern.test(plain)) return null
  const canonical =
    format === 'de'
      ? plain.replaceAll('.', '').replace(',', '.')
      : plain.replaceAll(',', '')
  const number = Number(canonical)
  return Number.isFinite(number) && number <= 999_999_999
    ? number.toFixed(2)
    : null
}

export function analyzeCatalog(input: AnalyzeInput): Analysis {
  const { dataset, mapping, options, edits, excluded } = input
  const excludedSet = new Set(excluded)
  const missing = fields
    .filter(
      ({ key, required }) =>
        required && !dataset.headers.includes(mapping[key]),
    )
    .map(({ key }) => key)
  const positions = Object.fromEntries(
    fields.map(({ key }) => [key, dataset.headers.indexOf(mapping[key])]),
  ) as Record<Field, number>
  const rows: CatalogRow[] = dataset.rows.map((source, index) => {
    const original = Object.fromEntries(
      fields.map(({ key }) => [key, source[positions[key]] ?? '']),
    ) as Product
    const product = { ...original, ...edits[index] }
    const issues: Issue[] = []
    if (options.trim)
      for (const { key } of fields) product[key] = product[key].trim()
    if (options.normalizePrices && product.price) {
      const normalized = normalizePrice(product.price, options.priceFormat)
      if (normalized !== null) product.price = normalized
      else
        issues.push({
          field: 'price',
          message: 'Preis passt nicht zum gewaehlten Zahlenformat.',
        })
    }
    for (const { key, required } of fields) {
      if (required && !product[key].trim())
        issues.push({ field: key, message: 'Pflichtfeld ist leer.' })
    }
    if (
      product.price &&
      !issues.some((issue) => issue.field === 'price') &&
      !/^\d+(?:\.\d{1,2})?$/.test(product.price)
    ) {
      issues.push({
        field: 'price',
        message: 'Preis muss eine positive Zahl mit Dezimalpunkt sein.',
      })
    }
    if (product.price && Number(product.price) > 999_999_999)
      issues.push({ field: 'price', message: 'Preis ist zu gross.' })
    if (
      product.stock &&
      (!/^\d+$/.test(product.stock) ||
        !Number.isSafeInteger(Number(product.stock)))
    ) {
      issues.push({
        field: 'stock',
        message: 'Bestand muss eine nichtnegative ganze Zahl sein.',
      })
    }
    return {
      index,
      original,
      product,
      issues,
      changes: fields
        .filter(({ key }) => original[key] !== product[key])
        .map(({ key }) => key),
      excluded: excludedSet.has(index),
    }
  })
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!row.excluded && row.product.sku.trim()) {
      const sku = row.product.sku.trim().toLowerCase()
      counts.set(sku, (counts.get(sku) ?? 0) + 1)
    }
  }
  for (const row of rows) {
    if (
      !row.excluded &&
      (counts.get(row.product.sku.trim().toLowerCase()) ?? 0) > 1
    ) {
      row.issues.push({
        field: 'sku',
        message: 'Artikelnummer kommt mehrfach vor.',
      })
    }
  }
  return {
    rows,
    missing,
    valid: rows.filter((row) => !row.excluded && !row.issues.length).length,
    invalid: rows.filter((row) => !row.excluded && row.issues.length).length,
    changed: rows.filter((row) => !row.excluded && row.changes.length).length,
    excluded: excludedSet.size,
  }
}

export function exportWooCommerce(analysis: Analysis): string {
  if (analysis.missing.length || analysis.invalid)
    throw new Error(
      'Vor dem Export muessen alle aktiven Datensaetze gueltig sein.',
    )
  const rows = analysis.rows.filter((row) => !row.excluded)
  if (!rows.length)
    throw new Error('Keine Produkte fuer den Export ausgewaehlt.')
  return (
    '\uFEFF' +
    Papa.unparse(
      {
        fields: [
          'Type',
          'SKU',
          'Name',
          'Published',
          'Regular price',
          'Visibility in catalog',
          'In stock?',
          'Stock',
          'Categories',
          'Description',
        ],
        data: rows.map(({ product }) => [
          'simple',
          product.sku,
          product.name,
          -1,
          product.price,
          'visible',
          product.stock && Number(product.stock) === 0 ? '0' : '1',
          product.stock,
          product.category,
          product.description,
        ]),
      },
      { escapeFormulae: true, newline: '\r\n' },
    )
  )
}

export function exportReport(analysis: Analysis): string {
  return (
    '\uFEFF' +
    Papa.unparse(
      {
        fields: [
          'Datensatz',
          'Artikelnummer',
          'Status',
          'Feld',
          'Original',
          'Ergebnis',
          'Hinweis',
        ],
        data: analysis.rows.flatMap((row) => {
          const state = row.excluded
            ? 'Ausgeschlossen'
            : row.issues.length
              ? 'Fehler'
              : 'Gueltig'
          const entries = [
            ...row.issues.map((issue) => ({
              field: issue.field,
              note: issue.message,
            })),
            ...row.changes.map((field) => ({ field, note: 'Wert geaendert' })),
          ]
          return (
            entries.length
              ? entries
              : [{ field: 'sku' as Field, note: 'Keine Aenderungen' }]
          ).map(({ field, note }) => [
            row.index + 1,
            row.product.sku,
            state,
            field,
            row.original[field],
            row.product[field],
            note,
          ])
        }),
      },
      { escapeFormulae: true, newline: '\r\n' },
    )
  )
}
