import type { Resume } from './model'
export interface ImportPage {
  page: number
  total: number
  method: 'ocr' | 'pdf' | 'docx'
  lines: string[]
  image?: string
  warning?: string
}
export interface ImportedFile {
  name: string
  pages: ImportPage[]
}
export interface Progress {
  page: number
  total: number
  method: string
}
export interface DesktopBridge {
  initialize(publicSeed: Resume): Promise<Resume>
  personalSeed(): Promise<Resume | null>
  list(): Promise<Resume[]>
  save(doc: Resume, expectedRevision?: number): Promise<Resume>
  remove(id: string): Promise<void>
  backup(doc: Resume): Promise<string | null>
  restore(): Promise<Resume | null>
  exportPDF(id: string, name: string, revision: number): Promise<string | null>
  openOutput(path: string): Promise<void>
  revealOutput(path: string): Promise<void>
  importFile(): Promise<ImportedFile | null>
  cancelImport(): Promise<void>
  onImportProgress(fn: (progress: Progress) => void): () => void
  onBeforeClose(fn: () => void): () => void
  closeReady(): Promise<void>
}
declare global {
  interface Window {
    studio: DesktopBridge
  }
}
