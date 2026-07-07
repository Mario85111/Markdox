// OCR po stronie przeglądarki — bez instalowania czegokolwiek w systemie.
// Obrazy: tesseract.js. Skany PDF: pdf.js rasteryzuje strony, potem tesseract.js.
import { createWorker, type Worker } from 'tesseract.js'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const IMAGE_RE = /\.(jpe?g|png|webp|bmp|tiff?)$/i

export const isImageName = (name: string) => IMAGE_RE.test(name)
export const isPdfName = (name: string) => /\.pdf$/i.test(name)

type ProgressCb = (fraction: number) => void

async function makeWorker(lang: string, onProgress?: ProgressCb): Promise<Worker> {
  return createWorker(lang, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress)
    },
  })
}

export async function ocrImageFile(
  file: File,
  lang: string,
  onProgress?: ProgressCb,
): Promise<string> {
  const worker = await makeWorker(lang, onProgress)
  try {
    const { data } = await worker.recognize(file)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}

export async function ocrPdfFile(
  file: File,
  lang: string,
  onProgress?: ProgressCb,
): Promise<string> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const worker = await makeWorker(lang)
  const pages: string[] = []
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      // pdf.js v6: przekazujemy `canvas` (nie canvasContext) — inaczej konflikt.
      await page.render({ canvas, viewport }).promise
      const { data } = await worker.recognize(canvas)
      pages.push(data.text.trim())
      page.cleanup()
      onProgress?.(p / pdf.numPages)
    }
  } finally {
    await worker.terminate()
  }
  return pages.filter(Boolean).join('\n\n---\n\n')
}
