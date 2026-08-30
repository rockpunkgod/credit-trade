# Compliance evidence workspace

This repository workspace stores evidence metadata, redacted matrices, hashes and private-vault references. The intended GitHub repository is private, but the repository must still never contain contracts, identity documents, bank details, production account data, legal opinions, API keys or other secrets.

## Allowed statuses

- `ALLOWED_WITH_EVIDENCE`
- `PENDING_REVIEW`
- `PROHIBITED`
- `STALE_EVIDENCE`

All market × payment channel × model vendor × supplier type cells begin as `PENDING_REVIEW`. No code test or disclaimer may change a cell to `ALLOWED_WITH_EVIDENCE`.

## Minimum public metadata

Each evidence record must contain:

- stable record ID;
- jurisdiction and precise service area;
- payment channel, model vendor and supplier/end-user type scope;
- source URL and title;
- publication/effective date and access date;
- concise applicability summary;
- content SHA-256;
- status;
- accountable owner and independent reviewer;
- next review date;
- private evidence reference and hash where the source is confidential.

Phase 1 will populate official and first-party public sources. Contractual approvals and professional opinions remain external blockers until private evidence references are supplied and independently approved.
