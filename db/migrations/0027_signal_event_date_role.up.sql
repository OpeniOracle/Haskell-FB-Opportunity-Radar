-- 0027 — What a signal's event date IS.
--
-- Doc 19 section 5.3. `signals.event_date` already carries a precision and a
-- basis (0004, ADR 0004). It does not say what the date MEANS, and that is the
-- gap the synthetic regression harness could not close: 28 of 130 research units
-- have an event date equal to the publication date, and nothing in the schema
-- can tell "the plant was announced on this date" from "the pipeline used the
-- filing date because it found no other" (defect FP05).
--
--   announcement   the date something was announced
--   milestone      the date a project step happened (groundbreaking, opening)
--   decision       the date a body decided (approval, vote, award)
--   effective      the date something takes effect (a permit, a closure)
--   forecast       a date that is PREDICTED
--
-- NULL IS A VALUE, AND IT MEANS "NOT RECORDED". There is no default. Every row
-- that exists today keeps a NULL role, which is the honest statement about a
-- date written before roles existed, and nothing is back-filled by guessing.
--
-- THE RULE: a role and a date go together, except for a forecast.
--
--   forecast  <=>  no event_date.
--
-- ADR 0004 and doc 19: a forecast is an INTERVAL, held in the evidence's
-- temporal_* columns, and never a single day in `event_date`. Writing "expected
-- in Q4 2027" as 2027-12-31 is how a prediction becomes a fact. So a forecast
-- role requires `event_date` to be NULL, and every other role requires a date
-- for it to describe. A role without a date, or a forecast with a date, is
-- rejected by name.
--
-- Existing rows have a NULL role and satisfy this untouched. `signals` is read
-- by the browser under a table-level grant, which covers a column added later,
-- so no grant is needed (and a test asserts the browser can read it).

begin;

alter table signals
    add column event_date_role text;

alter table signals
    add constraint signals_event_date_role_check
        check (event_date_role is null
               or event_date_role in ('announcement', 'milestone', 'decision',
                                      'effective', 'forecast')),
    add constraint signals_event_date_role_matches_date
        check (event_date_role is null
               or ((event_date_role = 'forecast') = (event_date is null)));

comment on column signals.event_date_role is
    'Doc 19 section 5.3. What event_date means: announcement | milestone | decision | effective | forecast. NULL = not recorded. A forecast has no event_date (its interval lives in evidence.temporal_*, ADR 0004); every other role requires one.';

commit;
