import { useCallback, useEffect, useRef } from 'react'
import type { Analysis, AnalyzeInput } from '../domain/catalog'

export function useCatalogWorker() {
  const worker = useRef<Worker | null>(null)
  const sequence = useRef(0)
  const pending = useRef(
    new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >(),
  )

  useEffect(() => {
    const instance = new Worker(
      new URL('../domain/catalog.worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.current = instance
    const requests = pending.current
    instance.onmessage = (
      event: MessageEvent<{ id: number; result: unknown; error?: string }>,
    ) => {
      const request = requests.get(event.data.id)
      if (!request) return
      requests.delete(event.data.id)
      if (event.data.error) request.reject(new Error(event.data.error))
      else request.resolve(event.data.result)
    }
    instance.onerror = () => {
      for (const request of requests.values())
        request.reject(
          new Error(
            'Die Datenverarbeitung wurde unterbrochen. Bitte erneut importieren.',
          ),
        )
      requests.clear()
    }
    return () => {
      instance.terminate()
      worker.current = null
      for (const request of requests.values())
        request.reject(new Error('Verarbeitung abgebrochen.'))
      requests.clear()
    }
  }, [])

  const request = useCallback(
    <Result>(
      type: 'parse' | 'analyze' | 'export' | 'report',
      input: string | AnalyzeInput | Analysis,
    ): Promise<Result> => {
      if (!worker.current)
        return Promise.reject(
          new Error('Datenverarbeitung ist noch nicht bereit.'),
        )
      const id = ++sequence.current
      return new Promise((resolve, reject) => {
        pending.current.set(id, {
          resolve: (value) => resolve(value as Result),
          reject,
        })
        worker.current!.postMessage({ id, type, input })
      })
    },
    [],
  )

  return request
}
