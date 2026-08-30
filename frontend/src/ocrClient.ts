// OCR po stronie przeglądarki — bez instalowania czegokolwiek w systemie.
// Obrazy: tesseract.js. Skany PDF: pdf.js rasteryzuje strony, potem tesseract.js.
import { createWorker, type Worker } from 'tesseract.js'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { blocksToMarkdown } from './ocrLayout'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const IMAGE_RE = /\.(jpe?g|png|webp|bmp|tiff?)$/i

export const isImageName = (name: string) => IMAGE_RE.test(name)
export const isPdfName = (name: string) => /\.pdf$/i.test(name)

type ProgressCb = (fraction: number) => void

/** Wynik OCR jednej strony: Markdown plus średnia pewność odczytu (0–100). */
export interface OcrPage {
  markdown: string
  confidence: number
}

// Od tesseract.js v5 dane układu są opcjonalne — bez tego dostajemy
// wyłącznie `text`, czyli tracimy nagłówki i granice akapitów.
const OUTPUT = { text: true, blocks: true }

async function makeWorker(lang: string, onProgress?: ProgressCb): Promise<Worker> {
  return createWorker(lang, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress)
    },
  })
}

/** Preferuje strukturę z układu; przy jej braku wraca do surowego tekstu. */
function toPage(data: { text: string; blocks: unknown; confidence: number }): OcrPage {
  const structured = blocksToMarkdown(data.blocks as never)
  return {
    markdown: (structured || data.text || '').trim(),
    confidence: data.confidence ?? 0,
  }
}

export async function ocrImageFile(
  file: File,
  lang: string,
  onProgress?: ProgressCb,
): Promise<OcrPage> {
  const worker = await makeWorker(lang, onProgress)
  try {
    const { data } = await worker.recognize(file, {}, OUTPUT)
    return toPage(data)
  } finally {
    await worker.terminate()
  }
}

// Zwracamy strony osobno, nie sklejony tekst — wywołujący potrzebuje
// granic stron do prowenancji (numer strony w cytowaniu RAG).
export async function ocrPdfFile(
  file: File,
  lang: string,
  onProgress?: ProgressCb,
): Promise<OcrPage[]> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const worker = await makeWorker(lang)
  const pages: OcrPage[] = []
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      // pdf.js v6: przekazujemy `canvas` (nie canvasContext) — inaczej konflikt.
      await page.render({ canvas, viewport }).promise
      const { data } = await worker.recognize(canvas, {}, OUTPUT)
      pages.push(toPage(data))
      page.cleanup()
      onProgress?.(p / pdf.numPages)
    }
  } finally {
    await worker.terminate()
  }
  return pages
}
