import { useState } from 'react'
import {
  ArrowRight,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  Upload,
} from 'lucide-react'
import { Dialog } from './Dialog'
import type {
  TransferPlan,
  TransferRun,
  TransferValues,
} from '../types/desktop'
import { transferLabels } from '../lib/transfer'

export function ChangeValues({
  before,
  desired,
}: {
  before: { regular_price?: string; stock_quantity?: number | null } | null
  desired: TransferValues
}) {
  return (
    <div className="transfer-values">
      {Object.entries(desired).map(([field, value]) => (
        <span key={field}>
          <strong>{field === 'regular_price' ? 'Preis' : 'Bestand'}</strong>
          <span>{before?.[field as keyof TransferValues] ?? '(leer)'}</span>
          <ArrowRight size={13} />
          <b>{value}</b>
        </span>
      ))}
    </div>
  )
}

export function TransferDialog({
  products,
  onClose,
  onHistory,
}: {
  products: { sku: string; price: string; stock: string }[]
  onClose: () => void
  onHistory: () => void
}) {
  const desktop = window.catalogDesktop
  const [price, setPrice] = useState(true)
  const [stock, setStock] = useState(false)
  const [plan, setPlan] = useState<TransferPlan | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [writing, setWriting] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const [run, setRun] = useState<TransferRun | null>(null)

  async function preview() {
    if (!desktop || busy) return
    setBusy(true)
    setError('')
    setPlan(null)
    setSelected([])
    setConfirm(false)
    setRun(null)
    try {
      const result = await desktop.previewTransfer({
        products,
        fields: [
          ...(price ? ['price' as const] : []),
          ...(stock ? ['stock' as const] : []),
        ],
      })
      if (!result.ok) setError(result.error)
      else setPlan(result.value)
    } catch {
      setError('Vorschau fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }
  async function execute() {
    if (!desktop || !plan || busy) return
    setBusy(true)
    setWriting(true)
    setError('')
    setConfirm(false)
    try {
      const result = await desktop.executeTransfer({
        planId: plan.id,
        selected,
        confirmed: true,
      })
      if (!result.ok) setError(result.error)
      else setRun(result.value)
      setPlan(null)
      setSelected([])
    } catch {
      setError('Uebertragung unterbrochen. Historie pruefen.')
      setPlan(null)
    } finally {
      setBusy(false)
      setWriting(false)
    }
  }
  function changeField(update: () => void) {
    update()
    setPlan(null)
    setSelected([])
    setConfirm(false)
  }

  return (
    <Dialog
      title="An WooCommerce uebertragen"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="transfer-dialog">
        <p className="transfer-note">
          {products.length} gueltige, aktive Datensaetze &middot; bestehende
          einfache Shopprodukte &middot; maximal 100 pro Lauf
        </p>
        <div className="transfer-fields">
          <label>
            <input
              type="checkbox"
              checked={price}
              disabled={busy}
              onChange={(event) =>
                changeField(() => setPrice(event.target.checked))
              }
            />
            Preis
          </label>
          <label>
            <input
              type="checkbox"
              checked={stock}
              disabled={busy}
              onChange={(event) =>
                changeField(() => setStock(event.target.checked))
              }
            />
            Bestand
          </label>
          <button
            className="button"
            disabled={
              !desktop ||
              busy ||
              (!price && !stock) ||
              !products.length ||
              products.length > 100
            }
            onClick={() => void preview()}
          >
            <RefreshCw size={16} />
            Shopvorschau laden
          </button>
        </div>
        {products.length > 100 && (
          <div className="banner warning">
            Maximal 100 gueltige, aktive Produkte pro Lauf. Weitere Datensaetze
            zuerst ausschliessen.
          </div>
        )}
        {!desktop && (
          <div className="banner warning">
            Shopuebertragung ist nur in der Electron-App verfuegbar.
          </div>
        )}
        {error && (
          <div className="banner danger" role="alert">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        )}
        {busy && (
          <div className="project-empty" role="status">
            <LoaderCircle className="spin" size={18} />
            {writing
              ? 'Produkte werden geprueft und uebertragen ...'
              : 'Shopdaten werden geprueft ...'}
            <button
              className="button"
              onClick={() =>
                void desktop
                  ?.cancelTransfer()
                  .catch(() => setError('Abbruch fehlgeschlagen.'))
              }
            >
              Vorgang abbrechen
            </button>
          </div>
        )}
        {plan && (
          <>
            <p className="transfer-note">
              {plan.url} &middot; Vorschau gueltig fuer zehn Minuten
            </p>
            <div className="table-scroll">
              <table className="transfer-table">
                <thead>
                  <tr>
                    <th>Freigabe</th>
                    <th>SKU</th>
                    <th>Shop &rarr; CatalogDesk</th>
                    <th>Pruefung</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.entries.map((entry) => (
                    <tr key={entry.sku}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Produkt ${entry.sku} freigeben`}
                          disabled={busy || entry.status !== 'ready'}
                          checked={selected.includes(entry.sku)}
                          onChange={(event) => {
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, entry.sku]
                                : current.filter((sku) => sku !== entry.sku),
                            )
                            setConfirm(false)
                          }}
                        />
                      </td>
                      <td>{entry.sku}</td>
                      <td>
                        <ChangeValues
                          before={entry.before}
                          desired={entry.desired}
                        />
                      </td>
                      <td>
                        <span
                          className={`status ${entry.status === 'blocked' ? 'error' : 'neutral'}`}
                        >
                          {entry.status === 'blocked'
                            ? 'Gesperrt'
                            : entry.status === 'unchanged'
                              ? 'Unveraendert'
                              : 'Aenderung'}
                        </span>
                        <small>{entry.message}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="dialog-actions">
              <button
                className="button primary"
                disabled={busy || !selected.length}
                onClick={() => setConfirm(true)}
              >
                <Upload size={16} />
                {selected.length} Produkte freigeben
              </button>
            </div>
          </>
        )}
        {confirm && (
          <div className="transfer-confirm">
            <h3>Shopdaten wirklich aendern?</h3>
            <p>
              {selected.length} Produkte auf {plan?.url}. Nur die in der
              Vorschau gezeigten Preis-/Bestandswerte werden geschrieben. Der
              API-Schluessel braucht Lesen/Schreiben.
            </p>
            <div className="dialog-actions">
              <button className="button" onClick={() => setConfirm(false)}>
                Abbrechen
              </button>
              <button className="button primary" onClick={() => void execute()}>
                Bestaetigen und uebertragen
              </button>
            </div>
          </div>
        )}
        {run && (
          <div role="status">
            <h3>Uebertragung dokumentiert</h3>
            <ul className="transfer-results">
              {run.items.map((item) => (
                <li key={item.id}>
                  <strong>{item.sku}</strong>
                  <span
                    className={`status ${item.status === 'success' ? 'success' : item.status === 'failed' || item.status === 'conflict' ? 'error' : 'neutral'}`}
                  >
                    {transferLabels[item.status]}
                  </span>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="dialog-actions">
          <button className="button" disabled={busy} onClick={onHistory}>
            Historie oeffnen
          </button>
          <button className="button" disabled={busy} onClick={onClose}>
            Schliessen
          </button>
        </div>
      </div>
    </Dialog>
  )
}
