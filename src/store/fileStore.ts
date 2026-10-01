import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {dirname} from 'node:path'
import type {AuditEvent, ListingDraft} from '../types.js'
import type {Store, StoredDoc} from './store.js'

interface FileShape {
  docs: Record<string, StoredDoc>
  audit: AuditEvent[]
}

/** Local JSON store with the same shape as the Sanity documents. Used when no write token is set. */
export class FileStore implements Store {
  readonly kind = 'file'
  constructor(private readonly path: string) {}

  private load(): FileShape {
    if (!existsSync(this.path)) return {docs: {}, audit: []}
    return JSON.parse(readFileSync(this.path, 'utf8'))
  }

  private save(data: FileShape): void {
    mkdirSync(dirname(this.path), {recursive: true})
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, this.path)
  }

  async createWithAudit(doc: StoredDoc, audit: AuditEvent): Promise<void> {
    const data = this.load()
    if (data.docs[doc._id]) throw new Error(`Document ${doc._id} already exists`)
    data.docs[doc._id] = doc
    data.audit.push(audit)
    this.save(data)
  }

  async patchWithAudit(id: string, set: Partial<ListingDraft>, audit: AuditEvent): Promise<void> {
    const data = this.load()
    const doc = data.docs[id]
    if (!doc) throw new Error(`No document ${id}`)
    data.docs[id] = {...doc, ...set} as StoredDoc
    data.audit.push(audit)
    this.save(data)
  }

  async get<T extends StoredDoc>(id: string): Promise<T | null> {
    return (this.load().docs[id] as T) ?? null
  }

  async listDrafts(status?: string): Promise<ListingDraft[]> {
    return Object.values(this.load().docs)
      .filter((d): d is ListingDraft => d._type === 'listingDraft' && (!status || d.status === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async auditLog(subjectId?: string): Promise<AuditEvent[]> {
    return this.load().audit.filter((e) => !subjectId || e.subjectId === subjectId)
  }
}
