import { useEffect, useState } from 'react'
import { LoaderCircle, UserPlus, UserRound, UserX } from 'lucide-react'
import { Dialog } from './Dialog'
import type { AppRole, DatabaseResult, UserRecord } from '../types/desktop'

function unwrap<Value>(result: DatabaseResult<Value>): Value {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

export function UsersDialog({
  currentUser,
  onClose,
}: {
  currentUser: string
  onClose: () => void
}) {
  const desktop = window.catalogDesktop
  const [users, setUsers] = useState<UserRecord[]>([])
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AppRole>('editor')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!desktop) return
    let cancelled = false
    desktop
      .listUsers()
      .then((result) => {
        if (!cancelled) {
          if (result.ok) setUsers(result.value)
          else setError(result.error)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Benutzerliste konnte nicht geladen werden.')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [desktop])

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!desktop || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = unwrap(
        await desktop.createUser({ username, displayName, password, role }),
      )
      setUsers((current) =>
        [...current, result].sort((a, b) =>
          a.username.localeCompare(b.username),
        ),
      )
      setUsername('')
      setDisplayName('')
      setPassword('')
      setRole('editor')
      setNotice('Benutzer angelegt.')
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Benutzer konnte nicht angelegt werden.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function toggle(user: UserRecord) {
    if (!desktop || busy || user.id === currentUser) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      unwrap(await desktop.setUserActive({ id: user.id, active: !user.active }))
      setUsers((current) =>
        current.map((entry) =>
          entry.id === user.id ? { ...entry, active: !entry.active } : entry,
        ),
      )
      setNotice(`Konto ${user.active ? 'deaktiviert' : 'aktiviert'}.`)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Kontostatus konnte nicht geaendert werden.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Benutzerkonten"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="users-dialog">
        <p className="transfer-note">
          Lokale Konten auf diesem Betriebssystemprofil. Rollen beschraenken
          Aenderungen und Shopuebertragungen.
        </p>
        {error && (
          <div className="banner danger" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p className="project-notice" role="status">
            {notice}
          </p>
        )}
        <h3>
          Benutzer <span className="subtle-count">{users.length}</span>
        </h3>
        {loading ? (
          <p className="project-empty">
            <LoaderCircle className="spin" size={17} />
            Konten werden geladen ...
          </p>
        ) : (
          <ul className="user-list">
            {users.map((user) => (
              <li key={user.id}>
                <UserRound size={18} />
                <div>
                  <strong>{user.displayName}</strong>
                  <span>
                    {user.username} &middot;{' '}
                    {user.role === 'admin'
                      ? 'Administrator'
                      : user.role === 'editor'
                        ? 'Bearbeiter'
                        : 'Leser'}
                    {!user.active ? ' · Deaktiviert' : ''}
                  </span>
                </div>
                <button
                  className="icon-button"
                  title={
                    user.active ? 'Konto deaktivieren' : 'Konto aktivieren'
                  }
                  aria-label={`${user.active ? 'Deaktivieren' : 'Aktivieren'}: ${user.username}`}
                  disabled={busy || user.id === currentUser}
                  onClick={() => void toggle(user)}
                >
                  {user.active ? <UserX size={17} /> : <UserPlus size={17} />}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="user-create" onSubmit={(event) => void create(event)}>
          <h3>Konto anlegen</h3>
          <label className="field">
            <span>Benutzername</span>
            <input
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9._-]+"
              autoCapitalize="none"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Anzeigename</span>
            <input
              required
              maxLength={80}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Startpasswort</span>
            <input
              required
              minLength={12}
              maxLength={128}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <small>
              Mindestens 12 Zeichen; spaeterer Passwortwechsel ist in dieser
              Version noch nicht verfuegbar.
            </small>
          </label>
          <label className="field">
            <span>Rolle</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as AppRole)}
            >
              <option value="reader">
                Leser: Katalog und Historie ansehen
              </option>
              <option value="editor">
                Bearbeiter: lokal bearbeiten und Vorschau erstellen
              </option>
              <option value="admin">
                Administrator: Konten und Shopuebertragungen verwalten
              </option>
            </select>
          </label>
          <button
            className="button primary"
            disabled={busy || !username || !displayName || password.length < 12}
          >
            <UserPlus size={16} />
            Benutzer anlegen
          </button>
        </form>
      </div>
    </Dialog>
  )
}
