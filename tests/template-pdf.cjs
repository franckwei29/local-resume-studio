const { expect } = require('@playwright/test')
const { PNG } = require('playwright-core/lib/utilsBundle')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { ids, withProfile, readyDocument, openPicker, select } = require('./template-harness.cjs')

// Low-pass luminance removes the rasterizers' subpixel/color-fringe and hinting differences.
// Search well beyond 1 mm, so an excessive displacement is measured and rejected.
function luminance(image) {
  const { width, height, data } = image
  const gray = new Float32Array(width * height)
  const temporary = new Float32Array(gray.length)
  for (let i = 0; i < gray.length; i++) {
    const p = 4 * i
    gray[i] = (54 * data[p] + 183 * data[p + 1] + 19 * data[p + 2]) / 256
  }
  const kernel = [1, 4, 6, 4, 1]
  for (let y = 0; y < height; y++)
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x
      for (let k = -2; k <= 2; k++) temporary[i] += (kernel[k + 2] * gray[i + k]) / 16
    }
  for (let y = 2; y < height - 2; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      gray[i] = 0
      for (let k = -2; k <= 2; k++) gray[i] += (kernel[k + 2] * temporary[i + k * width]) / 16
    }
  return gray
}

function matchAnchor(screen, print, width, height, region) {
  const scale = width / 210
  const radius = Math.ceil(2.5 * scale)
  const [left, top, right, bottom] = region.map((mm) => Math.round(mm * scale))
  const x0 = Math.max(radius + 2, left),
    x1 = Math.min(width - radius - 2, right)
  const y0 = Math.max(radius + 2, top),
    y1 = Math.min(height - radius - 2, bottom)
  const n = (x1 - x0) * (y1 - y0)
  assert(n > 16, 'Empty text measurement region')
  let sum = 0,
    squares = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const v = screen[y * width + x]
      sum += v
      squares += v * v
    }
  const variance = squares - (sum * sum) / n
  assert(variance / n > 9, 'Expected a visible text anchor')
  let best = { correlation: -1, dx: 0, dy: 0, error: Infinity }
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      let total = 0,
        squared = 0,
        product = 0,
        difference = 0
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const a = screen[y * width + x],
            b = print[(y + dy) * width + x + dx]
          total += b
          squared += b * b
          product += a * b
          difference += Math.abs(a - b)
        }
      const energy = squared - (total * total) / n
      if (energy <= 0) continue
      const correlation = (product - (sum * total) / n) / Math.sqrt(variance * energy)
      if (correlation > best.correlation) best = { correlation, dx, dy, error: difference / n }
    }
  const drift = Math.hypot(best.dx, best.dy) / scale
  assert(
    best.correlation >= 0.85 && best.error <= 18 && drift <= 1,
    'Raster anchor mismatch ' + JSON.stringify({ ...best, drift, region }),
  )
  return { drift, correlation: best.correlation }
}

// Compare RGB ink density across the entire page in 8 px tiles, including artwork outside text anchors.
function pageDifference(a, b) {
  assert.equal(a.width, b.width)
  assert.equal(a.height, b.height)
  let distance = 0
  for (let y = 0; y < a.height; y += 8)
    for (let x = 0; x < a.width; x += 8) {
      let r = 0,
        g = 0,
        blue = 0
      for (let i = y; i < Math.min(a.height, y + 8); i++)
        for (let j = x; j < Math.min(a.width, x + 8); j++) {
          const k = 4 * (i * a.width + j)
          r += a.data[k] - b.data[k]
          g += a.data[k + 1] - b.data[k + 1]
          blue += a.data[k + 2] - b.data[k + 2]
        }
      distance += Math.abs(r) + Math.abs(g) + Math.abs(blue)
    }
  return distance / (3 * a.width * a.height)
}

const selectedIds = process.argv.slice(2)
for (const id of selectedIds) assert(ids.includes(id), 'Unknown template ' + id)
const address = 'https://example.org/template-proof'
const first = 'StudioProofAlpha',
  last = 'StudioProofOmega'
