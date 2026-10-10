import { useDeferredValue, useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Download,
  Database,
  FileCheck2,
  FileSpreadsheet,
  FolderOpen,
  HardDrive,
  ListFilter,
  LoaderCircle,
  Package,
  Pencil,
  PlugZap,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import {
  defaultOptions,
  emptyMapping,
  fields,
  MAX_FILE_SIZE,
  suggestMapping,
} from './domain/catalog'
import type {
  Analysis,
  CatalogRow,
  Dataset,
  Mapping,
  Options,
  Product,
} from './domain/catalog'
import { demoCsv, demoImages, demoName } from './data/demo'
import { Dialog } from './components/Dialog'
import { ProjectsDialog } from './components/ProjectsDialog'
import type {
  ProjectSnapshot,
  ProjectSummary,
  SavedProject,
} from './types/desktop'
import { ShopConnectionDialog } from './components/ShopConnectionDialog'
import type { CheckedShop } from './components/ShopConnectionDialog'
import { createProfile, loadProfiles, saveProfiles } from './lib/profiles'
import type { Profile } from './lib/profiles'
import { useCatalogWorker } from './lib/worker'

type View = 'catalog' | 'mapping' | 'export'
type Filter = 'all' | 'valid' | 'errors' | 'changed' | 'excluded'
type ImportFile = { name: string; content: string; demo: boolean }
const formatNumber = (value: number) => value.toLocaleString('de-DE')
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Ein unerwarteter Fehler ist aufgetreten.'
const filterLabels: Record<Filter, string> = {
  all: 'Alle',
  valid: 'Bereit',
  errors: 'Fehler',
  changed: 'Angepasst',
  excluded: 'Ausgeschlossen',
}

function Status({ row }: { row: CatalogRow }) {
  if (row.excluded)
    return (
      <span className="status muted">
        <X size={13} />
        Ausgeschlossen
      </span>
    )
  if (row.issues.length)
    return (
      <span className="status error">
        <CircleAlert size={13} />
        {row.issues.length} Fehler
      </span>
    )
  return (
    <span className="status success">
      <Check size={13} />
      Bereit
    </span>
  )
}

function RowEditor({
  row,
  draftValues,
  options,
  onSave,
  onExclude,
  onClose,
  busy,
}: {
  row: CatalogRow
  draftValues: Product
  options: Options
  onSave: (draft: Product) => void
  onExclude: () => void
  onClose: () => void
  busy: boolean
}) {
  const [draft, setDraft] = useState<Product>(draftValues)
  return (
    <>
      <button
        className="inspector-scrim"
        aria-label="Editor schliessen"
        onClick={onClose}
      />
      <aside className="inspector" aria-label="Produkt bearbeiten">
        <div className="inspector-head">
          <div>
            <span className="eyebrow">DATENSATZ {row.index + 1}</span>
            <h2>Produktdetails</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Editor schliessen"
            title="Schliessen"
          >
            <X size={18} />
          </button>
        </div>
        <div className="inspector-summary">
          <Status row={row} />
          <span className="mono">
            {row.product.sku || 'Ohne Artikelnummer'}
          </span>
        </div>
        {row.issues.length > 0 && (
          <ul className="issue-list">
            {row.issues.map((issue, index) => (
              <li key={`${issue.field}-${index}`}>
                <CircleAlert size={15} />
                <div>
                  <strong>
                    {fields.find((field) => field.key === issue.field)?.label}
                  </strong>
                  <span>{issue.message}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSave(draft)
          }}
        >
          <div className="editor-fields">
            {fields.map(({ key, label, required }) => (
              <label className="field" key={key}>
                <span>
                  {label}
                  {required && <span className="required"> *</span>}
                  {key === 'price' && (
                    <small>
                      {options.priceFormat === 'de' ? '1.234,50' : '1,234.50'}
                    </small>
                  )}
                </span>
                {key === 'description' ? (
                  <textarea
                    rows={3}
                    value={draft[key]}
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.target.value })
                    }
                  />
                ) : (
                  <input
                    value={draft[key]}
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.target.value })
                    }
                    inputMode={
                      key === 'price'
                        ? 'decimal'
                        : key === 'stock'
                          ? 'numeric'
                          : 'text'
                    }
                  />
                )}
                {row.changes.includes(key) && (
                  <span className="value-change">
                    <span className="old-value" title={row.original[key]}>
                      {row.original[key] || '(leer)'}
                    </span>
                    <ArrowRight size={12} />
                    <span>{row.product[key] || '(leer)'}</span>
                  </span>
                )}
              </label>
            ))}
          </div>
          <div className="editor-actions">
            <button type="submit" className="button primary" disabled={busy}>
              <Check size={16} />
              Korrektur &uuml;bernehmen
            </button>
            <button
              type="button"
              className="button subtle"
              disabled={busy}
              onClick={onExclude}
            >
              {row.excluded ? <RotateCcw size={16} /> : <X size={16} />}
              {row.excluded ? 'Wieder aufnehmen' : 'Datensatz ausschliessen'}
            </button>
          </div>
        </form>
      </aside>
    </>
  )
}

