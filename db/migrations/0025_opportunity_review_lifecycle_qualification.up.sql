-- 0025 — Opportunity review state, project lifecycle and commercial qualification.
--
-- Decisions D-R1 and D-R3 (docs/design/20). Three questions that the existing
-- columns cannot answer, each about the opportunity and each independent of the
-- others:
--
--   review_state              Has a person looked at this machine-derived
--                             candidate?  unreviewed | accepted | rejected
--   project_lifecycle         Where is the PROJECT in the world?
--                             announced | approved | under_construction |
--                             completed | cancelled | withdrawn | historical |
--                             unknown
--   commercial_qualification  Is there open work Haskell could actually bid for?
--                             not_assessed | no_open_work |
--                             open_work_unverified | qualified
--
-- WHY THESE ARE NOT `stage` OR `status`, AND WHY NO EXISTING VALUE IS TOUCHED.
--
--   stage    (emerging | developing | confirmed) is how well we KNOW the project.
--   status   (new ... expired) is what HASKELL is doing about it, and closed_won
--            and closed_lost are Haskell's pursuit outcome, not the project's.
--   project_maturity is an existing 0-25 SCORE, which is why the new column is
--            named `project_lifecycle` and never reuses that word.
--
-- Nothing below reinterprets, renames or removes a stage, a status, an
-- identifier, a history row or a foreign key. A completed project is expressed
-- with the status the repository already has (`expired`, interim, per doc 19),
-- not with a new one.
--
-- WHAT THE DATABASE NOW REFUSES, AND WHY EACH RULE IS A RULE:
--
--   An assessment needs an accepted review.
--     `commercial_qualification` can only leave `not_assessed` on a row whose
--     `review_state` is `accepted`. A machine-derived candidate is created
--     `unreviewed` (the column default), so a pipeline write can never make an
--     opportunity qualified, however it is written.
--
--   An ended project is never an active opportunity.
--     `completed`, `cancelled`, `withdrawn` and `historical` projects must carry
--     a terminal status and may only be `not_assessed` or `no_open_work`. They
--     stay in the table, searchable and filterable, and cannot be presented as
--     something to sell into. A later phase of a completed project is a SEPARATE
--     opportunity row, not a reopened one.
--
-- EVERY EXISTING ROW SATISFIES EVERY RULE WITHOUT BEING TOUCHED. Each column is
-- added NOT NULL with a constant default, which PostgreSQL stores as catalogue
-- metadata and does not rewrite the table for, and the defaults are the values
-- that assert nothing: unreviewed, unknown, not_assessed. Existing rows read
-- exactly as before until a person or a later phase says otherwise.
--
-- DEFAULTS BY DESIGN, NOT BY DERIVATION.
--
-- Doc 20 proposes `review_state = accepted` for rows an analyst created
-- (`derived_by IS NULL`). A column default cannot depend on another column, and
-- a migration may not write rows, so the default is the SAFE one and an analyst
-- path sets `accepted` explicitly. If the database holds analyst-created rows,
-- accepting them is a reviewed data step in docs/design/23, never this file.
--
-- THE BROWSER. `opportunities` is granted column by column (0015), and a column
-- grant does not reach a column added later. Migration 0021 added columns and
-- granted none, and every page failed with 42501 (0022). So the three columns a
-- reader needs to separate the research area from the pursuit workspace are
-- granted HERE, in the same transaction. They carry no private content.

begin;

alter table opportunities
    add column review_state text not null default 'unreviewed',
    add column project_lifecycle text not null default 'unknown',
    add column commercial_qualification text not null default 'not_assessed';

alter table opportunities
    add constraint opportunities_review_state_check
        check (review_state in ('unreviewed', 'accepted', 'rejected')),
    add constraint opportunities_project_lifecycle_check
        check (project_lifecycle in ('announced', 'approved', 'under_construction',
                                     'completed', 'cancelled', 'withdrawn',
                                     'historical', 'unknown')),
    add constraint opportunities_commercial_qualification_check
        check (commercial_qualification in ('not_assessed', 'no_open_work',
                                            'open_work_unverified', 'qualified')),
    add constraint opportunities_assessment_requires_review
        check (commercial_qualification = 'not_assessed' or review_state = 'accepted'),
    add constraint opportunities_ended_project_is_not_active
        check (project_lifecycle not in ('completed', 'cancelled', 'withdrawn', 'historical')
               or (status in ('dismissed', 'closed_won', 'closed_lost', 'cancelled', 'expired')
                   and commercial_qualification in ('not_assessed', 'no_open_work')));

comment on column opportunities.review_state is
    'D-R1. unreviewed | accepted | rejected. Pipeline-derived rows are created unreviewed and are never shown as confirmed, qualified or pursuit-ready until accepted. Who reviewed and when is recorded in audit_events.';
comment on column opportunities.project_lifecycle is
    'D-R3. The state of the PROJECT, not of our knowledge (stage) or of our pursuit (status). unknown asserts nothing. Ended lifecycles require a terminal status and at most no_open_work.';
comment on column opportunities.commercial_qualification is
    'D-R3. Whether open work exists for Haskell. Defaults to not_assessed. Only a person with a procurement or package source moves it, and only on an accepted row; a project fact never sets it.';

grant select (review_state, project_lifecycle, commercial_qualification)
    on opportunities to authenticated;

commit;
