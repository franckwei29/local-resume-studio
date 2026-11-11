const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

async function makeImportFixtures(dir) {
  execFileSync('/usr/bin/swift', [
    '-module-cache-path',
    path.join(os.tmpdir(), 'resume-studio-swift-cache'),
    'tests/fixtures/import.swift',
    dir,
  ])
  await fs.mkdir(path.join(dir, 'word'))
  await fs.writeFile(
    path.join(dir, 'word/document.xml'),
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      ['教育背景', '北湖大学 软件工程 硕士 2022.09—2025.07', '西山学院 数学 本科 2018.09—2022.07']
        .map((s) => '<w:p><w:r><w:t>' + s + '</w:t></w:r></w:p>')
        .join('') +
      '</w:body></w:document>',
  )
  await fs.writeFile(
    path.join(dir, '[Content_Types].xml'),
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  await fs.mkdir(path.join(dir, '_rels'))
  await fs.writeFile(
    path.join(dir, '_rels/.rels'),
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  execFileSync('/usr/bin/zip', ['-q', '-r', 'education.docx', 'word', '_rels', '[Content_Types].xml'], {
    cwd: dir,
  })
}
module.exports = { makeImportFixtures }
