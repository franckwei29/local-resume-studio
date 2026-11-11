const { execFileSync } = require('node:child_process')
const { mkdirSync, statSync, existsSync } = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const source = path.join(root, 'native', 'ResumeImport.swift')
const output = path.join(root, 'native', 'bin', 'resume-import')
mkdirSync(path.dirname(output), { recursive: true })
if (!existsSync(output) || statSync(output).mtimeMs < statSync(source).mtimeMs) {
  execFileSync('/usr/bin/swiftc', ['-O', '-target', 'arm64-apple-macos13.0',
    '-module-cache-path', path.join(require('node:os').tmpdir(), 'resume-studio-swift-cache'),
    source, '-o', output], { stdio: 'inherit' })
}
