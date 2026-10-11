import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Dialog } from './Dialog'
import { ChangeValues } from './TransferDialog'
import { transferLabels } from '../lib/transfer'
import type { HistorySummary, TransferRun } from '../types/desktop'

export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const desktop = window.catalogDesktop
  const [page, setPage] = useState(0)
  const [runs, setRuns] = useState<HistorySummary[]>([])
  const [total, setTotal] = useState(0)
  const [detail, setDetail] = useState<TransferRun | null>(null)
  const [loading, setLoading] = useState(Boolean(desktop))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!desktop) return
    let cancelled = false
    desktop
      .listHistory(page)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) setError(result.error)
        else {
          setRuns(result.value.runs)
          setTotal(result.value.total)
        }
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setError('Historie konnte nicht geladen werden.')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [desktop, page, refresh])
  async function open(id: string, verify = false) {
    if (!desktop || busy) return
    setBusy(true)
    setError('')
    try {
      const result = verify
        ? await desktop.verifyHistory(id)
        : await desktop.historyDetail(id)
      if (!result.ok) setError(result.error)
      else {
        setDetail(result.value)
        if (verify) setRefresh((value) => value + 1)
      }
    } catch {
      setError('Verlauf konnte nicht geladen werden.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Uebertragungshistorie"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="transfer-dialog">
        {!desktop && (
          <p>Die SQLite-Historie ist nur in der Electron-App verfuegbar.</p>
        )}
        {error && (
          <div className="banner danger" role="alert">
            {error}
          </div>
        )}
        {!detail ? (
          <>
            <div className="section-title">
              <span className="muted-text">
                {total} dokumentierte Uebertragungen
              </span>
              <button
                className="icon-button"
                title="Historie aktualisieren"
                aria-label="Historie aktualisieren"
                disabled={busy || !desktop}
                onClick={() => {
                  setLoading(true)
                  setRefresh((value) => value + 1)
                }}
              >
                <RefreshCw size={17} />
              </button>
            </div>
            {loading ? (
              <p>Historie wird geladen ...</p>
            ) : !runs.length ? (
              <p className="muted-text">
                Noch keine bestaetigten Uebertragungen.
              </p>
            ) : (
              <ul className="history-runs">
                {runs.map((run) => (
                  <li key={run.id}>
                    <button disabled={busy} onClick={() => void open(run.id)}>
                      <strong>
                        {new Date(run.createdAt).toLocaleString('de-DE')}
                      </strong>
                      <span>{run.url}</span>
                      <span>
                        {run.count} Produkte &middot; {run.counts.success ?? 0}{' '}
                        bestaetigt &middot;{' '}
                        {(run.counts.unknown ?? 0) + (run.counts.sending ?? 0)}{' '}
                        unklar &middot;{' '}
                        {run.status === 'running'
                          ? 'Nicht abgeschlossen'
                          : run.status === 'cancelled'
                            ? 'Abgebrochen'
                            : run.status === 'interrupted'
                              ? 'Unterbrochen'
                              : 'Beendet'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="dialog-actions">
              <button
                className="icon-button"
                aria-label="Vorherige Verlaufsseite"
                title="Vorherige Seite"
                disabled={page === 0 || loading}
                onClick={() => {
                  setLoading(true)
                  setPage(page - 1)
                }}
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(total / 20))}
              </span>
              <button
                className="icon-button"
                aria-label="Naechste Verlaufsseite"
                title="Naechste Seite"
                disabled={(page + 1) * 20 >= total || loading}
                onClick={() => {
                  setLoading(true)
                  setPage(page + 1)
                }}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="section-title">
              <div>
                <h3>{detail.url}</h3>
                <p>
                  {new Date(detail.createdAt).toLocaleString('de-DE')} &middot;
                  Lauf {detail.id}
                </p>
              </div>
              <button
                className="button"
                disabled={busy}
                onClick={() => setDetail(null)}
              >
                Zur Liste
              </button>
            </div>
            <div className="table-scroll">
              <table className="transfer-table">
                <thead>
                  <tr>
                    <th>SKU / Produkt-ID</th>
                    <th>Vorher &rarr; Gewuenscht</th>
                    <th>Ergebnis</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.sku}
                        <small>ID {item.before.id}</small>
                      </td>
                      <td>
                        <ChangeValues
                          before={item.before}
                          desired={item.desired}
                        />
                      </td>
                      <td>
                        <span
                          className={`status ${item.status === 'success' ? 'success' : 'neutral'}`}
                        >
                          {transferLabels[item.status]}
                        </span>
                        <small>{item.message}</small>
                        {item.observed && (
                          <small>
                            Gelesen: Preis{' '}
                            {item.observed.regular_price || '(leer)'}, Bestand{' '}
                            {item.observed.stock_quantity ?? '(leer)'}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.items.some((item) =>
              ['sending', 'unknown'].includes(item.status),
            ) && (
              <button
                className="button"
                disabled={busy}
                onClick={() => void open(detail.id, true)}
              >
                <RefreshCw size={16} />
                Unklare Ergebnisse lesend nachpruefen
              </button>
            )}
            <h3 className="history-events-title">Ereignisprotokoll</h3>
            <ol className="history-events">
              {detail.events.map((event) => (
                <li key={event.sequence}>
                  <time>
                    {new Date(event.timestamp).toLocaleString('de-DE')}
                  </time>
                  <strong>
                    {detail.items.find((item) => item.id === event.itemId)?.sku}{' '}
                    &middot; {transferLabels[event.status]}
                  </strong>
                  <span>{event.message}</span>
                  {event.observed && (
                    <span>
                      Shopstand: Preis{' '}
                      {event.observed.regular_price || '(leer)'}, Bestand{' '}
                      {event.observed.stock_quantity ?? '(leer)'}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
        <div className="dialog-actions">
          <button className="button" disabled={busy} onClick={onClose}>
            Schliessen
          </button>
        </div>
      </div>
    </Dialog>
  )
}
