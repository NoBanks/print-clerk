import {randomUUID} from 'node:crypto'
import {generateText, stepCountIs, type LanguageModel} from 'ai'
import type {SanityContext} from './context/client.js'
import {Ledger} from './ledger.js'
import {artworkById, artworkBySlug, COLLECTION_TITLES} from './queries.js'
import type {Store} from './store/store.js'
import type {ArtworkFact, AuditEvent, Channel, DraftCopy, Inquiry, ListingDraft} from './types.js'
import {autofixStyle, verify} from './verify.js'
import type {Writer} from './writers.js'

export const ESCALATION_REPLY =
  'Thanks for asking. I want to get this exactly right, so I have passed your question to the artist and you will hear back directly.'

export interface ClerkOptions {
  /** Needed for ask(). Drafting works without one (TemplateWriter). */
  model?: LanguageModel
  modelId?: string
  now?: () => Date
}

/**
 * Agent output lives under the "clerk." id path. Sanity does not serve documents
 * whose ids contain a dot to unauthenticated readers, so the catalog can sit in a
 * public dataset while drafts, inquiries and the audit log stay private.
 */
export function clerkId(kind: 'draft' | 'inquiry' | 'audit'): string {
  return `clerk.${kind}.${randomUUID()}`
}

function audit(actor: string, action: string, subjectId: string, details: unknown, at: string): AuditEvent {
  return {
    _id: clerkId('audit'),
    _type: 'auditEvent',
    at,
    actor,
    action,
    subjectId,
    details: typeof details === 'string' ? details : JSON.stringify(details),
  }
}

/**
 * Pull entry paths out of a Knowledge Base outline. The emulator writes "- path [core]: title";
 * the hosted Context endpoint writes bare "path [core]" lines under a "# Knowledge bases" heading
 * (seen live 2026-10-02), so both shapes are accepted.
 */
