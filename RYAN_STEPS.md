# RYAN_STEPS: DEV Sanity Challenge (Path One)

Deadline: **Sun Oct 4 2026, 11:59 PM PT**. Prize: 3 winners x $500 on Path One (+ DEV++ and a badge). Eligibility: 18+, solo is fine, English post. Judging: meaningful Sanity Context use, technical quality, Knowledge Base use, usability. Tiebreaker: positive reactions on the post.

Nothing has been created, pushed, deployed or published. The code is committed locally only, in this folder:
/Users/nobanksnearby/Documents/Clawdbot/OPPORTUNITIES/FAST_CASH/DEV_SANITY_2026-10-01

Offline check any time: `npm test` (49 pass) and `npm run demo`.

## 1. Create the free Sanity project (about 5 min)

```bash
cd /Users/nobanksnearby/Documents/Clawdbot/OPPORTUNITIES/FAST_CASH/DEV_SANITY_2026-10-01/studio
npx sanity login
SANITY_STUDIO_PROJECT_ID=pending npx sanity projects create "Print Clerk" --dataset production --dataset-visibility public
```

- (The `SANITY_STUDIO_PROJECT_ID=pending` prefix only keeps the studio config from refusing to load before a project exists.)
- Note the project ID it prints. That goes in the post (marker `[[RYAN: project ID]]`).
- Free plan is enough.

## 2. Env vars (names only, values from sanity.io/manage)

```bash
cd ..
cp .env.example .env
cp .env.example studio/.env
```

Fill in:
- `SANITY_PROJECT_ID`, `SANITY_STUDIO_PROJECT_ID`: the project ID
- `SANITY_WRITE_TOKEN`: project API token, Editor role (sanity.io/manage, project, API, Tokens)
- `SANITY_ORGANIZATION_TOKEN`: organization token with the **Context Viewer** role (organization settings, not the project)
- `SANITY_CONTEXT_MCP_URL`: from step 3
- `SANITY_KNOWLEDGE_BASE_IDS`: from step 3
- `LLM_BASE_URL` (+ `LLM_API_KEY` / `LLM_MODEL` if needed): any OpenAI-compatible endpoint. Needed only for `ask` and the LLM writer. Note: the local proxy on port 1233 returned HTTP 500 on `/v1/models` when I checked today, so the `ask` flow has only been tested with a scripted model so far.

## 3. Schema, data, Context endpoint, Knowledge Base (about 10 min)

```bash
cd studio && npm install
npx sanity schema deploy
npx sanity deploy            # Context needs a deployed Studio; pick a hostname
cd .. && npm run seed        # loads the 16 sample documents
```

Then in the Sanity Dashboard (sanity.io/manage):
1. Organization, **Labs**: enable **Context**.
2. Open **Context**, create an MCP endpoint for project Print Clerk, dataset `production`. GROQ filter:
   `_type in ["artwork", "collection", "knowledgeArticle"]`
   Copy its URL into `SANITY_CONTEXT_MCP_URL` (shape: `https://api.sanity.io/v1/context/organizations/<orgId>/mcp/<name>`).
3. **New knowledge base**. Title "Print Clerk catalog". Purpose: "Answer buyer and listing questions about framed prints accurately." Add source: **Dataset** `production`. Click **Build entries**, wait for "Entries up to date". Copy its id (starts with `kb`) into `SANITY_KNOWLEDGE_BASE_IDS`. The challenge prompt says "a Sanity Context MCP endpoint backed by a Knowledge Base", so do not skip this one.

## 4. Smoke test against real Sanity (about 3 min)

```bash
npm run clerk -- tools       # expect groq: initial_context, schema_explorer, groq_query; knowledgeBase: initial_context, knowledge_base_read
npm run clerk -- index       # expect 8 sample artworks with sizes and prices
npm run clerk -- draft lj-7c21e0 --channel marketplace
npm run clerk -- draft cs-3fa9c2 --channel instagram --writer fault    # expect blocked
npm run clerk -- review
npm run clerk -- approve <id from review> --by Ryan
npm run clerk -- audit
```

If `index` errors with "non-JSON text", the hosted `groq_query` output format differs from my reading of the docs: send me the error line and I will adjust `parseGroqResult` in `src/context/client.ts` (small change). If `draft` shows no Knowledge Base source ids, the real outline lines are formatted differently from "- path"; same deal, `outlinePaths` in `src/agent.ts`.

## 5. Push the repo (public, MIT)

```bash
gh repo create NoBanks/print-clerk --public --source=. --push --description "An art catalog agent that only says what Sanity says"
```

Put the URL in the post (marker `[[RYAN: GitHub repo URL]]`). `.env` is gitignored; double check with `git status` that no `.env` is staged.

## 6. Record the demo (required section, 1 to 2 minutes)

Screen-record the terminal running step 4 (real Sanity) or `npm run demo`, plus a few seconds of the Studio showing an artwork's `formats` and a `listingDraft`. Narration optional. Upload to YouTube (unlisted is fine) and paste the bare URL in the post (marker `[[RYAN: video link]]`).

## 7. Publish the DEV post before Sun Oct 4, 11:59 PM PT

1. Open `DEV_POST_DRAFT.md`, fill the three `[[RYAN: ...]]` markers, delete the HTML comment at the top and the Agent Session section if you skip it.
2. Read it once in your voice. Every claim in it is backed by the code; change anything that does not sound like you.
3. dev.to/new, paste, set `published: true`, publish. Tags are already `devchallenge, sanitychallenge, sanity, ai`.
4. Optional: upload a session transcript at https://dev.to/agent_sessions/new and click **Make Public** before embedding, or judges cannot open it.