export default function App() {
  const request = useCatalogWorker()
  const fileInput = useRef<HTMLInputElement>(null)
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [filename, setFilename] = useState('')
  const [isDemo, setIsDemo] = useState(false)
  const [mapping, setMapping] = useState<Mapping>(emptyMapping)
  const [options, setOptions] = useState<Options>(defaultOptions)
  const [edits, setEdits] = useState<Record<number, Partial<Product>>>({})
  const [excluded, setExcluded] = useState<number[]>([])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [view, setView] = useState<View>('catalog')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [sort, setSort] = useState('source')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [dragging, setDragging] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles)
  const [profileId, setProfileId] = useState('')
  const [profileDialog, setProfileDialog] = useState(false)
  const [projectsDialog, setProjectsDialog] = useState(false)
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(
    null,
  )
  const [savedSnapshot, setSavedSnapshot] = useState<ProjectSnapshot | null>(
    null,
  )
  const [pendingProject, setPendingProject] = useState<SavedProject | null>(
    null,
  )
  const [shopDialog, setShopDialog] = useState(false)
  const [checkedShop, setCheckedShop] = useState<CheckedShop | null>(null)
  const [profileName, setProfileName] = useState('')
  const [pendingImport, setPendingImport] = useState<ImportFile | null>(null)
  const [pendingMapping, setPendingMapping] = useState<{
    mapping: Mapping
    options: Options
    id: string
  } | null>(null)
  const busy = importing || analyzing || exporting
  const dirty = Object.keys(edits).length > 0 || excluded.length > 0
  const snapshot: ProjectSnapshot | null = dataset
    ? { filename, demo: isDemo, dataset, mapping, options, edits, excluded }
    : null
  const projectDirty = Boolean(
    snapshot &&
    (!savedSnapshot ||
      snapshot.dataset !== savedSnapshot.dataset ||
      snapshot.mapping !== savedSnapshot.mapping ||
      snapshot.options !== savedSnapshot.options ||
      snapshot.edits !== savedSnapshot.edits ||
      snapshot.excluded !== savedSnapshot.excluded),
  )
  const canExport = Boolean(
    analysis &&
    !busy &&
    !analysis.missing.length &&
    !analysis.invalid &&
    analysis.valid > 0,
  )

  useEffect(() => {
    if (!dataset) return
    let canceled = false
    request<Analysis>('analyze', { dataset, mapping, options, edits, excluded })
      .then((result) => {
        if (!canceled) {
          setAnalysis(result)
          setAnalyzing(false)
        }
      })
      .catch((reason) => {
        if (!canceled) {
          setError(message(reason))
          setAnalyzing(false)
        }
      })
    return () => {
      canceled = true
    }
  }, [dataset, mapping, options, edits, excluded, request])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  async function performImport(file: ImportFile) {
    setImporting(true)
    setError('')
    try {
      if (new Blob([file.content]).size > MAX_FILE_SIZE)
        throw new Error('Maximal 10 MB pro CSV-Datei.')
      if (file.content.includes('\uFFFD'))
        throw new Error(
          'Die Datei ist nicht gueltig UTF-8-kodiert. Bitte als UTF-8-CSV speichern.',
        )
      const parsed = await request<Dataset>('parse', file.content)
      setDataset(parsed)
      setActiveProject(null)
      setSavedSnapshot(null)
      setFilename(file.name)
      setIsDemo(file.demo)
      setMapping(suggestMapping(parsed.headers))
      setOptions(defaultOptions)
      setEdits({})
      setExcluded([])
      invalidateAnalysis()
      setProfileId('')
      setFilter('all')
      setSearch('')
      setPage(0)
      setSort('source')
      setSelected(null)
      setView('catalog')
      setToast(`${formatNumber(parsed.rows.length)} Produkte importiert.`)
    } catch (reason) {
      setError(message(reason))
    } finally {
      setImporting(false)
    }
  }

  function queueImport(file: ImportFile) {
    if (dirty || (window.catalogDesktop && projectDirty)) setPendingImport(file)
    else void performImport(file)
  }

  function restoreProject(project: SavedProject) {
    const saved = project.snapshot
    setDataset(saved.dataset)
    setFilename(saved.filename)
    setIsDemo(saved.demo)
    setMapping(saved.mapping)
    setOptions(saved.options)
    setEdits(saved.edits)
    setExcluded(saved.excluded)
    setActiveProject(project)
    setSavedSnapshot(saved)
    setProfileId('')
    invalidateAnalysis()
    setFilter('all')
    setSearch('')
    setPage(0)
    setSort('source')
    setSelected(null)
    setView('catalog')
    setError('')
    setToast('Gespeichertes Projekt geoeffnet.')
  }

  function openSavedProject(project: SavedProject) {
    setProjectsDialog(false)
    if (projectDirty) setPendingProject(project)
    else restoreProject(project)
  }

  async function readBrowserFile(file?: File) {
    if (!file) return
    try {
      if (!/\.(csv|tsv)$/i.test(file.name))
        throw new Error('Bitte eine CSV- oder TSV-Datei auswaehlen.')
      if (file.size > MAX_FILE_SIZE)
        throw new Error('Maximal 10 MB pro CSV-Datei.')
      queueImport({ name: file.name, content: await file.text(), demo: false })
    } catch (reason) {
      setError(message(reason))
    }
  }

  async function openFile() {
    if (!window.catalogDesktop) {
      fileInput.current?.click()
      return
    }
    try {
      const file = await window.catalogDesktop.openCsv()
      if (file) queueImport({ ...file, demo: false })
    } catch (reason) {
      setError(message(reason))
    }
  }

  function navigate(next: View) {
    setView(next)
    setSelected(null)
  }
  function changeFilter(next: Filter) {
    setFilter(next)
    setPage(0)
    setSelected(null)
  }
  function invalidateAnalysis() {
    setAnalysis(null)
    setAnalyzing(true)
  }

  function toggleExclude(index: number) {
    invalidateAnalysis()
    setExcluded((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index],
    )
    setSelected(null)
  }

  function applyMapping(next: {
    mapping: Mapping
    options: Options
    id: string
  }) {
    invalidateAnalysis()
    setMapping(next.mapping)
    setOptions(next.options)
    setProfileId(next.id)
    setEdits({})
    setExcluded([])
    setSelected(null)
  }

  function queueMapping(next: {
    mapping: Mapping
    options: Options
    id: string
  }) {
    if (dirty) setPendingMapping(next)
    else applyMapping(next)
  }

  function persistProfile() {
    try {
      const profile = createProfile(profileName, mapping, options)
      const existing = profiles.find(
        (item) => item.name.toLowerCase() === profile.name.toLowerCase(),
      )
      const next = existing
        ? profiles.map((item) =>
            item.id === existing.id ? { ...profile, id: existing.id } : item,
          )
        : [...profiles, profile]
      saveProfiles(next)
      setProfiles(next)
      setProfileId(existing?.id ?? profile.id)
      setProfileDialog(false)
      setProfileName('')
      setToast('Zuordnungsprofil gespeichert.')
    } catch {
      setError(
        'Profil konnte nicht gespeichert werden. Maximal 20 Profile mit Namen bis 60 Zeichen sind erlaubt; lokaler Speicher muss verfuegbar sein.',
      )
    }
  }

  async function saveExport(report = false) {
    if (!analysis || busy || (!report && !canExport)) return
    setExporting(true)
    setError('')
    try {
      const content = await request<string>(
        report ? 'report' : 'export',
        analysis,
      )
      const name = report
        ? 'catalogdesk-pruefbericht.csv'
        : 'catalogdesk-woocommerce.csv'
      if (window.catalogDesktop) {
        if (!(await window.catalogDesktop.saveCsv({ filename: name, content })))
          return
      } else {
        const url = URL.createObjectURL(
          new Blob([content], { type: 'text/csv;charset=utf-8' }),
        )
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = name
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      setToast(
        report ? 'Pruefbericht gespeichert.' : 'WooCommerce-CSV gespeichert.',
      )
    } catch (reason) {
      setError(message(reason))
    } finally {
      setExporting(false)
    }
  }

  const query = deferredSearch.toLocaleLowerCase('de-DE')
  const filtered = (analysis?.rows ?? []).filter((row) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'valid' && !row.excluded && !row.issues.length) ||
      (filter === 'errors' && !row.excluded && row.issues.length > 0) ||
      (filter === 'changed' && !row.excluded && row.changes.length > 0) ||
      (filter === 'excluded' && row.excluded)
    return (
      matchesFilter &&
      (!query ||
        Object.values(row.product).some((value) =>
          value.toLocaleLowerCase('de-DE').includes(query),
        ))
    )
  })
  if (sort !== 'source')
    filtered.sort((left, right) =>
      left.product[sort as 'name' | 'sku'].localeCompare(
        right.product[sort as 'name' | 'sku'],
        'de',
        { numeric: true },
      ),
    )
  const lastPage = Math.max(0, Math.ceil(filtered.length / 20) - 1)
  const currentPage = Math.min(page, lastPage)
  const visible = filtered.slice(currentPage * 20, (currentPage + 1) * 20)
  const selectedRow = selected === null ? undefined : analysis?.rows[selected]
  const counts: Record<Filter, number> = {
    all: dataset?.rows.length ?? 0,
    valid: analysis?.valid ?? 0,
    errors: analysis?.invalid ?? 0,
    changed: analysis?.changed ?? 0,
    excluded: analysis?.excluded ?? 0,
  }

  return (
    <div className={`app ${selectedRow ? 'with-inspector' : ''}`}>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,.tsv,text/csv"
        className="sr-only"
        aria-label="CSV-Datei auswaehlen"
        onChange={(event) => {
          void readBrowserFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <aside className="sidebar">
        <div className="brand">
          <img src="./icon.png" width="36" height="36" alt="" />
          <div>
            CatalogDesk<span>PRODUCT DATA STUDIO</span>
          </div>
        </div>
        <span className="nav-label">ARBEITSBEREICH</span>
        <nav aria-label="Hauptnavigation">
          <button
            className={`nav-item ${view === 'catalog' ? 'active' : ''}`}
            aria-current={view === 'catalog' ? 'page' : undefined}
            onClick={() => navigate('catalog')}
          >
            <Package size={18} />
            Produktkatalog
            {dataset && (
              <span className="nav-count">
                {formatNumber(dataset.rows.length)}
              </span>
            )}
          </button>
          <button
            className={`nav-item ${view === 'mapping' ? 'active' : ''}`}
            aria-current={view === 'mapping' ? 'page' : undefined}
            onClick={() => navigate('mapping')}
          >
            <SlidersHorizontal size={18} />
            Spaltenzuordnung
          </button>
          <button
            className={`nav-item ${view === 'export' ? 'active' : ''}`}
            aria-current={view === 'export' ? 'page' : undefined}
            onClick={() => navigate('export')}
          >
            <ArrowDownToLine size={18} />
            Export
          </button>
        </nav>
        <div className="sidebar-divider" />
        <button
          className="nav-item"
          onClick={() => {
            setProfileName(
              profiles.find((item) => item.id === profileId)?.name ?? '',
            )
            setProfileDialog(true)
          }}
        >
          <ClipboardList size={18} />
          Zuordnungsprofile<span className="nav-count">{profiles.length}</span>
        </button>
        {dataset && (
          <div className="source-info">
            <span className="nav-label">AKTUELLE QUELLE</span>
            <FileSpreadsheet size={20} />
            <strong title={filename}>{filename}</strong>
            <span>
              UTF-8 &middot;{' '}
              {dataset.delimiter === '\t'
                ? 'Tabulator'
                : dataset.delimiter === ';'
                  ? 'Semikolon'
                  : 'Komma'}
            </span>
          </div>
        )}
        <div className="sidebar-footer">
          <HardDrive size={17} />
          <div>
            Lokaler Arbeitsbereich<span>CatalogDesk 0.1.0</span>
          </div>
          <span className="online-dot" />
        </div>
      </aside>

      <main
        className={`workspace ${dragging ? 'drop-active' : ''}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (!busy) void readBrowserFile(event.dataTransfer.files[0])
        }}
      >
        <header className="topbar">
          <div className="breadcrumb">
            <span>Arbeitsbereich</span>
            <ChevronRight size={14} />
            <strong>
              {view === 'catalog'
                ? 'Produktkatalog'
                : view === 'mapping'
                  ? 'Spaltenzuordnung'
                  : 'Export'}
            </strong>
          </div>
          <div className="topbar-actions">
            <button
              className="button shop-trigger"
              aria-label="Importprojekte"
              title="Gespeicherte Importprojekte"
              onClick={() => setProjectsDialog(true)}
            >
              <Database size={16} />
              <span>Importprojekte</span>
            </button>
            <span className="local-status">
              <ShieldCheck size={15} />
              Lokale Daten
            </span>
            <button
              className={`button shop-trigger ${checkedShop ? 'shop-checked' : ''}`}
              onClick={() => setShopDialog(true)}
              title="WooCommerce-Shopverbindung"
              aria-label="Shopverbindung"
            >
              {checkedShop ? <CheckCircle2 size={16} /> : <PlugZap size={16} />}
              <span>Shopverbindung</span>
            </button>
          </div>
        </header>
        <div className="page-head">
          <div>
            <span className="eyebrow">
              {dataset
                ? 'IMPORT / ' + (isDemo ? 'NORDLICHT' : 'PRODUKTDATEN')
                : 'NEUER ARBEITSBEREICH'}
            </span>
            <h1>
              {view === 'catalog'
                ? 'Produktkatalog'
                : view === 'mapping'
                  ? 'Spaltenzuordnung'
                  : 'Export vorbereiten'}
            </h1>
            <p>{dataset ? filename : 'Kein Import geoeffnet'}</p>
            {dataset && window.catalogDesktop && (
              <span className="project-state">
                {projectDirty
                  ? 'Ungespeicherter Arbeitsstand'
                  : `Gespeichert: ${activeProject?.name}`}
              </span>
            )}
          </div>
          <div className="head-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => void openFile()}
            >
              <FolderOpen size={16} />
              {dataset ? 'Neue Datei' : 'Datei oeffnen'}
            </button>
            {dataset && (
              <button
                className="button"
                disabled={busy || !window.catalogDesktop}
                onClick={() => setProjectsDialog(true)}
              >
                <Save size={16} />
                Projekt speichern
              </button>
            )}
            {dataset && (
              <button
                className="button primary"
                onClick={() => navigate('export')}
              >
                <ArrowUpFromLine size={16} />
                Zum Export
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="banner danger" role="alert">
            <CircleAlert size={18} />
            <span>{error}</span>
            <button
              className="icon-button"
              title="Meldung schliessen"
              aria-label="Fehlermeldung schliessen"
              onClick={() => setError('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {analysis?.missing.length ? (
          <div className="banner warning">
            <CircleAlert size={18} />
            <span>
              Pflichtspalten fehlen:{' '}
              {analysis.missing
                .map((key) => fields.find((field) => field.key === key)?.label)
                .join(', ')}
              .
            </span>
            <button className="text-button" onClick={() => navigate('mapping')}>
              Zuordnung pr&uuml;fen
              <ArrowRight size={15} />
            </button>
          </div>
        ) : null}

        {!dataset ? (
          <section className="empty-workspace">
            <div className="import-tool">
              <div className="import-symbol">
                <FileSpreadsheet size={32} strokeWidth={1.5} />
              </div>
              <h2>Produktdatei</h2>
              <p>CSV / TSV &middot; UTF-8 &middot; bis 10 MB</p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void openFile()}
              >
                {importing ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <FolderOpen size={17} />
                )}
                Datei oeffnen
              </button>
            </div>
            <div className="demo-section">
              <div className="section-title">
                <div>
                  <span className="eyebrow">BEISPIELKATALOG</span>
                  <h2>Nordlicht Sortiment</h2>
                  <p>12 Produkte &middot; 5 fehlerhafte Datens&auml;tze</p>
                </div>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    queueImport({
                      name: demoName,
                      content: demoCsv,
                      demo: true,
                    })
                  }
                >
                  Beispieldaten laden
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="demo-products">
                {[
                  ['watch', 'Armbanduhr Essential', '89,90'],
                  ['sneaker', 'Sneaker Runner', '79,95'],
                  ['camera', 'Kamera Classic', '129,00'],
                ].map(([image, name, price]) => (
                  <div className="demo-product" key={image}>
                    <img src={`./samples/${image}.jpg`} alt={name} />
                    <div>
                      <strong>{name}</strong>
                      <span>{price} EUR</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="stats" aria-label="Pruefergebnis">
              <button
                onClick={() => {
                  navigate('catalog')
                  changeFilter('all')
                }}
              >
                <span>Produkte gesamt</span>
                <strong>{formatNumber(dataset.rows.length)}</strong>
                <Package size={20} />
              </button>
              <button
                onClick={() => {
                  navigate('catalog')
                  changeFilter('valid')
                }}
              >
                <span>Exportbereit</span>
                <strong className="green">
                  {analysis ? formatNumber(analysis.valid) : '\u2014'}
                </strong>
                <CheckCircle2 className="green" size={20} />
              </button>
              <button
                onClick={() => {
                  navigate('catalog')
                  changeFilter('errors')
                }}
              >
                <span>Mit Fehlern</span>
                <strong className={analysis?.invalid ? 'red' : ''}>
                  {analysis ? formatNumber(analysis.invalid) : '\u2014'}
                </strong>
                <CircleAlert
                  className={analysis?.invalid ? 'red' : ''}
                  size={20}
                />
              </button>
              <button
                onClick={() => {
                  navigate('catalog')
                  changeFilter('changed')
                }}
              >
                <span>Angepasste Datens&auml;tze</span>
                <strong>
                  {analysis ? formatNumber(analysis.changed) : '\u2014'}
                </strong>
                <Pencil size={20} />
              </button>
            </section>

            {view === 'catalog' && (
              <section className="catalog-section">
                <div className="section-title">
                  <div>
                    <h2>
                      Produkte{' '}
                      <span className="subtle-count">
                        {formatNumber(filtered.length)}
                      </span>
                    </h2>
                    <p>
                      {analysis?.excluded
                        ? `${analysis.excluded} Datensaetze ausgeschlossen`
                        : 'Pruefung und Korrekturen'}
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Spaltenzuordnung oeffnen"
                    title="Spaltenzuordnung"
                    onClick={() => navigate('mapping')}
                  >
                    <Settings2 size={18} />
                  </button>
                </div>
                <div className="table-toolbar">
                  <div className="segmented" aria-label="Produktfilter">
                    {(Object.keys(filterLabels) as Filter[]).map((key) => (
                      <button
                        key={key}
                        aria-pressed={filter === key}
                        className={filter === key ? 'selected' : ''}
                        onClick={() => changeFilter(key)}
                      >
                        {filterLabels[key]}
                        <span>{formatNumber(counts[key])}</span>
                      </button>
                    ))}
                  </div>
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Produkte suchen"
                      placeholder="Produkte suchen ..."
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value)
                        setPage(0)
                      }}
                    />
                    {search && (
                      <button
                        className="icon-button"
                        aria-label="Suche leeren"
                        title="Suche leeren"
                        onClick={() => setSearch('')}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </label>
                  <label className="sort-field">
                    <ListFilter size={16} />
                    <select
                      aria-label="Sortierung"
                      value={sort}
                      onChange={(event) => {
                        setSort(event.target.value)
                        setPage(0)
                      }}
                    >
                      <option value="source">Quelldatei</option>
                      <option value="name">Produktname</option>
                      <option value="sku">Artikelnummer</option>
                    </select>
                  </label>
                </div>
                <div className="catalog-body">
                  <div className="table-area">
                    <div className="table-scroll" aria-busy={busy}>
                      <table className="product-table">
                        <thead>
                          <tr>
                            <th className="check-col">
                              <span className="sr-only">Ausschluss</span>
                            </th>
                            <th>Produkt</th>
                            <th>Artikelnummer</th>
                            <th className="numeric">Preis (EUR)</th>
                            <th className="numeric">Bestand</th>
                            <th>Status</th>
                            <th>
                              <span className="sr-only">Bearbeiten</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((row) => (
                            <tr
                              key={row.index}
                              className={`${row.excluded ? 'excluded-row' : ''} ${selected === row.index ? 'selected-row' : ''}`}
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`Datensatz ${row.index + 1} ausschliessen`}
                                  checked={row.excluded}
                                  disabled={busy}
                                  onChange={() => toggleExclude(row.index)}
                                />
                              </td>
                              <td>
                                <button
                                  className="product-link"
                                  onClick={() => setSelected(row.index)}
                                  disabled={busy}
                                >
                                  {isDemo && demoImages[row.index] ? (
                                    <img
                                      src={`./samples/${demoImages[row.index]}.jpg`}
                                      alt=""
                                    />
                                  ) : (
                                    <span className="product-placeholder">
                                      <Package size={18} />
                                    </span>
                                  )}
                                  <span>
                                    <strong>
                                      {row.product.name || 'Ohne Produktname'}
                                    </strong>
                                    <small>
                                      {row.product.category || 'Ohne Kategorie'}
                                      {row.changes.length > 0 && (
                                        <span
                                          className="change-marker"
                                          title={row.changes
                                            .map(
                                              (key) =>
                                                fields.find(
                                                  (field) => field.key === key,
                                                )?.label,
                                            )
                                            .join(', ')}
                                        >
                                          {' '}
                                          &middot; angepasst
                                        </span>
                                      )}
                                    </small>
                                  </span>
                                </button>
                              </td>
                              <td
                                className={`mono ${row.issues.some((issue) => issue.field === 'sku') ? 'cell-error' : ''}`}
                              >
                                {row.product.sku || '\u2014'}
                              </td>
                              <td
                                className={`numeric mono ${row.issues.some((issue) => issue.field === 'price') ? 'cell-error' : ''}`}
                              >
                                {row.product.price || '\u2014'}
                              </td>
                              <td
                                className={`numeric mono ${row.issues.some((issue) => issue.field === 'stock') ? 'cell-error' : ''}`}
                              >
                                {row.product.stock || '\u2014'}
                              </td>
                              <td>
                                <Status row={row} />
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  disabled={busy}
                                  title="Produkt bearbeiten"
                                  aria-label={`Datensatz ${row.index + 1} bearbeiten`}
                                  onClick={() => setSelected(row.index)}
                                >
                                  <Pencil size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {!visible.length && (
                            <tr>
                              <td colSpan={7} className="table-empty">
                                {busy ? (
                                  <>
                                    <LoaderCircle className="spin" size={20} />
                                    Produkte werden gepr&uuml;ft ...
                                  </>
                                ) : (
                                  <>
                                    <Search size={20} />
                                    Keine passenden Produkte
                                  </>
                                )}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <footer className="table-footer">
                      <span>
                        {filtered.length
                          ? `${currentPage * 20 + 1}\u2013${Math.min((currentPage + 1) * 20, filtered.length)} von ${formatNumber(filtered.length)} Produkten`
                          : '0 Produkte'}
                        {busy && <LoaderCircle className="spin" size={14} />}
                      </span>
                      <div>
                        <span>
                          Seite {currentPage + 1} / {lastPage + 1}
                        </span>
                        <button
                          className="icon-button"
                          title="Vorherige Seite"
                          aria-label="Vorherige Seite"
                          disabled={currentPage === 0}
                          onClick={() => setPage(currentPage - 1)}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          className="icon-button"
                          title="Naechste Seite"
                          aria-label="Naechste Seite"
                          disabled={currentPage >= lastPage}
                          onClick={() => setPage(currentPage + 1)}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </footer>
                  </div>
                  {selectedRow && (
                    <RowEditor
                      key={selectedRow.index}
                      row={selectedRow}
                      draftValues={{
                        ...selectedRow.original,
                        ...edits[selectedRow.index],
                      }}
                      options={options}
                      busy={busy}
                      onClose={() => setSelected(null)}
                      onExclude={() => toggleExclude(selectedRow.index)}
                      onSave={(draft) => {
                        invalidateAnalysis()
                        setEdits((current) => ({
                          ...current,
                          [selectedRow.index]: draft,
                        }))
                        setSelected(null)
                        setToast('Korrektur uebernommen.')
                      }}
                    />
                  )}
                </div>
              </section>
            )}

            {view === 'mapping' && (
              <section className="mapping-section">
                <div className="section-title">
                  <div>
                    <h2>Quelle und Zielfelder</h2>
                    <p>
                      {dataset.headers.length} Quellspalten &middot; WooCommerce
                    </p>
                  </div>
                  <div className="mapping-profile">
                    <select
                      aria-label="Zuordnungsprofil"
                      value={profileId}
                      disabled={busy}
                      onChange={(event) => {
                        const profile = profiles.find(
                          (item) => item.id === event.target.value,
                        )
                        queueMapping(
                          profile
                            ? {
                                mapping: Object.fromEntries(
                                  fields.map(({ key }) => [
                                    key,
                                    dataset.headers.includes(
                                      profile.mapping[key],
                                    )
                                      ? profile.mapping[key]
                                      : '',
                                  ]),
                                ) as Mapping,
                                options: profile.options,
                                id: profile.id,
                              }
                            : {
                                mapping: suggestMapping(dataset.headers),
                                options,
                                id: '',
                              },
                        )
                      }}
                    >
                      <option value="">Automatische Zuordnung</option>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button"
                      onClick={() => {
                        setProfileName(
                          profiles.find((item) => item.id === profileId)
                            ?.name ?? '',
                        )
                        setProfileDialog(true)
                      }}
                    >
                      <Save size={15} />
                      Profil speichern
                    </button>
                  </div>
                </div>
                <div className="mapping-layout">
                  <div className="mapping-table">
                    <div className="mapping-table-head">
                      <span>WOOCOMMERCE-ZIELFELD</span>
                      <span>QUELLSPALTE</span>
                      <span>BEISPIELWERT</span>
                    </div>
                    {fields.map(({ key, label, required }) => (
                      <div className="mapping-row" key={key}>
                        <div>
                          <strong>{label}</strong>
                          <span>{required ? 'Pflichtfeld' : 'Optional'}</span>
                        </div>
                        <select
                          aria-label={`Quellspalte fuer ${label}`}
                          value={mapping[key]}
                          disabled={busy}
                          onChange={(event) =>
                            queueMapping({
                              mapping: {
                                ...mapping,
                                [key]: event.target.value,
                              },
                              options,
                              id: '',
                            })
                          }
                        >
                          <option value="">Nicht zugeordnet</option>
                          {dataset.headers.map((header) => (
                            <option
                              key={header}
                              value={header}
                              disabled={fields.some(
                                (field) =>
                                  field.key !== key &&
                                  mapping[field.key] === header,
                              )}
                            >
                              {header}
                            </option>
                          ))}
                        </select>
                        <span
                          className="sample-value"
                          title={
                            dataset.rows[0][
                              dataset.headers.indexOf(mapping[key])
                            ]
                          }
                        >
                          {dataset.rows[0][
                            dataset.headers.indexOf(mapping[key])
                          ] || '\u2014'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <aside className="normalization">
                    <div className="section-title">
                      <h2>
                        <SlidersHorizontal size={18} />
                        Aufbereitung
                      </h2>
                    </div>
                    <label className="toggle-row">
                      <span>Leerzeichen entfernen</span>
                      <input
                        type="checkbox"
                        checked={options.trim}
                        disabled={busy}
                        onChange={(event) => {
                          invalidateAnalysis()
                          setOptions({ ...options, trim: event.target.checked })
                        }}
                      />
                    </label>
                    <label className="toggle-row">
                      <span>Preise normalisieren</span>
                      <input
                        type="checkbox"
                        checked={options.normalizePrices}
                        disabled={busy}
                        onChange={(event) => {
                          invalidateAnalysis()
                          setOptions({
                            ...options,
                            normalizePrices: event.target.checked,
                          })
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>Zahlenformat der Quelle</span>
                      <select
                        value={options.priceFormat}
                        disabled={busy}
                        onChange={(event) => {
                          invalidateAnalysis()
                          setOptions({
                            ...options,
                            priceFormat: event.target
                              .value as Options['priceFormat'],
                          })
                        }}
                      >
                        <option value="de">Deutsch &middot; 1.234,50</option>
                        <option value="en">Englisch &middot; 1,234.50</option>
                      </select>
                    </label>
                    <div className="format-example">
                      <span>QUELLE</span>
                      <strong className="mono">
                        {options.priceFormat === 'de'
                          ? '1.234,50 EUR'
                          : '1,234.50 EUR'}
                      </strong>
                      <ArrowDownToLine size={18} />
                      <span>WOOCOMMERCE</span>
                      <strong className="mono">1234.50</strong>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => navigate('catalog')}
                    >
                      Produkte pr&uuml;fen
                      <ArrowRight size={16} />
                    </button>
                  </aside>
                </div>
              </section>
            )}

            {view === 'export' && (
              <section className="export-section">
                <div className={`export-status ${canExport ? 'ready' : ''}`}>
                  {canExport ? (
                    <FileCheck2 size={32} strokeWidth={1.5} />
                  ) : (
                    <CircleAlert size={32} strokeWidth={1.5} />
                  )}
                  <div>
                    <h2>
                      {busy
                        ? 'Daten werden verarbeitet'
                        : canExport
                          ? 'Katalog ist exportbereit'
                          : 'Export noch nicht bereit'}
                    </h2>
                    <p>
                      {analysis
                        ? `${analysis.valid} gueltige Produkte / ${analysis.invalid} fehlerhafte / ${analysis.excluded} ausgeschlossen`
                        : 'Pruefung laeuft ...'}
                    </p>
                  </div>
                  {!canExport && !busy && (
                    <button
                      className="button"
                      onClick={() => {
                        navigate('catalog')
                        changeFilter('errors')
                      }}
                    >
                      Fehler pr&uuml;fen
                      <ArrowRight size={16} />
                    </button>
                  )}
                </div>
                <div className="export-layout">
                  <div>
                    <div className="section-title">
                      <h2>Exportvorschau</h2>
                      <span className="status neutral">WooCommerce CSV</span>
                    </div>
                    <div className="table-scroll">
                      <table className="export-table">
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>Name</th>
                            <th>Regular price</th>
                            <th>Stock</th>
                            <th>Published</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysis?.rows
                            .filter(
                              (row) => !row.excluded && !row.issues.length,
                            )
                            .slice(0, 5)
                            .map((row) => (
                              <tr key={row.index}>
                                <td className="mono">{row.product.sku}</td>
                                <td>{row.product.name}</td>
                                <td className="mono">{row.product.price}</td>
                                <td>{row.product.stock || '\u2014'}</td>
                                <td>
                                  <span className="status muted">Entwurf</span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="export-meta">
                      <span>
                        <FileSpreadsheet size={15} />
                        UTF-8 mit BOM
                      </span>
                      <span>Komma-getrennt</span>
                      <span>10 Zielspalten</span>
                    </div>
                    <div className="export-actions">
                      <button
                        className="button primary"
                        disabled={!canExport}
                        onClick={() => void saveExport()}
                      >
                        {exporting ? (
                          <LoaderCircle className="spin" size={17} />
                        ) : (
                          <Download size={17} />
                        )}
                        WooCommerce-CSV exportieren
                      </button>
                    </div>
                  </div>
                  <aside className="report-section">
                    <ClipboardList size={26} strokeWidth={1.5} />
                    <h2>Pr&uuml;fbericht</h2>
                    <dl>
                      <div>
                        <dt>Angepasste Datens&auml;tze</dt>
                        <dd>{analysis?.changed ?? '\u2014'}</dd>
                      </div>
                      <div>
                        <dt>Fehlerhafte Datens&auml;tze</dt>
                        <dd>{analysis?.invalid ?? '\u2014'}</dd>
                      </div>
                      <div>
                        <dt>Ausgeschlossene Datens&auml;tze</dt>
                        <dd>{analysis?.excluded ?? '\u2014'}</dd>
                      </div>
                    </dl>
                    <button
                      className="button"
                      disabled={!analysis || busy}
                      onClick={() => void saveExport(true)}
                    >
                      <Download size={16} />
                      Pr&uuml;fbericht speichern
                    </button>
                  </aside>
                </div>
              </section>
            )}
          </>
        )}
        <footer className="workspace-footer">
          <span>
            <span className="online-dot" />
            {busy
              ? 'Verarbeitung laeuft'
              : dataset
                ? 'Quelle unveraendert'
                : 'Bereit fuer den Import'}
          </span>
          <span>CSV &rarr; WooCommerce</span>
        </footer>
        {dragging && (
          <div className="drop-overlay">
            <FileSpreadsheet size={42} />
            <strong>Produktdatei importieren</strong>
          </div>
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Statusmeldung schliessen"
            title="Schliessen"
            onClick={() => setToast('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {shopDialog && (
        <ShopConnectionDialog
          checked={checkedShop}
          onChecked={setCheckedShop}
          onClose={() => setShopDialog(false)}
        />
      )}
      {projectsDialog && (
        <ProjectsDialog
          snapshot={snapshot}
          active={activeProject}
          onSaved={(summary, saved) => {
            setActiveProject(summary)
            setSavedSnapshot(saved)
          }}
          onOpen={openSavedProject}
          onDeleted={(id) => {
            if (activeProject?.id === id) {
              setActiveProject(null)
              setSavedSnapshot(null)
            }
          }}
          onClose={() => setProjectsDialog(false)}
        />
      )}
      {pendingProject && (
        <Dialog
          title="Arbeitsstand ersetzen?"
          onClose={() => setPendingProject(null)}
        >
          <p>
            Nicht gespeicherte Aenderungen werden verworfen. Gespeicherte
            Projekte bleiben erhalten.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setPendingProject(null)}>
              Abbrechen
            </button>
            <button
              className="button primary"
              onClick={() => {
                restoreProject(pendingProject)
                setPendingProject(null)
              }}
            >
              Projekt oeffnen
            </button>
          </div>
        </Dialog>
      )}
      {profileDialog && (
        <Dialog
          title="Zuordnungsprofile"
          onClose={() => setProfileDialog(false)}
        >
          {dataset && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                persistProfile()
              }}
            >
              <label className="field">
                <span>Profilname</span>
                <input
                  value={profileName}
                  maxLength={60}
                  required
                  placeholder="z. B. Lieferant Nordlicht"
                  onChange={(event) => setProfileName(event.target.value)}
                />
              </label>
              <button
                className="button primary"
                disabled={!profileName.trim()}
                type="submit"
              >
                <Save size={16} />
                {profiles.some(
                  (item) =>
                    item.name.toLowerCase() ===
                    profileName.trim().toLowerCase(),
                )
                  ? 'Profil aktualisieren'
                  : 'Profil speichern'}
              </button>
            </form>
          )}
          <h3>
            Gespeichert{' '}
            <span className="subtle-count">{profiles.length}/20</span>
          </h3>
          {profiles.length ? (
            <ul className="profile-list">
              {profiles.map((profile) => (
                <li key={profile.id}>
                  <div>
                    <strong>{profile.name}</strong>
                    <span>
                      {Object.values(profile.mapping).filter(Boolean).length}{' '}
                      Zuordnungen &middot;{' '}
                      {profile.options.priceFormat === 'de'
                        ? 'Deutsch'
                        : 'Englisch'}
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Profil ${profile.name} loeschen`}
                    title="Profil loeschen"
                    onClick={() => {
                      try {
                        const next = profiles.filter(
                          (item) => item.id !== profile.id,
                        )
                        saveProfiles(next)
                        setProfiles(next)
                        if (profileId === profile.id) setProfileId('')
                      } catch {
                        setError('Profil konnte nicht geloescht werden.')
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-text">Keine Profile gespeichert.</p>
          )}
        </Dialog>
      )}
      {pendingImport && (
        <Dialog title="Import ersetzen?" onClose={() => setPendingImport(null)}>
          <p>
            Nicht gespeicherte Daten, Korrekturen und Ausschl&uuml;sse des
            aktuellen Imports werden verworfen. Gespeicherte Projekte bleiben
            erhalten.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setPendingImport(null)}>
              Abbrechen
            </button>
            <button
              className="button primary"
              onClick={() => {
                const file = pendingImport
                setPendingImport(null)
                void performImport(file)
              }}
            >
              Import ersetzen
            </button>
          </div>
        </Dialog>
      )}
      {pendingMapping && (
        <Dialog
          title="Zuordnung aendern?"
          onClose={() => setPendingMapping(null)}
        >
          <p>
            Manuelle Korrekturen und Ausschl&uuml;sse werden f&uuml;r die neue
            Zuordnung zur&uuml;ckgesetzt.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setPendingMapping(null)}>
              Abbrechen
            </button>
            <button
              className="button primary"
              onClick={() => {
                applyMapping(pendingMapping)
                setPendingMapping(null)
              }}
            >
              Zuordnung &auml;ndern
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
