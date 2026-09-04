import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dir, '..')
const expectedPattern = /^komari-theme-emerald-globe-pro-build-(?:[0-9a-f]+|unknown)\.zip$/

export function isProThemeArchiveName(fileName: string): boolean {
  return expectedPattern.test(fileName)
}

function resolveArchive(): string {
  const explicitPath = process.argv[2]
  if (explicitPath)
    return resolve(process.cwd(), explicitPath)

  const archives = readdirSync(root)
    .filter(isProThemeArchiveName)
    .map(file => resolve(root, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)

  if (!archives[0])
    throw new Error('No Pro theme archive found. Run `bun run build` first.')

  return archives[0]
}

export function verifyPackage(): void {
  const archivePath = resolveArchive()
  const archiveName = basename(archivePath)

  if (!isProThemeArchiveName(archiveName))
    throw new Error(`Unexpected archive name: ${archiveName}`)

  const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
    .split('\n')
    .map(entry => entry.trim())
    .filter(Boolean)

  for (const requiredEntry of ['komari-theme.json', 'preview.png']) {
    if (!entries.includes(requiredEntry))
      throw new Error(`Archive is missing ${requiredEntry}`)
  }

  if (!entries.some(entry => entry.startsWith('dist/') && entry !== 'dist/'))
    throw new Error('Archive is missing compiled files under dist/')

  const invalidEntries = entries.filter(entry =>
    entry !== 'komari-theme.json'
    && entry !== 'preview.png'
    && entry !== 'dist/'
    && !entry.startsWith('dist/'),
  )

  if (invalidEntries.length > 0)
    throw new Error(`Archive contains unexpected entries: ${invalidEntries.join(', ')}`)

  console.log(`[verify-package] ${archiveName}: ${entries.length} entries, contract valid`)
}

if (import.meta.main)
  verifyPackage()
