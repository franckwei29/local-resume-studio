const path = require('node:path')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const executable =
  process.env.STUDIO_APP || path.resolve('release/简历工坊-darwin-arm64/简历工坊.app/Contents/MacOS/简历工坊')
fs.accessSync(executable, fs.constants.X_OK)
const env = { ...process.env, STUDIO_APP: executable, RESUME_STUDIO_EXECUTABLE: executable }
for (const suite of [
  'acceptance',
  'editor-acceptance',
  'paper-acceptance',
  'import-acceptance',
  'performance',
]) {
  console.log('\n' + suite)
  execFileSync(process.execPath, ['tests/' + suite + '.cjs'], { env, stdio: 'inherit' })
}
