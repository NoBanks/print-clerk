export type Channel = 'marketplace' | 'instagram' | 'x' | 'newsletter'
export const CHANNELS: Channel[] = ['marketplace', 'instagram', 'x', 'newsletter']

export type FormatStatus = 'available' | 'on_hold' | 'sold' | 'retired'

export interface FormatFact {
  label: string
  widthIn: number
  heightIn: number
  framed?: boolean
  priceUsd: number
  status: FormatStatus
}

/** The projection every artwork query returns. One shape, used by drafting and by the verifier. */
export interface ArtworkFact {
  _id: string
  title: string
  slug: string
  catalogCode?: string
  medium?: string
  story?: string
  altText?: string
  tags?: string[]
  isSample?: boolean
  collection: {_id: string; title: string; statement?: string; namingRule?: string}
  formats: FormatFact[]
}

export interface DraftCopy {
  title: string
  body: string
  model: string
}

export type DraftStatus = 'needs_review' | 'blocked' | 'approved' | 'rejected'

export interface Verification {
  ok: boolean
  issues: string[]
  factsHash: string
}

export interface ListingDraft {
  _id: string
  _type: 'listingDraft'
  artwork: {_type: 'reference'; _ref: string}
  channel: Channel
  title: string
  body: string
  status: DraftStatus
  verification: Verification
  sourceDocIds: string[]
  model: string
  createdAt: string
  reviewedAt?: string
  reviewer?: string
  reviewNote?: string
}

export interface Inquiry {
  _id: string
  _type: 'inquiry'
  question: string
  answer: string
  /** What the model wrote, kept for the reviewer even when it was not sent. */
  modelAnswer: string
  status: 'answered' | 'escalated'
  issues: string[]
  sourceDocIds: string[]
  createdAt: string
}

export interface AuditEvent {
  _id: string
  _type: 'auditEvent'
  at: string
  actor: string
  action: string
  subjectId: string
  details: string
}
