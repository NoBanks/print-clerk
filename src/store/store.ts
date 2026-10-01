import type {AuditEvent, Inquiry, ListingDraft} from '../types.js'

export type StoredDoc = ListingDraft | Inquiry

/**
 * Where the agent's output goes. The Context MCP is read-only, so writes use a
 * separate, narrowly scoped path: drafts, inquiries and audit events only.
 * Every write is paired with its audit event in one commit.
 */
export interface Store {
  readonly kind: string
  createWithAudit(doc: StoredDoc, audit: AuditEvent): Promise<void>
  patchWithAudit(id: string, set: Partial<ListingDraft>, audit: AuditEvent): Promise<void>
  get<T extends StoredDoc>(id: string): Promise<T | null>
  listDrafts(status?: string): Promise<ListingDraft[]>
  auditLog(subjectId?: string): Promise<AuditEvent[]>
}
