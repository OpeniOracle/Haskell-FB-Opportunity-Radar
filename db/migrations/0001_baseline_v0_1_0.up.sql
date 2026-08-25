-- 0001  v0.1.0 reference schema
--
-- Reproduces `schemas/database.sql` so that an EMPTY database reaches the same
-- starting point a database already carrying v0.1.0 is at. On a database that
-- already has it, the harness STAMPS this migration instead of running it.
--
-- `schemas/database.sql` is not edited by this PR. It remains the design
-- baseline; this file is the executable equivalent.

create extension if not exists pgcrypto;

-- \ir resolves relative to THIS file, so the harness needs no variables.
\ir ../../schemas/database.sql