export function outlinePaths(outline: string): Array<{path: string; core: boolean}> {
  const kbAt = outline.search(/^#\s+Knowledge bases\s*$/m)
  const text = kbAt >= 0 ? outline.slice(kbAt) : outline
  const bulleted = [...text.matchAll(/^\s*[-*]\s+([\w./-]+)(.*)$/gm)].map((m) => ({path: m[1], core: /\[core\]/.test(m[2])}))
  if (bulleted.length) return bulleted
  return [...text.matchAll(/^\s*([a-z0-9][\w./-]*)((?:\s+\[core\])?)\s*$/gm)].map((m) => ({path: m[1], core: m[2].includes('[core]')}))
}

export class PrintClerk {
  private readonly now: () => Date

  constructor(
    private readonly ctx: SanityContext,
    private readonly store: Store,
    private readonly writer: Writer,
    private readonly opts: ClerkOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date())
  }

  private iso(): string {
    return this.now().toISOString()
  }

  /** Knowledge Base guidance for one piece: every [core] entry plus anything about its collection. */
  private async guidanceFor(a: ArtworkFact, ledger: Ledger): Promise<string> {
    if (!this.ctx.hasKnowledgeBase) return ''
    const outline = await this.ctx.knowledgeBaseOutline()
    const collSlug = a.collection.title.toLowerCase().replace(/\s+/g, '-')
    const paths = outlinePaths(outline)
      .filter((p) => p.core || p.path.includes(collSlug) || (/astronaut/.test(p.path) && a.tags?.includes('astronaut')))
      .map((p) => p.path)
      .slice(0, 20)
    return paths.length ? this.ctx.knowledgeBaseRead(paths, ledger) : ''
  }

  async draft(slug: string, channel: Channel): Promise<ListingDraft> {
    const ledger = new Ledger()
    const artwork = await this.ctx.groqQuery<ArtworkFact | null>(artworkBySlug(slug), ledger)
    if (!artwork) throw new Error(`No artwork with slug "${slug}" in the dataset`)
    const collections = await this.ctx.groqQuery<string[]>(COLLECTION_TITLES, ledger)
    const guidance = await this.guidanceFor(artwork, ledger)

    const check = (c: DraftCopy) =>
      verify({
        text: `${c.title}\n${c.body}`,
        artworks: [artwork],
        focusId: artwork._id,
        knownCollections: collections,
        groundingText: ledger.groundingText,
        channel,
      })
    const fix = (c: DraftCopy): DraftCopy => ({...c, title: autofixStyle(c.title), body: autofixStyle(c.body)})

    let copy = fix(await this.writer.write({artwork, channel, guidance}))
    let v = check(copy)
    let attempts = 1
    if (!v.ok && this.writer.canRevise) {
      copy = fix(await this.writer.write({artwork, channel, guidance, previousIssues: v.issues, previous: copy}))
      v = check(copy)
      attempts = 2
    }

    const draft: ListingDraft = {
      _id: clerkId('draft'),
      _type: 'listingDraft',
      artwork: {_type: 'reference', _ref: artwork._id},
      channel,
      title: copy.title,
      body: copy.body,
      status: v.ok ? 'needs_review' : 'blocked',
      verification: v,
      sourceDocIds: [...ledger.sourceIds],
      model: copy.model,
      createdAt: this.iso(),
    }
    await this.store.createWithAudit(
      draft,
      audit('agent', v.ok ? 'draft.created' : 'draft.blocked', draft._id, {slug, channel, attempts, writer: copy.model, issues: v.issues}, draft.createdAt),
    )
    return draft
  }

  /**
   * Answer a buyer question. The model explores the catalog through Context MCP
   * tools; its answer is then checked against exactly what those tools returned.
   * Anything unverifiable is not sent: the buyer gets a holding reply and the
   * question goes to a human.
   */
  async ask(question: string): Promise<Inquiry> {
    if (!this.opts.model) throw new Error('ask needs a model: set LLM_BASE_URL (and LLM_API_KEY / LLM_MODEL if your endpoint needs them)')
    const ledger = new Ledger()
    const overview = await this.ctx.schemaOverview()
    const outline = await this.ctx.knowledgeBaseOutline()
    const result = await generateText({
      model: this.opts.model,
      system: [
        'You answer buyer questions for NoBanks Nearby framed art prints.',
        'Look facts up with groq_query before answering. Prices and availability live on artwork.formats[]; a price belongs to exactly one size.',
        'Read Knowledge Base entries with knowledge_base_read for policies.',
        'State a price only together with its size. If the catalog does not answer the question, say you will check with the artist.',
        'No em dashes. Plain text. Short.',
        `SCHEMA OVERVIEW:\n${overview}`,
        outline ? `KNOWLEDGE BASE OUTLINE:\n${outline}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      prompt: question,
      tools: this.ctx.agentTools(ledger),
      stopWhen: stepCountIs(8),
    })
    const modelAnswer = autofixStyle(result.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim())
    const v = verify({text: modelAnswer, artworks: ledger.artworkList(), groundingText: ledger.groundingText, channel: 'answer'})
    const ok = v.ok && modelAnswer.length > 0
    const inquiry: Inquiry = {
      _id: clerkId('inquiry'),
      _type: 'inquiry',
      question,
      answer: ok ? modelAnswer : ESCALATION_REPLY,
      modelAnswer,
      status: ok ? 'answered' : 'escalated',
      issues: modelAnswer ? v.issues : ['empty answer'],
      sourceDocIds: [...ledger.sourceIds],
      createdAt: this.iso(),
    }
    await this.store.createWithAudit(
      inquiry,
      audit('agent', ok ? 'inquiry.answered' : 'inquiry.escalated', inquiry._id, {issues: inquiry.issues, toolCalls: result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName))}, inquiry.createdAt),
    )
    return inquiry
  }

  private async mustGetDraft(id: string): Promise<ListingDraft> {
    const d = await this.store.get<ListingDraft>(id)
    if (!d || d._type !== 'listingDraft') throw new Error(`No listing draft ${id}`)
    return d
  }

  /** Re-verify a draft against the catalog as it is right now. */
  private async reverify(d: ListingDraft) {
    const ledger = new Ledger()
    const artwork = await this.ctx.groqQuery<ArtworkFact | null>(artworkById(d.artwork._ref), ledger)
    const collections = await this.ctx.groqQuery<string[]>(COLLECTION_TITLES, ledger)
    return verify({
      text: `${d.title}\n${d.body}`,
      artworks: artwork ? [artwork] : [],
      focusId: d.artwork._ref,
      knownCollections: collections,
      groundingText: ledger.groundingText,
      channel: d.channel,
    })
  }

  /**
   * Human approval. Prices or availability can change between drafting and
   * approval, so the draft is checked again against live content first.
   */
  async approve(id: string, reviewer: string, note?: string): Promise<ListingDraft> {
    const d = await this.mustGetDraft(id)
    if (d.status !== 'needs_review') throw new Error(`Draft ${id} is ${d.status}; only needs_review drafts can be approved`)
    const v = await this.reverify(d)
    const at = this.iso()
    if (!v.ok) {
      await this.store.patchWithAudit(id, {status: 'blocked', verification: v}, audit(`human:${reviewer}`, 'approve.refused', id, {issues: v.issues}, at))
      throw new Error(`Approval refused, the catalog changed since this draft was written:\n- ${v.issues.join('\n- ')}`)
    }
    const set: Partial<ListingDraft> = {status: 'approved', reviewer, reviewedAt: at, reviewNote: note, verification: v}
    const changed = v.factsHash !== d.verification.factsHash
    await this.store.patchWithAudit(id, set, audit(`human:${reviewer}`, 'draft.approved', id, {note, factsChangedButStillTrue: changed}, at))
    return {...d, ...set}
  }

  async reject(id: string, reviewer: string, reason: string): Promise<ListingDraft> {
    const d = await this.mustGetDraft(id)
    if (d.status === 'approved' || d.status === 'rejected') throw new Error(`Draft ${id} is already ${d.status}`)
    const at = this.iso()
    const set: Partial<ListingDraft> = {status: 'rejected', reviewer, reviewedAt: at, reviewNote: reason}
    await this.store.patchWithAudit(id, set, audit(`human:${reviewer}`, 'draft.rejected', id, {reason}, at))
    return {...d, ...set}
  }

  /** After a human edits a blocked draft (in Studio or with --body), check it again. */
  async recheck(id: string, actor: string, edits?: {title?: string; body?: string}): Promise<ListingDraft> {
    const d = await this.mustGetDraft(id)
    if (d.status === 'approved' || d.status === 'rejected') throw new Error(`Draft ${id} is already ${d.status}`)
    const next = {...d, ...edits}
    const v = await this.reverify(next)
    const set: Partial<ListingDraft> = {...edits, verification: v, status: v.ok ? 'needs_review' : 'blocked'}
    await this.store.patchWithAudit(id, set, audit(actor, 'draft.rechecked', id, {ok: v.ok, issues: v.issues, edited: Boolean(edits)}, this.iso()))
    return {...d, ...set}
  }
}
