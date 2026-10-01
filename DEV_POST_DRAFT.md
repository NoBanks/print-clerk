---
title: Print Clerk: an art catalog agent that only says what Sanity says
published: false
tags: devchallenge, sanitychallenge, sanity, ai
---

<!-- DRAFT FOR RYAN. Fill the three [[RYAN: ...]] markers (see RYAN_STEPS.md), delete this comment, then publish. -->

*This is a submission for the [Sanity Challenge, Path One: Ship an Agent That Queries Real Content](https://dev.to/challenges/sanity-2026-09-16)*

## What I Built

I sell framed art prints under the name NoBanks Nearby, across a few collections: Chromatic Spaces, Lone Journey, Anonstronauts and 1440. Most of the listing and posting work in that business is done by AI agents now, and I review what they make.

A mistake I have had to catch more than once is small and expensive: a price that belongs to one print size ending up next to a different size. The 19x13 price next to a 5x5. A model writing fluent copy does this easily, and a buyer who sees the wrong number either walks or holds you to it.

Print Clerk is an agent that drafts marketplace listings and social posts, and answers buyer questions, from a catalog in Sanity. The model is allowed to write. It is not allowed to decide whether what it wrote is true. That job belongs to plain code:

- Every fact the agent uses comes through Sanity Context, a read-only MCP endpoint.
- Every tool result the agent or the model sees goes into a ledger.
- A deterministic verifier checks the draft against that ledger: each price must belong to the size in the same sentence, sizes and prices must exist, availability must match status, no other collection's name, no invented selling claims (limited edition, signed, certificate, free shipping), and my house style (no em dashes, bare URLs, no markdown in plain-text marketplace fields).
- If a draft fails, an LLM writer gets one revision with the list of issues. If it still fails, it is saved as `blocked` with the reasons.
- If it passes, it waits for me. Approval re-reads the catalog and re-runs the verifier first, because prices and holds change between drafting and approving.
- Buyer answers that fail verification are never sent. The buyer gets a holding reply, and the question and the model's answer go to me.
- Everything lands in an audit log, written in the same transaction as the change it describes.

## Demo

[[RYAN: video link, see RYAN_STEPS.md step 6]]

The repo also runs fully offline in about two minutes with a local Context MCP emulator and sample data:

```bash
npm install
npm test
npm run demo
```

The demo drafts a listing from catalog facts, then runs a fault-injection writer that quotes the 19x13 price for the 5x5 and adds "Limited edition". The second draft is blocked with exactly those two reasons. Approving the good draft works, approving the blocked one is refused, and the audit log shows all of it.

## Code

[[RYAN: GitHub repo URL, see RYAN_STEPS.md step 5]]

TypeScript, Node 20.19+, MIT. Built with the Vercel AI SDK (`ai`, `@ai-sdk/mcp`), `@sanity/client`, `groq-js` for the local emulator, and vitest. 49 tests.

## How I Used Sanity

**Structured content first.** The schema is shaped around the mistake. Price and status do not live on the artwork. They live on each entry in `artwork.formats[]`, next to the width and height they belong to, because a price is only true for one size. `altText` is required. Each collection carries its naming rule (hash fingerprint for the astronaut and Chromatic Spaces lines, minute of the day for 1440). The agent's own output has types too: `listingDraft`, `inquiry` and `auditEvent`.

**Sanity Context, both retrieval modes.** The agent opens two MCP clients against one Context endpoint, using the `mode` query parameter:

- `mode=groq` for facts. Drafting fetches the artwork with a fixed projection through `groq_query` (with a dereferenced collection), plus the list of collection titles so the verifier can catch cross-collection mixups. For buyer questions, the model gets `initial_context`, `schema_explorer` and `groq_query` and writes its own queries. The compressed schema overview from `initial_context` goes straight into its system prompt.
- `mode=knowledge_base` for prose. The Knowledge Base is built from the dataset's `knowledgeArticle` and `collection` documents: the pricing policy ("a price always belongs to one specific size"), the shipping policy ("the agent must not promise shipping times or costs"), care notes, and the indoor/outdoor rule that decides whether an astronaut piece is Lone Journey or Anonstronauts. Drafting reads every `[core]` entry plus the entries about the piece's collection with `knowledge_base_read`. For buyer questions, the model gets the outline and reads entries itself.

**The endpoint's GROQ filter is part of the security model.** It is `_type in ["artwork", "collection", "knowledgeArticle"]`, so the agent cannot read its own drafts, past answers or the audit log, and cannot be steered by them.

**Read through Context, write through the client.** Context MCP is read-only by design, which I wanted. Drafts, inquiries and audit events are written with `@sanity/client` and a separate token, each change committed in one transaction with its audit event. Their ids live under a `clerk.` path, and Sanity does not serve dotted ids to unauthenticated readers, so the catalog can be a public dataset while the agent's output stays private.

**What the agent does with what it retrieved.** It writes drafts and answers, and then it gets checked against exactly what Context returned during that task. An answer that quotes a correct price the model never looked up still fails, because it was not grounded. That is the point: if the content were not structured into sizes with their own prices and statuses, there would be nothing precise to check against.

One thing I would build next: re-verify every `needs_review` draft as soon as an artwork's formats change, instead of waiting for approval time.

## Sanity Project Details

Project ID: [[RYAN: project ID, see RYAN_STEPS.md step 1]]

Dataset: `production` (public). The catalog in it is sample data, every document flagged `isSample: true`. Agent output lives under the private `clerk.` id path.

## Agent Session

[[RYAN: optional. Upload a Claude Code session transcript at https://dev.to/agent_sessions/new, click Make Public, embed it here. Delete this section if you skip it.]]
