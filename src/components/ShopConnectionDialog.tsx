import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Eye,
  EyeOff,
  Download,
  LoaderCircle,
  PlugZap,
  ShieldCheck,
  Save,
  Trash2,
} from 'lucide-react'
import { Dialog } from './Dialog'
import type {
  ImportedShop,
  ShopConnectionResult,
  ShopImportProgress,
} from '../types/desktop'

export type CheckedShop = Extract<ShopConnectionResult, { ok: true }>

export function ShopConnectionDialog({
  checked,
  onChecked,
  onImported,
  canManageConnection = true,
  onClose,
}: {
  checked: CheckedShop | null
  onChecked: (result: CheckedShop | null) => void
  onImported: (result: ImportedShop) => void
  canManageConnection?: boolean
  onClose: () => void
}) {
  const desktop = window.catalogDesktop
  const [url, setUrl] = useState(checked?.url ?? 'https://catalogdesk.local')
  const [consumerKey, setConsumerKey] = useState('')
  const [consumerSecret, setConsumerSecret] = useState('')
  const [visible, setVisible] = useState(false)
  const [testing, setTesting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [action, setAction] = useState<'test' | 'import'>('import')
  const [progress, setProgress] = useState<ShopImportProgress | null>(null)
  const [storedUrl, setStoredUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(desktop))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const reuseStored = Boolean(
    storedUrl && url === storedUrl && !consumerKey && !consumerSecret,
  )
  const busy = testing || importing || loading || saving
  const [error, setError] = useState('')

  useEffect(() => {
    if (!desktop) return
    return desktop.onShopImportProgress(setProgress)
  }, [desktop])

  useEffect(() => {
    if (!desktop) return
    let canceled = false
    desktop
      .savedShopConnection()
      .then((result) => {
        if (canceled) return
        if (result.ok) {
          setStoredUrl(result.value?.url ?? null)
          if (result.value) setUrl(result.value.url)
        } else setError(result.error)
        setLoading(false)
      })
      .catch(() => {
        if (!canceled) {
          setError('Gespeicherte Verbindung konnte nicht geladen werden.')
          setLoading(false)
        }
      })
    return () => {
      canceled = true
    }
  }, [desktop])

  async function saveConnection() {
    if (!desktop || !canManageConnection || busy) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await desktop.saveShopConnection({
        url: url.trim(),
        consumerKey: consumerKey.trim(),
        consumerSecret: consumerSecret.trim(),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setStoredUrl(result.value.url)
      setUrl(result.value.url)
      setConsumerKey('')
      setConsumerSecret('')
      setVisible(false)
      setNotice('Shopverbindung sicher gespeichert.')
    } catch {
      setError('Shopverbindung konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteConnection() {
    if (!desktop || !canManageConnection || busy) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await desktop.deleteShopConnection()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setStoredUrl(null)
      setConsumerKey('')
      setConsumerSecret('')
      setConfirmDelete(false)
      onChecked(null)
      setNotice('Gespeicherte Shopverbindung geloescht.')
    } catch {
      setError('Verbindung konnte nicht geloescht werden.')
    } finally {
      setSaving(false)
    }
  }

  async function importProducts() {
    if (!desktop || busy) return
    setImporting(true)
    setError('')
    setProgress(null)
    onChecked(null)
    try {
      const result = await desktop.importShopProducts(
        reuseStored
          ? null
          : {
              url: url.trim(),
              consumerKey: consumerKey.trim(),
              consumerSecret: consumerSecret.trim(),
            },
      )
      if (result.ok) {
        if (result.credentialsSaved) {
          setConsumerKey('')
          setConsumerSecret('')
          setVisible(false)
          setStoredUrl(result.url)
          setNotice('Shopverbindung verwendet und sicher gespeichert.')
        }
        onChecked({
          ok: true,
          url: result.url,
          productCount: result.total,
          checkedAt: result.importedAt,
          credentialsSaved: result.credentialsSaved,
          ...(result.storageError ? { storageError: result.storageError } : {}),
        })
        onImported(result)
      } else {
        setError(result.error)
      }
    } catch {
      setError(
        'Shopimport konnte nicht ausgefuehrt werden. Bitte Electron neu starten.',
      )
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  function resetResult() {
    setError('')
    setNotice('')
    onChecked(null)
  }

  async function test() {
    if (!desktop || busy) return
    setTesting(true)
    setError('')
    onChecked(null)
    try {
      const result = await desktop.testShopConnection(
        reuseStored
          ? null
          : {
              url: url.trim(),
              consumerKey: consumerKey.trim(),
              consumerSecret: consumerSecret.trim(),
            },
      )
      if (result.ok) {
        if (result.credentialsSaved) {
          setConsumerKey('')
          setConsumerSecret('')
          setVisible(false)
          setStoredUrl(result.url)
          setNotice('Shopverbindung geprueft und sicher gespeichert.')
        } else {
          setNotice(
            `Verbindung erfolgreich, aber Zugangsdaten nicht gespeichert: ${result.storageError ?? 'Systemspeicher nicht verfuegbar.'} Bitte Zugangsdaten sicher speichern.`,
          )
        }
        onChecked(result)
        setUrl(result.url)
      } else {
        setError(result.error)
      }
    } catch {
      setError(
        'Der Verbindungstest konnte nicht ausgefuehrt werden. Bitte Electron neu starten und erneut versuchen.',
      )
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog
      title="Shopverbindung"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="shop-mode">
        <ShieldCheck size={16} />
        <span>WooCommerce REST API</span>
        <span className="status neutral">Lesen &amp; Schreiben</span>
      </div>
      {!desktop && (
        <div className="banner warning" role="status">
          <CircleAlert size={17} />
          <span>
            Die Shopverbindung ist nur in der Electron-App verfuegbar.
          </span>
        </div>
      )}
      <form
        className="shop-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (action === 'import') void importProducts()
          else void test()
        }}
      >
        <fieldset disabled={!desktop || busy}>
          <label className="field">
            <span>Shopadresse (HTTPS)</span>
            <input
              type="url"
              required
              autoComplete="off"
              spellCheck={false}
              maxLength={2048}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                setConsumerKey('')
                setConsumerSecret('')
                resetResult()
              }}
            />
          </label>
          <label className="field">
            <span>Consumer Key</span>
            <input
              type={visible ? 'text' : 'password'}
              required={!reuseStored}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              pattern="ck_[a-f0-9]{40}"
              maxLength={43}
              placeholder={reuseStored ? 'Sicher gespeichert' : 'ck_...'}
              value={consumerKey}
              onChange={(event) => {
                setConsumerKey(event.target.value)
                resetResult()
              }}
            />
          </label>
          <label className="field">
            <span>Consumer Secret</span>
            <input
              type={visible ? 'text' : 'password'}
              required={!reuseStored}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              pattern="cs_[a-f0-9]{40}"
              maxLength={43}
              placeholder={reuseStored ? 'Sicher gespeichert' : 'cs_...'}
              value={consumerSecret}
              onChange={(event) => {
                setConsumerSecret(event.target.value)
                resetResult()
              }}
            />
          </label>
          <div className="shop-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={
                visible ? 'Schluessel verbergen' : 'Schluessel anzeigen'
              }
              title={visible ? 'Schluessel verbergen' : 'Schluessel anzeigen'}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <div className="shop-command-actions">
              <button
                className="button"
                type="submit"
                onClick={() => setAction('test')}
                disabled={
                  (!reuseStored && (!consumerKey || !consumerSecret)) ||
                  !url ||
                  busy
                }
              >
                {testing ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <PlugZap size={17} />
                )}
                {testing
                  ? 'Verbindung wird geprueft ...'
                  : 'Verbindung pruefen'}
              </button>
              <button
                className="button primary"
                type="submit"
                onClick={() => setAction('import')}
                disabled={
                  (!reuseStored && (!consumerKey || !consumerSecret)) ||
                  !url ||
                  busy
                }
              >
                <Download size={17} />
                Produkte importieren
              </button>
            </div>
          </div>
          <div className="dialog-actions">
            <button
              className="button"
              type="button"
              disabled={
                !canManageConnection ||
                !consumerKey ||
                !consumerSecret ||
                !url ||
                busy
              }
              onClick={() => void saveConnection()}
            >
              <Save size={16} />
              Verbindung speichern
            </button>
          </div>
        </fieldset>
      </form>
      {notice && (
        <p className="project-notice" role="status">
          {notice}
        </p>
      )}
      {storedUrl && (
        <div className="shop-footer">
          <span className="shop-url">Gespeichert: {storedUrl}</span>
          {canManageConnection && (
            <button
              className="icon-button"
              type="button"
              title="Gespeicherte Verbindung loeschen"
              aria-label="Gespeicherte Verbindung loeschen"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={17} />
            </button>
          )}
        </div>
      )}
      {confirmDelete && (
        <div className="project-delete">
          <p>Gespeicherte Shopverbindung dauerhaft loeschen?</p>
          <div className="dialog-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Abbrechen
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void deleteConnection()}
            >
              Verbindung endgueltig loeschen
            </button>
          </div>
        </div>
      )}
      {importing && (
        <div className="shop-import-progress" role="status">
          <div>
            <LoaderCircle className="spin" size={17} />
            <span>
              {progress
                ? `${progress.loaded.toLocaleString('de-DE')} / ${progress.total.toLocaleString('de-DE')} Produkte geladen`
                : 'Shopprodukte werden geladen ...'}
            </span>
          </div>
          <progress
            aria-label="Shopimport-Fortschritt"
            value={progress?.loaded ?? 0}
            max={Math.max(1, progress?.total ?? 1)}
          />
          <button
            className="button"
            type="button"
            onClick={() => {
              void desktop
                ?.cancelShopImport()
                .catch(() =>
                  setError('Abbruch fehlgeschlagen. Bitte erneut versuchen.'),
                )
            }}
          >
            Import abbrechen
          </button>
        </div>
      )}
      {error && (
        <div className="banner danger" role="alert">
          <CircleAlert size={17} />
          <span>{error}</span>
        </div>
      )}
      {checked && (
        <div className="shop-result" role="status">
          <CheckCircle2 size={22} />
          <div>
            <h3>Verbindung gepr&uuml;ft</h3>
            <span>
              {checked.productCount.toLocaleString('de-DE')} Produkte in der API
            </span>
            <span className="shop-url">{checked.url}</span>
            <time dateTime={checked.checkedAt}>
              {new Date(checked.checkedAt).toLocaleString('de-DE')}
            </time>
          </div>
        </div>
      )}
      <div className="shop-footer">
        <span className="muted-text">Schl&uuml;sselspeicherung</span>
        <strong>
          {storedUrl ? 'Systemsicher verschluesselt' : 'Noch nicht gespeichert'}
        </strong>
      </div>
      <div className="dialog-actions">
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setConsumerKey('')
            setConsumerSecret('')
            onClose()
          }}
        >
          Schliessen
        </button>
      </div>
    </Dialog>
  )
}
