-- Revert 0001 — drop the v0.1.0 reference schema.
--
-- Explicit drops rather than `drop schema public cascade`, which would take
-- `schema_migrations` with it and leave the harness unable to describe its own
-- state. Reverse dependency order; `cascade` covers the FKs between them.

drop table if exists market_trend_signals cascade;
drop table if exists market_trends cascade;
drop table if exists opportunity_score_snapshots cascade;
drop table if exists opportunity_signals cascade;
drop table if exists opportunity_facilities cascade;
drop table if exists alerts cascade;
drop table if exists subscriptions cascade;
drop table if exists opportunities cascade;
drop table if exists signal_evidence cascade;
drop table if exists signals cascade;
drop table if exists evidence_entity_links cascade;
drop table if exists evidence cascade;
drop table if exists source_health_events cascade;
drop table if exists source_runs cascade;
drop table if exists sources cascade;
drop table if exists facility_identifiers cascade;
drop table if exists facility_aliases cascade;
drop table if exists facilities cascade;
drop table if exists organization_identifiers cascade;
drop table if exists organization_aliases cascade;
drop table if exists organizations cascade;
drop table if exists audit_events cascade;