async function verify({ app, page, dir }) {
  // Use one long, linked document and the normal editor export action for all templates.
  const expansionId = await page.evaluate(
    async ({ first, last, address }) => {
      const [d] = await window.studio.list()
      const project = d.sections.find((s) => s.kind === 'project')
      project.entries[0].blocks.unshift({
        id: crypto.randomUUID(),
        type: 'bullet',
        label: '',
        runs: [{ text: first + ' 中文交付检验', href: address, bold: true }],
        children: [],
      })
      project.entries[1].blocks.push({
        id: crypto.randomUUID(),
        type: 'paragraph',
        label: '',
        runs: [{ text: '跨页校验 English '.repeat(120) + last }],
        children: [],
      })
      await window.studio.save(d, d.revision)
      return project.entries[1].blocks.at(-1).id
    },
    { first, last, address },
  )
  await page.reload()
  // A full A4 sheet must fit inside the editor viewport when capturing the live screen preview.
  await page.setViewportSize({ width: 1800, height: 1450 })
  await page.locator('.doc-title').first().click()
  await page.getByLabel('查看比例').selectOption('1')
  await expect(readyDocument(page)).toBeAttached()
  const stats = {
    templates: 0,
    pages: 0,
    anchors: 0,
    maxRasterDriftMM: 0,
    minCorrelation: 1,
    maxPageColorError: 0,
  }
  for (const id of ids) {
    if (selectedIds.length && !selectedIds.includes(id)) continue
    if (id !== '00') {
      const picker = await openPicker(page)
      await select(picker, id)
      await picker.getByRole('button', { name: '应用此模板', exact: true }).click()
    }
    const rendered = readyDocument(page)
    await expect(rendered).toHaveAttribute('data-template-id', id)
    const pages = rendered.locator('.paper-page')
    const count = await pages.count()
    assert.ok(count >= 2, id + ' must exercise multipage flow')
    if (id === 'E4') {
      const initialPages = await pages.allTextContents()
      await rendered
        .locator('[data-source-id="' + expansionId + '"]')
        .first()
        .click()
      const input = page.locator('[data-editor-id="' + expansionId + '"] [contenteditable=true]').first()
      const initial = await input.innerText()
      await input.fill(initial + ' 新增长段落校验 DraftExpansion'.repeat(1100))
      await expect.poll(() => pages.count()).toBeGreaterThan(count)
      await input.fill(initial)
      await expect(pages).toHaveCount(count)
      assert.deepEqual(
        await pages.allTextContents(),
        initialPages,
        'E4 refills all pages after removing expansion',
      )
    }
    const file = path.join(dir, id + '.pdf')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, file)
    await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
    await expect(page.locator('.toast').filter({ hasText: '已导出 ' + id + '.pdf' })).toBeVisible({
      timeout: 30000,
    })
    const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' })
    assert.match(info, /A4/)
    assert.match(info, new RegExp('Pages:\\s+' + count + '\\b'))
    const rawText = execFileSync('pdftotext', ['-raw', file, '-'], { encoding: 'utf8' })
    const contents = rawText.replace(/\s/gu, '')
    const pdfPages = rawText.split('\f')
    const normalize = (text) => text.normalize('NFKC').replace(/[\s\u200b\u00ad]/gu, '')
    for (let i = 0; i < count; i++) {
      const previewText = await pages.nth(i).textContent()
      const expected = normalize(previewText)
      const extracted = normalize(pdfPages[i])
      if (expected !== extracted) {
        const counts = new Map()
        for (const char of expected) counts.set(char, (counts.get(char) || 0) + 1)
        for (const char of extracted) counts.set(char, (counts.get(char) || 0) - 1)
        const diff = Array.from(counts).filter(([, n]) => n !== 0)
        throw Error(
          id +
            ' page ' +
            (i + 1) +
            (diff.length
              ? ' PDF character counts differ: ' + JSON.stringify(diff).slice(0, 180)
              : ' PDF reading order differs from the live preview'),
        )
      }
    }
    assert.ok(contents.indexOf(first) < contents.indexOf(last), id + ' project reading order')
    assert.ok(
      contents.includes(first) && contents.includes(last) && contents.includes('中文交付检验'),
      id + ' search text',
    )
    assert.equal(contents.indexOf(first), contents.lastIndexOf(first), id + ' duplicate project lead')
    assert.match(
      execFileSync('pdfinfo', ['-url', file], { encoding: 'utf8' }),
      /https:\/\/example\.org\/template-proof/,
    )
    if (id === 'F2') {
      const targets = await rendered.locator('a[href^="#"]').evaluateAll((links) =>
        links.map((link) => {
          const dst = document.getElementById(decodeURIComponent(link.hash.slice(1)))
          const sheet = link.closest('.paper-page')
          const source = sheet.getBoundingClientRect(),
            text = link.getBoundingClientRect()
          return {
            from: Number(sheet.dataset.pageIndex) + 1,
            target: Number(dst?.closest('.paper-page')?.dataset.pageIndex) + 1,
            x: ((text.left + text.width / 2 - source.left) / source.width) * 210,
            y: ((text.top + text.height / 2 - source.top) / source.height) * 297,
          }
        }),
      )
      assert.ok(
        targets.length >= 1 && targets.every((t) => Number.isInteger(t.target)),
        'Live directory targets',
      )
      const pdfLinks = JSON.parse(
        execFileSync(
          'swift',
          [
            '-module-cache-path',
            path.join(os.tmpdir(), 'resume-studio-swift-cache'),
            'tests/fixtures/pdf-navigation.swift',
            file,
          ],
          { encoding: 'utf8' },
        ),
      )
      assert.equal(pdfLinks.length, targets.length, 'Each F2 directory item has its own GoTo annotation')
      for (const link of targets) {
        const index = pdfLinks.findIndex(
          (a) =>
            a.from === link.from &&
            a.target === link.target &&
            Math.abs(a.x - link.x) <= 2 &&
            Math.abs(a.y - link.y) <= 2,
        )
        assert(
          index >= 0,
          'F2 annotation does not lead from the expected label to its live target: ' +
            JSON.stringify({ link, pdfLinks }),
        )
        pdfLinks.splice(index, 1)
      }
    }
    assert.equal(await page.evaluate(() => matchMedia('print').matches), false)
    for (let i = 0; i < count; i++) {
      const el = pages.nth(i)
      await el.scrollIntoViewIfNeeded()
      const regions = await el.evaluate((sheet) => {
        const pageBox = sheet.getBoundingClientRect(),
          mm = 210 / pageBox.width
        const words = Array.from(sheet.querySelectorAll('.paper-line span,.paper-line a')).filter(
          (el) => el.textContent.trim().length > 1,
        )
        const rows = [0, Math.floor(words.length / 2), words.length - 1].filter(
          (n, i, a) => n >= 0 && a.indexOf(n) === i,
        )
        return rows.map((n) => {
          const b = words[n].getBoundingClientRect()
          const x = (b.left - pageBox.left) * mm,
            y = (b.top - pageBox.top) * mm
          return [
            Math.max(2, x - 1),
            Math.max(2, y - 1),
            Math.min(207, x + Math.min(b.width * mm, 62) + 1),
            Math.min(294, y + b.height * mm + 1),
          ]
        })
      })
      assert.ok(regions.length > 0, id + ' empty paper page ' + i)
      const pixels = PNG.sync.read(
        await el.screenshot({ scale: 'css', style: '.toast{visibility:hidden!important}' }),
      )
      const prefix = path.join(dir, 'rendered')
      execFileSync('pdftoppm', [
        '-f',
        String(i + 1),
        '-l',
        String(i + 1),
        '-singlefile',
        '-scale-to-x',
        String(pixels.width),
        '-scale-to-y',
        String(pixels.height),
        '-png',
        file,
        prefix,
      ])
      const pdf = PNG.sync.read(await fs.readFile(prefix + '.png'))
      const screen = luminance(pixels),
        print = luminance(pdf)
      try {
        const colorError = pageDifference(pixels, pdf)
        assert(colorError <= 9, 'Page colour/ink template differs: ' + colorError)
        stats.maxPageColorError = Math.max(stats.maxPageColorError, colorError)
        for (const region of regions) {
          const { drift, correlation } = matchAnchor(screen, print, pixels.width, pixels.height, region)
          stats.maxRasterDriftMM = Math.max(stats.maxRasterDriftMM, drift)
          stats.minCorrelation = Math.min(stats.minCorrelation, correlation)
          stats.anchors++
        }
      } catch (cause) {
        const debug = await fs.mkdtemp(path.join(os.tmpdir(), 'template-raster-diagnostic-'))
        await fs.writeFile(path.join(debug, 'preview.png'), PNG.sync.write(pixels))
        await fs.copyFile(prefix + '.png', path.join(debug, 'pdf.png'))
        await fs.copyFile(file, path.join(debug, 'document.pdf'))
        throw Error(id + ' page ' + (i + 1) + ' images: ' + debug + ' ' + cause.message)
      }
      stats.pages++
    }
    stats.templates++
    console.log('PDF', id, count, 'pages')
  }
  if (selectedIds.length) console.log('T10 selected diagnostic', JSON.stringify(stats))
  else {
    assert.equal(stats.templates, 31)
    console.log('PASS T10', JSON.stringify(stats))
  }
}
withProfile('resume-template-pdf', verify).catch((e) => {
  console.error(e)
  process.exitCode = 1
})
