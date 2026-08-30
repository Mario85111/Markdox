// Odtwarzanie struktury Markdown z danych układu zwracanych przez tesseract.js.
//
// Sam `data.text` to surowy tekst z twardymi łamaniami linii w miejscach
// wizualnych końców wierszy — dla RAG najgorszy możliwy materiał: splitter
// tnie w środku zdania, a chunk nie ma nagłówka niosącego kontekst sekcji.
//
// Tesseract zwraca jednak bloki → akapity → linie → słowa, każde z `bbox`.
// Z wysokości wiersza względem mediany strony da się odtworzyć nagłówki,
// a znając granice akapitów — skleić wiersze z powrotem w zdania.
// Bez żadnego modelu.

interface Bbox { x0: number; y0: number; x1: number; y1: number }
interface OcrLine { text: string; bbox: Bbox }
interface OcrParagraph { lines: OcrLine[] }
interface OcrBlock { paragraphs: OcrParagraph[] }

// Progi wysokości wiersza względem mediany tekstu podstawowego.
const H1_RATIO = 1.8
const H2_RATIO = 1.35
const H3_RATIO = 1.15
// Nagłówek to krótki wiersz — długie zdanie dużą czcionką to lead, nie nagłówek.
const MAX_HEADING_CHARS = 90

const BULLET_RE = /^\s*(?:[•·▪◦‣*+-]|\d{1,2}[.)])\s+/
// Wiersz zakończony dywizem to przeniesienie wyrazu, nie koniec zdania.
const HYPHEN_END_RE = /(\p{L})-$/u

// Uwaga: NIE używamy `rowAttributes.rowHeight`. Dla tego samego tekstu 20 px
// potrafi zwrócić raz 28.1, raz 18 — zawiera zapas na wydłużenia górne i dolne,
// więc zależy od tego, jakie litery trafiły się w wierszu. `bbox` jest stabilny.
const lineHeight = (line: OcrLine): number => Math.max(0, line.bbox.y1 - line.bbox.y0)

const median = (values: number[]): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const headingLevel = (ratio: number): number | null => {
  if (ratio >= H1_RATIO) return 1
  if (ratio >= H2_RATIO) return 2
  if (ratio >= H3_RATIO) return 3
  return null
}

/** Skleja wiersze akapitu w ciągły tekst, cofając przeniesienia wyrazów. */
function joinWrappedLines(texts: string[]): string {
  return texts.reduce((acc, raw) => {
    const part = raw.trim()
    if (!part) return acc
    if (!acc) return part
    if (HYPHEN_END_RE.test(acc)) return acc.slice(0, -1) + part
    return `${acc} ${part}`
  }, '')
}

type Kind = 'heading' | 'bullet' | 'body'
interface Classified { kind: Kind; text: string; level: number; para: number }

/**
 * Zamienia bloki tesseract.js na Markdown z nagłówkami, listami i akapitami.
 * Przy braku danych układu zwraca pusty ciąg — wywołujący ma wtedy użyć
 * surowego tekstu.
 */
export function blocksToMarkdown(blocks: OcrBlock[] | null | undefined): string {
  if (!blocks?.length) return ''

  // Spłaszczamy do listy wierszy, zapamiętując numer akapitu. Klasyfikacja
  // musi iść po wierszach, bo Tesseract potrafi wstawić nagłówek do tego
  // samego akapitu co poprzedzająca go treść.
  const flat: { text: string; height: number; para: number }[] = []
  let para = 0
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = line.text?.trim()
        if (text) flat.push({ text, height: lineHeight(line), para })
      }
      para += 1
    }
  }
  if (!flat.length) return ''

  // Nagłówków jest z definicji mniej niż treści, więc mediana wypada
  // na tekście podstawowym.
  const body = median(flat.map((l) => l.height))
  if (!body) return ''

  const classified: Classified[] = flat.map((l) => {
    if (BULLET_RE.test(l.text)) {
      return { kind: 'bullet', text: l.text.replace(BULLET_RE, ''), level: 0, para: l.para }
    }
    const level = headingLevel(l.height / body)
    if (level && l.text.length <= MAX_HEADING_CHARS) {
      return { kind: 'heading', text: l.text, level, para: l.para }
    }
    return { kind: 'body', text: l.text, level: 0, para: l.para }
  })

  const out: string[] = []
  let buffer: Classified[] = []

  const flush = () => {
    if (!buffer.length) return
    if (buffer[0].kind === 'bullet') {
      out.push(buffer.map((b) => `- ${b.text}`).join('\n'))
    } else {
      out.push(joinWrappedLines(buffer.map((b) => b.text)))
    }
    buffer = []
  }

  for (const line of classified) {
    if (line.kind === 'heading') {
      flush()
      out.push(`${'#'.repeat(line.level)} ${line.text}`)
      continue
    }
    const prev = buffer[buffer.length - 1]
    // Zmiana rodzaju kończy grupę zawsze. Granica akapitu — tylko dla treści:
    // Tesseract daje każdemu punktorowi własny akapit, a rozbicie listy pustymi
    // liniami sprawia, że splitter tnie ją na osobne chunki.
    if (prev && (prev.kind !== line.kind || (line.kind === 'body' && prev.para !== line.para))) {
      flush()
    }
    buffer.push(line)
  }
  flush()

  return out.filter(Boolean).join('\n\n')
}
