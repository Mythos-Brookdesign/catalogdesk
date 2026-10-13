import { useEffect, useState } from 'react'
import { KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'
import App from '../App'
import type { AppUser } from '../types/desktop'

type AuthState = { setupRequired: boolean; user: AppUser | null }

export function AuthGate() {
  const desktop = window.catalogDesktop
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [loading, setLoading] = useState(Boolean(desktop))
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!desktop) return
    let cancelled = false
    const unsubscribe = desktop.onAuthExpired(() => {
      setAuth({ setupRequired: false, user: null })
      setPassword('')
      setConfirmation('')
      setError('Deine Sitzung ist abgelaufen. Bitte erneut anmelden.')
    })
    desktop
      .authState()
      .then((result) => {
        if (!cancelled) setAuth(result)
      })
      .catch(() => {
        if (!cancelled)
          setError('Lokale Benutzerkonten konnten nicht geladen werden.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [desktop])

  if (!desktop) return <App />
  if (loading || !auth)
    return (
      <main className="auth-shell">
        <div className="auth-panel auth-loading">
          <LoaderCircle className="spin" size={22} />
          <span>Sichere lokale Anmeldung wird geladen ...</span>
        </div>
      </main>
    )
  if (auth.user)
    return (
      <App
        currentUser={auth.user}
        onLogout={async () => {
          await desktop.logout()
          setPassword('')
          setConfirmation('')
          setError('')
          setAuth({ setupRequired: false, user: null })
        }}
      />
    )

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (auth!.setupRequired && password !== confirmation) {
      setError('Die Passwoerter stimmen nicht ueberein.')
      return
    }
    setBusy(true)
    try {
      const result = auth!.setupRequired
        ? await desktop!.bootstrapAdmin({ username, displayName, password })
        : await desktop!.login({ username, password })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAuth({ setupRequired: false, user: result.user })
      setPassword('')
      setConfirmation('')
    } catch {
      setError('Anmeldung fehlgeschlagen. Bitte erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <img src="./icon.png" width="48" height="48" alt="" />
        <span className="eyebrow">
          CATALOGDESK &middot; LOKALER ARBEITSBEREICH
        </span>
        <h1 id="auth-title">
          {auth.setupRequired ? 'Administrator einrichten' : 'Anmelden'}
        </h1>
        <p>
          {auth.setupRequired
            ? 'Lege das erste persoenliche Konto fuer diesen App-Arbeitsbereich an.'
            : 'Melde dich mit deinem lokalen CatalogDesk-Konto an.'}
        </p>
        <div className="auth-security">
          <ShieldCheck size={16} />
          <span>Konten und Shopdaten bleiben auf diesem Computer.</span>
        </div>
        <form onSubmit={(formEvent) => void submit(formEvent)}>
          <label className="field">
            <span>Benutzername</span>
            <input
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9._-]+"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          {auth.setupRequired && (
            <label className="field">
              <span>Anzeigename</span>
              <input
                required
                maxLength={80}
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
          )}
          <label className="field">
            <span>Passwort</span>
            <input
              required
              minLength={12}
              maxLength={128}
              type="password"
              autoComplete={
                auth.setupRequired ? 'new-password' : 'current-password'
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {auth.setupRequired && <small>Mindestens 12 Zeichen</small>}
          </label>
          {auth.setupRequired && (
            <label className="field">
              <span>Passwort wiederholen</span>
              <input
                required
                minLength={12}
                maxLength={128}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          )}
          {error && (
            <div className="banner danger" role="alert">
              {error}
            </div>
          )}
          <button
            className="button primary auth-submit"
            disabled={
              busy ||
              !username ||
              !password ||
              (auth.setupRequired && (!displayName || !confirmation))
            }
            type="submit"
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <KeyRound size={17} />
            )}
            {auth.setupRequired ? 'Administrator einrichten' : 'Anmelden'}
          </button>
        </form>
      </section>
    </main>
  )
}
