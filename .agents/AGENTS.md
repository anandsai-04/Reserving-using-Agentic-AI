# Project Rules — Reserving-using-Agentic-AI

## Living Architecture Reviewer

A persistent architecture review document is maintained at:
`.agents/knowledge/repo_architecture/artifacts/architecture_review.md`

### Update Rules

**WHENEVER you make any of the following changes, you MUST update `architecture_review.md`:**

1. **New frontend component added** → Add a row to the "Frontend Components" table.
2. **Frontend component removed or renamed** → Update/remove its row in the table.
3. **New backend API route added** → Add a row to the "Backend API Routes" table.
4. **API route changed** (endpoint path, method, payload, or caller) → Update the relevant row.
5. **New agent added or agent logic changed** → Update the "AI Agents" table and the Agent Roles diagram.
6. **New actuarial method added** → Add it to the "Actuarial Methods" table and update `methods/__init__.py` references.
7. **New model/module added to `backend/models/`** → Add a row to "Supporting Models".
8. **Session store fields added or removed** → Update the Session Store section.
9. **Tech stack change** (new library, framework, deployment target) → Update the Tech Stack table.
10. **Mermaid diagrams become stale** due to any of the above → Regenerate the relevant diagram.

### How to Update

When updating `architecture_review.md`:
- Update the relevant table rows or diagram only — do not rewrite unrelated sections.
- Always append a new row to the **Changelog** table at the bottom with today's date and a one-line summary of what changed.
- Update the `last_updated` field in `metadata.json`.
- Keep descriptions concise and consistent with the existing style.

### Review on Request

If the user asks to "review the architecture", "check the component map", or "what's in the repo?", read `architecture_review.md` first before doing independent research.
