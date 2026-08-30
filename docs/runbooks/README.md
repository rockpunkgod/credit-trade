# Runbook index

No operational runbook is complete in Phase 0. The following runbooks are required before an RC can pass:

- local demonstration start/stop and fixture reset;
- deployment and rollback;
- database migration and rollback;
- regional backup, restore and integrity verification;
- payment reconciliation and unexplained-variance freeze;
- independent top-up, charge and payout kill switches;
- market and vendor circuit breakers;
- refund, chargeback, reserve and negative-balance handling;
- supplier key compromise and platform credential rotation;
- secret/PII leak response;
- webhook replay or signature incident;
- account takeover and payout-account change incident;
- regional isolation breach;
- production admission and emergency shutdown;
- GitHub RC/GA release and rollback.

Each runbook must name the trigger, authority, two-person steps where required, observable evidence, stop conditions, rollback, communications and post-incident review.
