// Kopiuje lokalnie zasoby OCR, żeby tesseract.js nie sięgał w czasie działania
// po jsDelivr. Bez tego pierwszy OCR wymaga internetu, a aplikacja deklarująca
// pracę offline jej nie realizuje.
//
// Trzy zasoby, trzy różne domyślne CDN-y w tesseract.js:
//   workerPath -> tesseract.js@vX/dist/worker.min.js
//   corePath   -> tesseract.js-core@vX (worker dokleja nazwę wariantu)
//   langPath   -> @tesseract.js-data/<lang>/4.0.0_best_int
//
// Worker i rdzeń bierzemy z node_modules, nie z sieci — dzięki temu wersja
// zawsze zgadza się z zainstalowaną biblioteką. Modele językowe w npm nie są
// zależnością, więc te pobieramy.
//
// Uruchomienie: npm run ocr:assets
import { createWriteStream } from 'node:fs'
import { mkdir, copyFile, stat, readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'tesseract')
const modules = join(root, 'node_modules')

// Języki muszą pokrywać domyślne `ocrLang` z App.tsx ('pol+eng').
const LANGS = ['pol', 'eng']

// createWorker(lang, 1, ...) to OEM 1 = LSTM_ONLY, więc worker sięgnie wyłącznie
// po warianty `-lstm`. Wszystkie trzy są konieczne: wybór zależy od tego, czy
// przeglądarka ma relaxed SIMD, samo SIMD, czy nie ma żadnego.
const CORE_FILES = [
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
]

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1)

async function copyInto(from, to, label) {
  await copyFile(from, to)
  const { size } = await stat(to)
  console.log(`  ${label.padEnd(42)} ${mb(size).padStart(6)} MB`)
}

// Model językowy jest gzipowany — tesseract.js rozpoznaje nagłówek gzip
// po magic bytes i rozpakowuje sam, więc trzymamy `.gz` (ok. połowa rozmiaru).
async function download(url, dest, label) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  const { size } = await stat(dest)
  console.log(`  ${label.padEnd(42)} ${mb(size).padStart(6)} MB`)
}

const tesseractVersion = (await readJson(join(modules, 'tesseract.js', 'package.json'))).version
const coreVersion = (await readJson(join(modules, 'tesseract.js-core', 'package.json'))).version
console.log(`tesseract.js ${tesseractVersion} · tesseract.js-core ${coreVersion}\n`)

await mkdir(join(outDir, 'core'), { recursive: true })
await mkdir(join(outDir, 'tessdata'), { recursive: true })

await copyInto(
  join(modules, 'tesseract.js', 'dist', 'worker.min.js'),
  join(outDir, 'worker.min.js'),
  'worker.min.js',
)

for (const file of CORE_FILES) {
  await copyInto(join(modules, 'tesseract.js-core', file), join(outDir, 'core', file), `core/${file}`)
}

for (const lang of LANGS) {
  const name = `${lang}.traineddata.gz`
  await download(
    `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int/${name}`,
    join(outDir, 'tessdata', name),
    `tessdata/${name}`,
  )
}

console.log('\nGotowe. Zasoby OCR leżą w public/tesseract/.')
