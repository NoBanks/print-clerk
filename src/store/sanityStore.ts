import type {SanityClient} from '@sanity/client'
import type {AuditEvent, ListingDraft} from '../types.js'
import type {Store, StoredDoc} from './store.js'

/**
 * Writes to the Sanity dataset with @sanity/client. Use a token whose role can
 * only create and update listingDraft, inquiry and auditEvent documents.
 */
export class SanityStore implements Store {
  readonly kind = 'sanity'
  constructor(private readonly client: SanityClient) {}

  async createWithAudit(doc: StoredDoc, audit: AuditEvent): Promise<void> {
    await this.client.transaction().create(doc as any).create(audit as any).commit()
  }

  async patchWithAudit(id: string, set: Partial<ListingDraft>, audit: AuditEvent): Promise<void> {
    await this.client.transaction().patch(id, (p) => p.set(set)).create(audit as any).commit()
  }

  async get<T extends StoredDoc>(id: string): Promise<T | null> {
    return this.client.fetch<T | null>('*[_id == $id][0]', {id})
  }

  async listDrafts(status?: string): Promise<ListingDraft[]> {
    return this.client.fetch<ListingDraft[]>(
      '*[_type == "listingDraft" && (!defined($status) || status == $status)] | order(createdAt desc)',
      {status: status ?? null},
    )
  }

  async auditLog(subjectId?: string): Promise<AuditEvent[]> {
    return this.client.fetch<AuditEvent[]>(
      '*[_type == "auditEvent" && (!defined($subjectId) || subjectId == $subjectId)] | order(at asc)',
      {subjectId: subjectId ?? null},
    )
  }
}
