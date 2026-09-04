import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { isProThemeArchiveName } from '../../scripts/verify-package'

const root = resolve(import.meta.dir, '../..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('Pro release identity contract', () => {
  const packageJson = JSON.parse(read('package.json')) as { name: string, version: string }
  const manifest = JSON.parse(read('komari-theme.json')) as {
    name: string
    short: string
    version: string
    url: string
    preview: string
    configuration: {
      type: string
      data: Array<{
        key?: string
        name: string
        type: string
        default?: unknown
        options?: string
      }>
    }
  }

  test('uses an independent Pro package and Komari theme id', () => {
    expect(packageJson.name).toBe('komari-theme-emerald-globe-pro')
    expect(manifest.name).toBe('Emerald Globe Pro')
    expect(manifest.short).toBe('emerald-globe-pro')
    expect(manifest.url).toBe('https://github.com/allen0039/komari-theme-emerald-globe-pro')
  })

  test('keeps package and manifest versions synchronized', () => {
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i)
    expect(manifest.version).toBe(packageJson.version)
  })

  test('declares private public-finance settings with safe display defaults', () => {
    const settings = manifest.configuration.data
    const showPublicFinance = settings.find(setting => setting.key === 'showPublicFinance')
    const publicFinanceCurrency = settings.find(setting => setting.key === 'publicFinanceCurrency')
    const renewalWarningDays = settings.find(setting => setting.key === 'renewalWarningDays')

    expect(settings).toContainEqual({ name: '资源财务设置', type: 'title' })
    expect(showPublicFinance).toMatchObject({ type: 'switch', default: false })
    expect(publicFinanceCurrency).toMatchObject({
      type: 'select',
      default: 'CNY',
      options: 'CNY,USD,EUR,GBP,JPY,HKD,KRW,RUB,BRL,INR,AUD,CAD,SGD,THB,VND,MYR,PHP,IDR,NZD,SEK,NOK,DKK,PLN,CZK,HUF,TRY,ZAR,KZT,UAH,CHF',
    })
    expect(renewalWarningDays).toMatchObject({ type: 'number', default: 30 })
  })

  test('preserves the Komari archive contract under a Pro zip name', () => {
    const viteConfig = read('vite.config.ts')

    expect(viteConfig).toMatch(/komari-theme-emerald-globe-pro-build-\$\{commitHash\}\.zip/)
    expect(viteConfig).toContain('archive.file(themeJsonPath, { name: \'komari-theme.json\' })')
    expect(viteConfig).toContain('archive.file(previewPath, { name: \'preview.png\' })')
    expect(viteConfig).toContain('archive.directory(distDir, \'dist\')')
    expect(manifest.preview).toBe('preview.png')
    expect(isProThemeArchiveName('komari-theme-emerald-globe-pro-build-a1b2c3d.zip')).toBe(true)
    expect(isProThemeArchiveName('komari-theme-emerald-globe-pro-build-unknown.zip')).toBe(true)
    expect(isProThemeArchiveName('komari-theme-emerald-globe-build-a1b2c3d.zip')).toBe(false)
  })

  test('links public installation docs and the footer to the Pro repository', () => {
    const readme = read('README.md')

    expect(readme).toContain('https://github.com/allen0039/komari-theme-emerald-globe-pro')
    expect(readme).toContain('komari-theme-emerald-globe-pro-build-')
    expect(read('src/components/Footer.vue'))
      .toContain('https://github.com/allen0039/komari-theme-emerald-globe-pro')
  })
})
