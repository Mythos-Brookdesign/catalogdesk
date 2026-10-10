import {
  analyzeCatalog,
  exportReport,
  exportWooCommerce,
  parseCsv,
} from './catalog'
import type { Analysis, AnalyzeInput } from './catalog'

self.onmessage = (
  event: MessageEvent<{
    id: number
    type: 'parse' | 'analyze' | 'export' | 'report'
    input: string | AnalyzeInput | Analysis
  }>,
) => {
  const { id, type, input } = event.data
  try {
    const result =
      type === 'parse'
        ? parseCsv(input as string)
        : type === 'analyze'
          ? analyzeCatalog(input as AnalyzeInput)
          : type === 'export'
            ? exportWooCommerce(input as Analysis)
            : exportReport(input as Analysis)
    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error ? error.message : 'Verarbeitung fehlgeschlagen.',
    })
  }
}
