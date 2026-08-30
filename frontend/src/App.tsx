import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isImageName, ocrImageFile, ocrPdfFile, type OcrPage } from './ocrClient'

const API_BASE = 'http://localhost:8000/api'
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.pptx,.txt,.md'
const MAX_FILES = 10

type Status = 'queued' | 'converting' | 'done' | 'error'

interface ConvResult {
  filename: string
  markdown_filename: string
  status: 'ok' | 'error'
  track: 'A' | 'B' | '?'
  markdown: string | null
  used_ai: boolean
  client_ocr?: boolean
  ocr_confidence: number | null
  warning: string | null
  error: string | null
}

interface QueueItem {
  id: string
  file: File
  name: string
  size: number
  status: Status
  progress?: number
  result?: ConvResult
}

interface AiSettings {
  mode: 'off' | 'cloud' | 'local'
  provider: 'gemini' | 'anthropic' | 'openai'
  cloudApiKey: string
  cloudModel: string
  localApiKey: string
  localModel: string
  baseUrl: string
  ocrLang: string
  ragMode: boolean
}

// Montaż wyniku OCR przeglądarkowego. Odpowiednik `postprocess.assemble`
// z backendu, ograniczony do prowenancji i znaczników stron — heurystyki
// żywej paginy nie duplikujemy tu celowo (patrz README).
function assembleClientMd(source: string, pages: OcrPage[], ragMode: boolean): string {
  const filled = pages.map((p, i) => ({ n: i + 1, text: p.markdown.trim() })).filter((p) => p.text)
  // Pewność OCR w prowenancji pozwala odfiltrować słabe skany przed indeksacją.
  const scored = pages.filter((p) => p.markdown.trim())
  const confidence = scored.length
    ? Math.round(scored.reduce((a, p) => a + p.confidence, 0) / scored.length)
    : null
  const front = [
    '---',
    `source: "${source.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    'track: "B"',
    `pages: ${pages.length}`,
    'used_ai: false',
    'client_ocr: true',
    ...(confidence === null ? [] : [`ocr_confidence: ${confidence}`]),
    'converter: "markdox"',
    `converted_at: "${new Date().toISOString().replace(/\.\d+Z$/, '+00:00')}"`,
    '---',
  ].join('\n')
  const body = ragMode
    ? filled.map((p) => `<!-- markdox:strona ${p.n} -->\n\n${p.text}`).join('\n\n')
    : filled.map((p) => p.text).join('\n\n---\n\n')
  return `${front}\n\n${body}`.trim()
}

// Sugerowane modele wizyjne per dostawca (do datalisty; można wpisać własny).
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-4-8'],
  openai: ['gpt-4o-mini', 'gpt-4o'],
  local: ['llava', 'minicpm-v', 'qwen2.5-vl'],
}

// Rozpoznanie dostawcy po prefiksie klucza (wygoda; można nadpisać ręcznie).
function detectProvider(key: string): AiSettings['provider'] | null {
  if (key.startsWith('sk-ant-')) return 'anthropic'
  if (key.startsWith('AIza')) return 'gemini'
  if (key.startsWith('sk-')) return 'openai'
  return null
}

const DEFAULT_AI: AiSettings = {
  mode: 'off',
  provider: 'gemini',
  cloudApiKey: '',
  cloudModel: '',
  localApiKey: '',
  localModel: '',
  baseUrl: 'http://localhost:11434/v1',
  ocrLang: 'pol+eng',
  ragMode: false,
}

const uid = () => Math.random().toString(36).slice(2, 10)

const humanSize = (b: number) => {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}K`
  return `${(b / 1024 / 1024).toFixed(1)}M`
}

function App() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [ai, setAi] = useState<AiSettings>(() => {
    try {
      const raw = localStorage.getItem('markdox_ai')
      return raw ? { ...DEFAULT_AI, ...JSON.parse(raw) } : DEFAULT_AI
    } catch {
      return DEFAULT_AI
    }
  })

  useEffect(() => {
    localStorage.setItem('markdox_ai', JSON.stringify(ai))
  }, [ai])

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg })
    setTimeout(() => setToast(null), 4500)
  }

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId],
  )
  const doneItems = useMemo(
    () => items.filter((i) => i.status === 'done' && i.result?.markdown),
    [items],
  )

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList)
    setItems((prev) => {
      const space = MAX_FILES - prev.length
      if (space <= 0) {
        showToast('err', `Limit ${MAX_FILES} plików osiągnięty.`)
        return prev
      }
      const accepted = incoming.slice(0, space).map<QueueItem>((f) => ({
        id: uid(),
        file: f,
        name: f.name,
        size: f.size,
        status: 'queued',
      }))
      if (incoming.length > space) {
        showToast('err', `Dodano ${space} z ${incoming.length} — limit ${MAX_FILES}.`)
      }
      return [...prev, ...accepted]
    })
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const clearAll = () => {
    if (items.length === 0) return
    setItems([])
    setSelectedId(null)
  }

  const buildAiFields = (fd: FormData) => {
    fd.append('ai_mode', ai.mode)
    fd.append('ocr_lang', ai.ocrLang)
    fd.append('rag_mode', String(ai.ragMode))
    if (ai.mode === 'off') return
    if (ai.mode === 'local') {
      fd.append('ai_provider', 'openai')
      fd.append('ai_base_url', ai.baseUrl)
      fd.append('ai_api_key', ai.localApiKey)
      fd.append('ai_model', ai.localModel || 'llava')
    } else {
      fd.append('ai_provider', ai.provider)
      fd.append('ai_api_key', ai.cloudApiKey)
      if (ai.provider === 'openai') fd.append('ai_base_url', 'https://api.openai.com/v1')
      fd.append('ai_model', ai.cloudModel)
    }
  }

  const patchItem = (id: string, patch: Partial<QueueItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))

  const mdName = (name: string) =>
    (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name) + '.md'

  // `hasText` jest przekazywane osobno: wynik zawiera front-matter, więc
  // sam markdown nigdy nie jest pusty i nie nadaje się na wskaźnik pustki.
  const synthResult = (name: string, markdown: string, hasText: boolean, confidence: number | null = null): ConvResult => ({
    filename: name,
    markdown_filename: mdName(name),
    status: 'ok',
    track: 'B',
    markdown,
    used_ai: false,
    client_ocr: true,
    ocr_confidence: confidence,
    warning: hasText ? null : 'OCR nie wykrył tekstu na skanie.',
    error: null,
  })

  const runClientOcr = async (item: QueueItem) => {
    try {
      const pages = isImageName(item.name)
        ? [await ocrImageFile(item.file, ai.ocrLang, (p) => patchItem(item.id, { progress: p }))]
        : await ocrPdfFile(item.file, ai.ocrLang, (p) => patchItem(item.id, { progress: p }))
      const md = assembleClientMd(item.name, pages, ai.ragMode)
      const hasText = pages.some((p) => p.markdown.trim())
      const scored = pages.filter((p) => p.markdown.trim())
      const confidence = scored.length
        ? Math.round(scored.reduce((a, p) => a + p.confidence, 0) / scored.length)
        : null
      patchItem(item.id, { status: 'done', progress: undefined, result: synthResult(item.name, md, hasText, confidence) })
      return item.id
    } catch (e: any) {
      patchItem(item.id, {
        status: 'error',
        progress: undefined,
        result: { ...synthResult(item.name, '', false), status: 'error', error: e?.message || 'Błąd OCR w przeglądarce.' },
      })
      return null
    }
  }

  const convertAll = async () => {
    const toConvert = items.filter((i) => i.status !== 'done')
    if (toConvert.length === 0) {
      showToast('err', 'Brak plików do konwersji.')
      return
    }
    setConverting(true)
    setItems((prev) =>
      prev.map((i) => (i.status !== 'done' ? { ...i, status: 'converting', progress: undefined } : i)),
    )

    const aiOff = ai.mode === 'off'
    const clientImages = aiOff ? toConvert.filter((i) => isImageName(i.name)) : []
    const backendItems = toConvert.filter((i) => !clientImages.includes(i))
    let firstDoneId: string | null = null
    const pdfsForClient: QueueItem[] = []

    try {
      if (backendItems.length > 0) {
        const fd = new FormData()
        backendItems.forEach((i) => fd.append('files', i.file, i.name))
        buildAiFields(fd)
        const res = await fetch(`${API_BASE}/convert`, { method: 'POST', body: fd })
        if (!res.ok) {
          const detail = await res.json().catch(() => null)
          throw new Error(detail?.detail || `Błąd serwera (${res.status})`)
        }
        const data: { results: ConvResult[] } = await res.json()
        const byName = new Map<string, ConvResult[]>()
        data.results.forEach((r) => {
          const arr = byName.get(r.filename) || []
          arr.push(r)
          byName.set(r.filename, arr)
        })
        const assignments = backendItems.map((item) => ({ item, r: byName.get(item.name)?.shift() }))
        assignments.forEach((a) => {
          if (a.r?.client_ocr) pdfsForClient.push(a.item)
          else if (a.r?.status === 'ok' && !firstDoneId) firstDoneId = a.item.id
        })
        const resultById = new Map(assignments.map((a) => [a.item.id, a.r]))
        setItems((prev) =>
          prev.map((i) => {
            if (!resultById.has(i.id) || i.status !== 'converting') return i
            const r = resultById.get(i.id)
            if (!r) return { ...i, status: 'error' }
            if (r.client_ocr) return i
            return { ...i, status: r.status === 'ok' ? 'done' : 'error', result: r }
          }),
        )
      }

      for (const item of [...clientImages, ...pdfsForClient]) {
        const doneId = await runClientOcr(item)
        if (doneId && !firstDoneId) firstDoneId = doneId
      }

      if (firstDoneId && !selectedId) setSelectedId(firstDoneId)
      showToast('ok', 'Konwersja zakończona.')
    } catch (e: any) {
      setItems((prev) => prev.map((i) => (i.status === 'converting' ? { ...i, status: 'error' } : i)))
      showToast('err', e?.message || 'Błąd połączenia z serwerem.')
    } finally {
      setConverting(false)
    }
  }

  const downloadBlob = (content: BlobPart, filename: string, type: string) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadOne = (i: QueueItem | null) => {
    if (!i?.result?.markdown) return
    downloadBlob(i.result.markdown, i.result.markdown_filename, 'text/markdown;charset=utf-8')
  }

  const downloadZip = async () => {
    if (doneItems.length === 0) {
      showToast('err', 'Brak gotowych plików do spakowania.')
      return
    }
    try {
      const res = await fetch(`${API_BASE}/convert/zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: doneItems.map((i) => ({ filename: i.result!.markdown_filename, content: i.result!.markdown })),
        }),
      })
      if (!res.ok) throw new Error('Nie udało się utworzyć ZIP.')
      downloadBlob(await res.blob(), 'markdox_export.zip', 'application/zip')
    } catch (e: any) {
      showToast('err', e?.message || 'Błąd tworzenia ZIP.')
    }
  }

  const moveSel = (dir: number) => {
    if (items.length === 0) return
    const idx = items.findIndex((i) => i.id === selectedId)
    const next = idx < 0 ? (dir > 0 ? 0 : items.length - 1) : Math.min(Math.max(idx + dir, 0), items.length - 1)
    setSelectedId(items[next].id)
  }

  // Skróty klawiaturowe w stylu Norton Commander
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
      const k = e.key
      if (!k) return
      if (k === 'Escape') { setAiOpen(false); return }
      if (typing && !k.startsWith('F')) return
      switch (k) {
        case 'F2': e.preventDefault(); setAiOpen((v) => !v); break
        case 'F5': e.preventDefault(); if (!converting) convertAll(); break
        case 'F6': e.preventDefault(); downloadOne(selected); break
        case 'F7': e.preventDefault(); downloadZip(); break
        case 'F8': e.preventDefault(); if (selectedId) removeItem(selectedId); break
        case 'F9': e.preventDefault(); fileInputRef.current?.click(); break
        case 'F10': e.preventDefault(); clearAll(); break
        case 'ArrowDown': if (!typing) { e.preventDefault(); moveSel(1) } break
        case 'ArrowUp': if (!typing) { e.preventDefault(); moveSel(-1) } break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedId, ai, converting])

  const aiLabel = ai.mode === 'off' ? 'OFF' : ai.mode === 'local' ? 'LOCAL' : ai.provider.toUpperCase()

  const FKEYS: { k: string; label: string; on: () => void; disabled?: boolean }[] = [
    { k: '2', label: 'AI', on: () => setAiOpen((v) => !v) },
    { k: '3', label: 'Podgląd', on: () => selected && setSelectedId(selected.id), disabled: !selected?.result?.markdown },
    { k: '5', label: 'Konwertuj', on: convertAll, disabled: converting },
    { k: '6', label: 'Pobierz', on: () => downloadOne(selected), disabled: !selected?.result?.markdown },
    { k: '7', label: 'ZIP', on: downloadZip, disabled: doneItems.length === 0 },
    { k: '8', label: 'Usuń', on: () => selectedId && removeItem(selectedId), disabled: !selectedId },
    { k: '9', label: 'Dodaj', on: () => fileInputRef.current?.click() },
    { k: '10', label: 'Wyczyść', on: clearAll, disabled: items.length === 0 },
  ]

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden select-none" style={{ padding: '4px' }}>
      {/* Górny pasek menu */}
      <div className="flex items-center justify-between px-2 h-6 shrink-0"
        style={{ background: 'var(--nc-cyan-solid)', color: '#000' }}>
        <div className="flex items-center gap-4 font-bold">
          <span>▚ Markdox Commander</span>
          <span className="hidden sm:inline opacity-80">Konwertuj pliki na markdown</span>
        </div>
        <div className="font-bold">
          AI:<span style={{ color: ai.mode === 'off' ? '#000' : '#a80000' }}> {aiLabel}</span>
        </div>
      </div>

      {/* Panele */}
      <input ref={fileInputRef} type="file" multiple accept={ACCEPT} className="hidden"
        onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 min-h-0 py-2">
        {/* LEWY panel — pliki */}
        <section
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`nc-panel flex flex-col min-h-0 ${dragOver ? 'active' : ''}`}
        >
          <div className="nc-title">Pliki [{items.length}/{MAX_FILES}]</div>

          {/* nagłówek kolumn */}
          <div className="flex px-2 pt-2 pb-1 shrink-0" style={{ color: 'var(--nc-yellow)' }}>
            <span className="flex-1">Nazwa</span>
            <span className="w-16 text-right">Rozmiar</span>
            <span className="w-8 text-center"> </span>
            <span className="w-24 text-right">Status</span>
          </div>
          <div style={{ borderTop: '1px solid var(--nc-border)' }} className="mx-1" />

          <div className="flex-1 overflow-auto px-1 py-1 min-h-0">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4"
                style={{ color: 'var(--nc-dim)' }}>
                <div style={{ color: 'var(--nc-yellow)' }} className="mb-2">
                  {dragOver ? '▼ Upuść pliki ▼' : '‹ pusto ›'}
                </div>
                <div>Przeciągnij pliki tutaj<br />lub naciśnij <b style={{ color: 'var(--nc-white)' }}>Fn + F9</b></div>
                <div className="mt-3 text-xs">PDF · JPG · PNG · DOCX · PPTX · TXT</div>
              </div>
            ) : (
              items.map((i) => (
                <FileRow key={i.id} item={i} selected={i.id === selectedId} onSelect={() => setSelectedId(i.id)} />
              ))
            )}
          </div>
        </section>

        {/* PRAWY panel — podgląd */}
        <section className="nc-panel flex flex-col min-h-0">
          <div className="nc-title">
            Podgląd{selected?.result?.markdown_filename ? `: ${selected.result.markdown_filename}` : ''}
          </div>
          <div className="flex-1 overflow-auto p-3 min-h-0">
            {selected?.result?.markdown ? (
              <pre className="whitespace-pre-wrap" style={{ color: 'var(--nc-text)' }}>
                {selected.result.markdown}
              </pre>
            ) : selected?.result?.error ? (
              <div style={{ color: 'var(--nc-red)' }}>■ Błąd: {selected.result.error}</div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center"
                style={{ color: 'var(--nc-dim)' }}>
                <div style={{ color: 'var(--nc-yellow)' }} className="mb-2">[ podgląd .md ]</div>
                <div>Zaznacz przekonwertowany plik<br />(↑↓ / klik), aby zobaczyć wynik.</div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Linia informacyjna + prompt */}
      <div className="shrink-0 px-1">
        <div className="truncate" style={{ color: 'var(--nc-dim)' }}>
          {selected ? (
            <>
              <span style={{ color: 'var(--nc-white)' }}>{selected.name}</span>
              {'  '}{humanSize(selected.size)}
              {selected.result?.warning && (
                <span style={{ color: 'var(--nc-yellow)' }}>  ⚠ {selected.result.warning}</span>
              )}
              {selected.result?.ocr_confidence != null && (
                <span style={{
                  color: selected.result.ocr_confidence < 70 ? 'var(--nc-yellow)' : 'var(--nc-green)',
                }}>
                  {'  '}OCR {selected.result.ocr_confidence}%
                </span>
              )}
              {selected.result?.used_ai && <span style={{ color: 'var(--nc-magenta)' }}>  ★AI</span>}
            </>
          ) : (
            <>Gotowych: <b style={{ color: 'var(--nc-green)' }}>{doneItems.length}</b> · Zero zapisu na dysku · Offline-first</>
          )}
        </div>
        <div style={{ color: 'var(--nc-green)' }}>
          C:\MARKDOX&gt;{' '}
          <span style={{ color: 'var(--nc-white)' }}>{converting ? 'konwersja w toku' : 'gotowy'}</span>
          <span className="blink" style={{ color: 'var(--nc-white)' }}>_</span>
        </div>
      </div>

      {/* Pasek klawiszy F */}
      <div className="fnbar shrink-0">
        {FKEYS.map((f) => (
          <button key={f.k} className="fnkey" onClick={f.on} disabled={f.disabled}>
            <span className="num">F{f.k}</span>
            <span className="lbl">{f.label}</span>
          </button>
        ))}
      </div>

      {/* Dialog AI */}
      {aiOpen && <AiDialog ai={ai} setAi={setAi} onClose={() => setAiOpen(false)} />}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-1"
          style={{
            bottom: '2.5rem',
            background: toast.kind === 'ok' ? 'var(--nc-cyan-solid)' : '#a80000',
            color: toast.kind === 'ok' ? '#000' : '#fff',
            border: '2px double var(--nc-border)',
          }}>
          {toast.kind === 'ok' ? '√ ' : '■ '}{toast.msg}
        </div>
      )}
    </div>
  )
}

const TRACK_LABEL: Record<string, { t: string; color: string }> = {
  A: { t: 'A', color: 'var(--nc-cyan-solid)' },
  B: { t: 'B', color: 'var(--nc-magenta)' },
  '?': { t: '?', color: 'var(--nc-dim)' },
}

function statusText(item: QueueItem): { t: string; color: string } {
  switch (item.status) {
    case 'queued': return { t: '·', color: 'var(--nc-dim)' }
    case 'converting':
      return { t: item.progress !== undefined ? `OCR ${Math.round(item.progress * 100)}%` : '»»»', color: 'var(--nc-yellow)' }
    case 'done': return { t: '√ gotowe', color: 'var(--nc-green)' }
    case 'error': return { t: '■ błąd', color: 'var(--nc-red)' }
  }
}

function FileRow({ item, selected, onSelect }: { item: QueueItem; selected: boolean; onSelect: () => void }) {
  const track = item.result ? TRACK_LABEL[item.result.track] : null
  const st = statusText(item)
  const ext = item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.') + 1).toUpperCase() : '—'
  return (
    <div className={`nc-row flex items-center px-1 ${selected ? 'sel' : ''}`} onClick={onSelect}>
      <span className="flex-1 truncate">
        <span style={{ color: selected ? undefined : 'var(--nc-white)' }}>{item.name}</span>
        {item.result?.used_ai && <span style={{ color: 'var(--nc-magenta)' }}> ★</span>}
      </span>
      <span className="w-16 text-right" style={{ color: selected ? undefined : 'var(--nc-dim)' }}>
        {humanSize(item.size)}
      </span>
      <span className="w-8 text-center" style={{ color: selected ? undefined : track?.color || 'var(--nc-dim)' }}>
        {track?.t ?? ext.slice(0, 1)}
      </span>
      <span className="w-24 text-right truncate" style={{ color: selected ? undefined : st.color }}>
        {st.t}
      </span>
    </div>
  )
}

function AiDialog({ ai, setAi, onClose }: {
  ai: AiSettings
  setAi: (a: AiSettings) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
      <div className="nc-dialog w-[92%] max-w-md p-4">
        <div className="text-center font-bold mb-3" style={{ color: 'var(--nc-yellow)' }}>
          ═══ Konfiguracja AI (F2) ═══
        </div>

        <div className="mb-1" style={{ color: 'var(--nc-text)' }}>Tryb OCR skanów:</div>
        <div className="flex gap-2 mb-3">
          {(['off', 'cloud', 'local'] as const).map((m) => (
            <button key={m} className={`nc-seg ${ai.mode === m ? 'on' : ''}`} onClick={() => setAi({ ...ai, mode: m })}>
              {m === 'off' ? 'Offline' : m === 'cloud' ? 'Chmura' : 'Lokalne'}
            </button>
          ))}
        </div>

        {ai.mode === 'off' && (
          <div className="mb-3 text-xs p-2" style={{ color: 'var(--nc-dim)', border: '1px solid var(--nc-border)' }}>
            Skany czyta OCR w przeglądarce
            (tesseract.js / pdf.js). Włącz AI dla trudnych skanów.
          </div>
        )}

        {ai.mode === 'cloud' && (
          <div className="space-y-2 mb-3">
            <Row label="Dostawca">
              <select className="nc-input" value={ai.provider}
                onChange={(e) => setAi({ ...ai, provider: e.target.value as any })}>
                <option value="gemini">Google Gemini</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
              </select>
            </Row>
            <Row label="Klucz API">
              <input className="nc-input" type="password" value={ai.cloudApiKey} placeholder="wklej klucz…"
                onChange={(e) => {
                  const key = e.target.value
                  const detected = detectProvider(key)
                  setAi({ ...ai, cloudApiKey: key, provider: detected ?? ai.provider })
                }} />
            </Row>
            <Row label="Model">
              <input className="nc-input" list="models-cloud" value={ai.cloudModel}
                placeholder={MODEL_SUGGESTIONS[ai.provider][0]}
                onChange={(e) => setAi({ ...ai, cloudModel: e.target.value })} />
              <datalist id="models-cloud">
                {MODEL_SUGGESTIONS[ai.provider].map((m) => <option key={m} value={m} />)}
              </datalist>
            </Row>
          </div>
        )}

        {ai.mode === 'local' && (
          <div className="space-y-2 mb-3">
            <Row label="Endpoint"><input className="nc-input" value={ai.baseUrl}
              placeholder="http://localhost:11434/v1" onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} /></Row>
            <Row label="Model">
              <input className="nc-input" list="models-local" value={ai.localModel} placeholder="llava…"
                onChange={(e) => setAi({ ...ai, localModel: e.target.value })} />
              <datalist id="models-local">
                {MODEL_SUGGESTIONS.local.map((m) => <option key={m} value={m} />)}
              </datalist>
            </Row>
            <Row label="Klucz API"><input className="nc-input" type="password" value={ai.localApiKey} placeholder="opcjonalnie"
              onChange={(e) => setAi({ ...ai, localApiKey: e.target.value })} /></Row>
          </div>
        )}

        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input type="checkbox" checked={ai.ragMode}
            onChange={(e) => setAi({ ...ai, ragMode: e.target.checked })} />
          <span style={{ color: 'var(--nc-text)' }}>Tryb pod RAG</span>
        </label>
        {ai.ragMode && (
          <div className="mb-3 text-xs p-2" style={{ color: 'var(--nc-dim)', border: '1px solid var(--nc-border)' }}>
            Układ pod chunking: front-matter ze źródłem, numery stron jako
            komentarze zamiast linii <b>---</b>, usuwanie powtarzalnych
            nagłówków i stopek.
          </div>
        )}

        <Row label="Język OCR">
          <input className="nc-input" value={ai.ocrLang} placeholder="pol+eng"
            onChange={(e) => setAi({ ...ai, ocrLang: e.target.value })} />
        </Row>

        <div className="text-xs mt-3 mb-3" style={{ color: 'var(--nc-dim)' }}>
          🔒 Klucz jest zapisany w przeglądarce i wysyłany do serwera przy
          każdej konwersji — serwer używa go tylko w obrębie żądania,
          nie zapisuje ani nie loguje.
        </div>

        <div className="flex justify-center gap-3">
          <button className="nc-btn primary" onClick={onClose}>&lt; OK &gt;</button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0" style={{ color: 'var(--nc-text)' }}>{label}:</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

export default App
