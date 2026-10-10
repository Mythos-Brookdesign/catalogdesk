import { useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Eye,
  EyeOff,
  LoaderCircle,
  PlugZap,
  ShieldCheck,
} from 'lucide-react'
import { Dialog } from './Dialog'
import type { ShopConnectionResult } from '../types/desktop'

export type CheckedShop = Extract<ShopConnectionResult, { ok: true }>

export function ShopConnectionDialog({
  checked,
  onChecked,
  onClose,
}: {
  checked: CheckedShop | null
  onChecked: (result: CheckedShop | null) => void
  onClose: () => void
}) {
  const desktop = window.catalogDesktop
  const [url, setUrl] = useState(checked?.url ?? 'https://catalogdesk.local')
  const [consumerKey, setConsumerKey] = useState('')
  const [consumerSecret, setConsumerSecret] = useState('')
  const [visible, setVisible] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')

  function resetResult() {
    setError('')
    onChecked(null)
  }

  async function test() {
    if (!desktop || testing) return
    setTesting(true)
    setError('')
    onChecked(null)
    try {
      const result = await desktop.testShopConnection({
        url: url.trim(),
        consumerKey: consumerKey.trim(),
        consumerSecret: consumerSecret.trim(),
      })
      if (result.ok) {
        onChecked(result)
        setUrl(result.url)
        setConsumerKey('')
        setConsumerSecret('')
        setVisible(false)
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
        if (!testing) onClose()
      }}
    >
      <div className="shop-mode">
        <ShieldCheck size={16} />
        <span>WooCommerce REST API</span>
        <span className="status neutral">Nur lesen</span>
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
          void test()
        }}
      >
        <fieldset disabled={!desktop || testing}>
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
                resetResult()
              }}
            />
          </label>
          <label className="field">
            <span>Consumer Key</span>
            <input
              type={visible ? 'text' : 'password'}
              required
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              pattern="ck_[a-f0-9]{40}"
              maxLength={43}
              placeholder="ck_..."
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
              required
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              pattern="cs_[a-f0-9]{40}"
              maxLength={43}
              placeholder="cs_..."
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
            <button
              className="button primary"
              type="submit"
              disabled={!consumerKey || !consumerSecret || !url || testing}
            >
              {testing ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <PlugZap size={17} />
              )}
              {testing ? 'Verbindung wird geprueft ...' : 'Verbindung pruefen'}
            </button>
          </div>
        </fieldset>
      </form>
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
        <strong>Nur f&uuml;r diesen Test</strong>
      </div>
      <div className="dialog-actions">
        <button
          className="button"
          disabled={testing}
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
