import { useEffect, useState } from 'react'
import {
  CircleAlert,
  Database,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react'
import { Dialog } from './Dialog'
import type {
  DatabaseResult,
  ProjectSnapshot,
  ProjectSummary,
  SavedProject,
} from '../types/desktop'

function unwrap<Value>(result: DatabaseResult<Value>): Value {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

export function ProjectsDialog({
  snapshot,
  active,
  onSaved,
  onOpen,
  onDeleted,
  onClose,
}: {
  snapshot: ProjectSnapshot | null
  active: ProjectSummary | null
  onSaved: (summary: ProjectSummary, snapshot: ProjectSnapshot) => void
  onOpen: (project: SavedProject) => void
  onDeleted: (id: string) => void
  onClose: () => void
}) {
  const desktop = window.catalogDesktop
  const [name, setName] = useState(
    active?.name ?? snapshot?.filename.replace(/\.(csv|tsv)$/i, '') ?? '',
  )
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [databasePath, setDatabasePath] = useState('')
  const [loading, setLoading] = useState(Boolean(desktop))
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null)

  useEffect(() => {
    if (!desktop) return
    let canceled = false
    Promise.all([desktop.listProjects(), desktop.databaseInfo()])
      .then(([list, info]) => {
        const items = unwrap(list)
        const details = unwrap(info)
        if (!canceled) {
          setProjects(items)
          setDatabasePath(details.path)
          setLoading(false)
        }
      })
      .catch((reason) => {
        if (!canceled) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Datenbank nicht verfuegbar.',
          )
          setLoading(false)
        }
      })
    return () => {
      canceled = true
    }
  }, [desktop])

  async function execute(action: () => Promise<void>) {
    setWorking(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Datenbankoperation fehlgeschlagen.',
      )
    } finally {
      setWorking(false)
    }
  }
  async function save(copy = false) {
    if (!desktop || !snapshot) return
    await execute(async () => {
      const saved = unwrap(
        await desktop.saveProject({
          name,
          snapshot,
          ...(!copy && active
            ? { id: active.id, revision: active.revision }
            : {}),
        }),
      )
      onSaved(saved, snapshot)
      setProjects((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ])
      setNotice('Projekt in SQLite gespeichert.')
    })
  }

  return (
    <Dialog
      title="Importprojekte"
      onClose={() => {
        if (!working) onClose()
      }}
    >
      <div className="shop-mode">
        <Database size={17} />
        <span>Lokale SQLite-Datenbank</span>
      </div>
      {!desktop && (
        <div className="banner warning" role="status">
          <CircleAlert size={17} />
          <span>
            Gespeicherte Projekte sind nur in der Electron-App verfuegbar.
          </span>
        </div>
      )}
      {error && (
        <div className="banner danger" role="alert">
          <CircleAlert size={17} />
          <span>{error}</span>
        </div>
      )}
      {snapshot && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <label className="field">
            <span>Projektname</span>
            <input
              required
              maxLength={80}
              value={name}
              disabled={!desktop || working || loading}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="project-save-actions">
            <button
              className="button primary"
              disabled={!desktop || working || loading || !name.trim()}
              type="submit"
            >
              <Save size={16} />
              {active ? 'Projekt aktualisieren' : 'Projekt speichern'}
            </button>
            {active && (
              <button
                className="button"
                type="button"
                disabled={working || loading || !name.trim()}
                onClick={() => void save(true)}
              >
                Kopie speichern
              </button>
            )}
          </div>
        </form>
      )}
      {notice && (
        <p className="project-notice" role="status">
          {notice}
        </p>
      )}
      <div className="project-list-head">
        <h3>
          Gespeichert{' '}
          <span className="subtle-count">{projects.length}/100</span>
        </h3>
        <button
          className="icon-button"
          title="Liste aktualisieren"
          aria-label="Projektliste aktualisieren"
          disabled={!desktop || working || loading}
          onClick={() =>
            void execute(async () => {
              setProjects(unwrap(await desktop!.listProjects()))
            })
          }
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {loading ? (
        <div className="project-empty">
          <LoaderCircle className="spin" size={18} />
          Datenbank wird geladen ...
        </div>
      ) : !projects.length ? (
        <p className="muted-text">Keine Projekte gespeichert.</p>
      ) : (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <div>
                <strong>{project.name}</strong>
                <span>
                  {project.productCount.toLocaleString('de-DE')} Produkte
                  &middot; {project.filename}
                </span>
                <time dateTime={project.updatedAt}>
                  {new Date(project.updatedAt).toLocaleString('de-DE')}
                </time>
              </div>
              <button
                className="icon-button"
                title="Projekt oeffnen"
                aria-label={`Projekt ${project.name} oeffnen`}
                disabled={working}
                onClick={() =>
                  void execute(async () => {
                    onOpen(unwrap(await desktop!.loadProject(project.id)))
                  })
                }
              >
                <FolderOpen size={17} />
              </button>
              <button
                className="icon-button"
                title="Projekt loeschen"
                aria-label={`Projekt ${project.name} loeschen`}
                disabled={working}
                onClick={() => setDeleting(project)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <div className="project-delete">
          <p>
            <strong>{deleting.name}</strong> dauerhaft aus der Datenbank
            loeschen?
          </p>
          <div className="dialog-actions">
            <button
              className="button"
              disabled={working}
              onClick={() => setDeleting(null)}
            >
              Abbrechen
            </button>
            <button
              className="button"
              disabled={working}
              onClick={() =>
                void execute(async () => {
                  unwrap(
                    await desktop!.deleteProject({
                      id: deleting.id,
                      revision: deleting.revision,
                    }),
                  )
                  setProjects((current) =>
                    current.filter((item) => item.id !== deleting.id),
                  )
                  onDeleted(deleting.id)
                  setDeleting(null)
                  setNotice('Projekt geloescht.')
                })
              }
            >
              <Trash2 size={15} />
              Endgueltig loeschen
            </button>
          </div>
        </div>
      )}
      {databasePath && (
        <div className="database-location">
          <span>Datenbankdatei</span>
          <code>{databasePath}</code>
        </div>
      )}
      <div className="dialog-actions">
        <button className="button" disabled={working} onClick={onClose}>
          Schliessen
        </button>
      </div>
    </Dialog>
  )
}
