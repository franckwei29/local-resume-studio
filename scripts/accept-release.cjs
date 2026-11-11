const path = require('node:path')
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const executable =
  process.env.STUDIO_APP || path.resolve('release/简历工坊-darwin-arm64/简历工坊.app/Contents/MacOS/简历工坊')
fs.accessSync(executable, fs.constants.X_OK)
const env = { ...process.env, STUDIO_APP: executable, RESUME_STUDIO_EXECUTABLE: executable }
const originalSuites = [
  'acceptance',
  'editor-acceptance',
  'paper-acceptance',
  'import-acceptance',
  'performance',
]
const suites = process.argv.includes('--private')
  ? [...originalSuites, 'private-template-acceptance']
  : [...originalSuites, 'template-acceptance', 'template-recovery', 'template-navigation', 'template-pdf']
if (process.argv.includes('--private')) {
  if (!env.RESUME_TEST_SEED) throw Error('Set RESUME_TEST_SEED to your local baseline file.')
  env.STUDIO_BENCH_SEED = env.RESUME_TEST_SEED
} else {
  delete env.RESUME_TEST_SEED
  delete env.STUDIO_BENCH_SEED
}
function digest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
const reference = env.RESUME_REFERENCE_PDF
const before = reference && digest(reference)
for (const suite of suites) {
  console.log('\n' + suite)
  execFileSync(process.execPath, ['tests/' + suite + '.cjs'], { env, stdio: 'inherit' })
}
if (reference) {
  if (digest(reference) !== before) throw Error('Original reference PDF changed.')
  console.log('PASS original reference PDF SHA-256 unchanged')
}
