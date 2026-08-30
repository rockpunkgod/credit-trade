# Evidence snapshots

Evidence manifests are immutable phase snapshots, not checksums for all future working-tree revisions.

`phase-0.sha256` applies to Git commit `2f509eb23ef14dbd43f77172fd6947a78f573b71`. Verify the files as materialized from that commit. Changes made after Phase 0 must be covered by their own phase or release evidence rather than rewriting the Phase 0 manifest.
