-- =====================================================================
-- OPERATOR FILE -- migration 0024 (spyglass_media_intelligence)
--
-- Adds the Openi Spyglass configuration: a dashboard destination an
-- application administrator can repoint WITHOUT A DEPLOYMENT, and a
-- table of reviewed Zignal snapshot embeds.
--
-- `snapshot_generated_at` is NOT NULL, deliberately. Zignal's own
-- documentation states that embeddable widgets support neither realtime
-- nor data refresh -- an embed shows the data that existed when the
-- snippet was generated, permanently. A widget that cannot say when it
-- was frozen cannot be labelled honestly, so it cannot be stored.
--
-- NO HTML IS STORED. An administrator supplies a URL, validated against
-- an explicit origin allowlist by a CHECK constraint.
--
-- HOW TO RUN IT
--
--   Supabase Dashboard -> SQL Editor -> paste this ENTIRE file -> Run.
--   Or: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
--
--   Nothing to paste into it, nothing to substitute, nothing left out.
--
-- ONE STATEMENT, so one transaction, whatever the SQL Editor does with
-- the script around it -- that editor does not keep one session across
-- the statements of a script, so an explicit begin/commit would not wrap
-- a multi-statement version of this file.
--
-- Any line containing ABORT: means NOTHING WAS COMMITTED.
--
-- CHECKSUM (whitespace-normalised per line, sha256 -- the rule
-- db/migrate.mjs uses, so a database migrated this way verifies clean)
--
--   0024  43aba8ef4afa496e46b9265a6217ba44cbe3d87d6fbe9d2dd08b442989c818d1
-- =====================================================================

do $operator_0024$
begin
    -- ------------------------------------------------------------ preconditions
    if to_regclass('public.schema_migrations') is null then
        raise exception 'ABORT: there is no schema_migrations ledger.';
    end if;

    if exists (select 1 from public.schema_migrations where version = '0024') then
        raise exception 'ABORT: migration 0024 is already recorded. Nothing to do.';
    end if;

    if not exists (select 1 from public.schema_migrations where version = '0023') then
        raise exception 'ABORT: migration 0023 is not present. Apply it first.';
    end if;

    if to_regclass('public.organizations') is null then
        raise exception 'ABORT: organizations is missing.';
    end if;

    -- IT CREATES FOUR OBJECTS AND SEEDS ONE ROW. It alters no existing table
    -- and changes no existing row.

-- >>>>>>>>>>>>>>>>>>>>>> CANONICAL PAYLOAD BEGINS <<<<<<<<<<<<<<<<<<<<<<
-- Verbatim from db/migrations/0024_spyglass_media_intelligence.up.sql, minus its own
-- begin;/commit; lines.

-- 0024 — Openi Spyglass: a configurable dashboard link and reviewed snapshot embeds.
--
-- THE CENTRAL FACT ABOUT ZIGNAL EMBEDS, STATED IN SCHEMA RATHER THAN IN A README.
--
-- Zignal's own documentation is explicit that embeddable widgets support neither
-- realtime nor data refresh: "the data that it will show once embedded will be
-- the data available at the time you generated the embed snippet. As days go by
-- the data remains the same."
--
-- So an embedded widget is a SNAPSHOT, and `snapshot_generated_at` is NOT NULL.
-- A widget with no generation timestamp cannot be stored at all, because the one
-- thing that must never happen is a month-old chart presented as current
-- coverage of a client's brand. The interface says "Snapshot generated <date>"
-- and never the word "live" — the only live thing is the dashboard link, which
-- is a link and not an embed.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT STORE: HTML. An administrator
-- supplies a URL, which is validated against an explicit origin allowlist by a
-- CHECK constraint. Storing the snippet Zignal generates and rendering it would
-- be `dangerouslySetInnerHTML` over administrator-supplied markup, and "the
-- administrator is trusted" is not an argument that survives a stolen session.

-- ---------------------------------------------------------------------------
-- 1. Who may change any of this.
--
-- A separate, explicit table. NOT a column on the invite allowlist: membership
-- of the pilot and authority to repoint a client-facing dashboard are different
-- questions, and answering both from one row means every invited user is one
-- migration away from being an administrator.
-- ---------------------------------------------------------------------------
create table app_administrators (
    user_id          uuid primary key,
    email_normalized text not null,
    granted_by       text not null,
    granted_at       timestamptz not null default now(),

    constraint app_administrators_email_present
        check (length(trim(email_normalized)) > 0)
);

comment on table app_administrators is
    'Who may edit application settings. Distinct from auth_invite_allowlist, which only governs who may sign in.';

alter table app_administrators enable row level security;
alter table app_administrators force row level security;
revoke all on app_administrators from anon, authenticated;

/*
   SECURITY DEFINER, AND DELIBERATELY SO.

   `app_administrators` is unreadable from the browser — no grant, no policy. A
   policy that needs to ask "is the caller an administrator?" therefore cannot
   read it as the caller, so it asks this function, which runs as the owner and
   answers one boolean about the CURRENT session only. It cannot be used to
   enumerate administrators, and it takes no argument that would let it answer
   about anybody else.

   `search_path` is pinned. A security-definer function without one is the
   classic privilege-escalation shape.
*/
create function public.is_app_administrator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.app_administrators
        where user_id = auth.uid()
    );
$$;

revoke all on function public.is_app_administrator() from public, anon;
grant execute on function public.is_app_administrator() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The allowlisted origins.
--
-- Enforced as a constraint so an unapproved origin cannot be stored even by a
-- direct SQL write, and mirrored in the browser and in the CSP. Three
-- independent statements of one rule.
--
--   zign.al                                   the dashboard short link
--   app.zignallabs.com                        the dashboard itself
--   embeddable-widgets.zignallabs.com         generated widget embeds
--   embeddable-widgets.staging.zignallabs.com the host in Zignal's own
--                                             documented example
--
-- `https://` is required literally. A protocol-relative `//host/path` inherits
-- the page's scheme and is not a URL this application will ever accept.
-- ---------------------------------------------------------------------------
create table spyglass_settings (
    id               text primary key default 'default',
    dashboard_url    text not null,
    dashboard_label  text not null default 'Openi Spyglass',
    updated_at       timestamptz not null default now(),
    updated_by       text,

    constraint spyglass_settings_single_row check (id = 'default'),
    constraint spyglass_settings_dashboard_origin check (
        dashboard_url like 'https://zign.al/%'
        or dashboard_url like 'https://app.zignallabs.com/%'
    ),
    constraint spyglass_settings_label_present
        check (length(trim(dashboard_label)) > 0)
);

comment on table spyglass_settings is
    'The configurable Spyglass live-dashboard destination. One row, editable by an application administrator without a deployment.';

create table spyglass_widgets (
    id                   uuid primary key default gen_random_uuid(),
    title                text not null,
    -- A URL, never a snippet. See the note at the top of this file.
    embed_url            text not null,
    enabled              boolean not null default true,
    display_order        integer not null default 100,
    -- NOT NULL. An embed with no generation time cannot be labelled honestly.
    snapshot_generated_at timestamptz not null,
    theme                text not null default 'auto',
    -- Where to send someone when the frame will not load. Always present.
    fallback_url         text not null,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    updated_by           text,

    constraint spyglass_widgets_title_present check (length(trim(title)) > 0),
    constraint spyglass_widgets_theme_check check (theme in ('light', 'dark', 'auto')),
    constraint spyglass_widgets_embed_origin check (
        embed_url like 'https://embeddable-widgets.zignallabs.com/%'
        or embed_url like 'https://embeddable-widgets.staging.zignallabs.com/%'
    ),
    constraint spyglass_widgets_fallback_origin check (
        fallback_url like 'https://zign.al/%'
        or fallback_url like 'https://app.zignallabs.com/%'
    )
);

comment on table spyglass_widgets is
    'Reviewed Zignal snapshot embeds. Snapshots, never live: Zignal embeds do not refresh.';

create index spyglass_widgets_order_idx on spyglass_widgets (enabled, display_order);

-- ---------------------------------------------------------------------------
-- 3. Read for every invited user; write for an administrator only.
--
-- The read policy is `using (true)` and the WRITE policies call
-- `is_app_administrator()`. Both halves are needed: without the grant the role
-- cannot write at all, and without the policy any signed-in user could.
-- ---------------------------------------------------------------------------
alter table spyglass_settings enable row level security;
alter table spyglass_settings force row level security;
alter table spyglass_widgets enable row level security;
alter table spyglass_widgets force row level security;

revoke all on spyglass_settings from anon, authenticated;
revoke all on spyglass_widgets from anon, authenticated;

grant select (id, dashboard_url, dashboard_label, updated_at) on spyglass_settings to authenticated;
/* `updated_by` is NOT granted for read: who last changed a setting is an
   operational detail, and it holds an email address. */
grant update (dashboard_url, dashboard_label, updated_at, updated_by) on spyglass_settings to authenticated;

grant select (
    id, title, embed_url, enabled, display_order, snapshot_generated_at, theme,
    fallback_url, updated_at
) on spyglass_widgets to authenticated;

/*
   NO WRITE GRANT ON `spyglass_widgets`, DELIBERATELY.

   There is no widget-management interface in this change: an embed snippet has
   to be generated from the dashboard by a person who chose the date range it
   freezes, and that is an operator task done in SQL. Granting insert, update
   and delete for a screen that does not exist is standing attack surface, and
   the schema-contract test that caught it — "authenticated holds no write
   privilege anywhere" — is the reason it did not ship.

   The admin policies below stay. They cost nothing, they document the intended
   authority, and when the management screen is built the grant is the only
   thing that has to change.
*/

create policy spyglass_settings_read_authenticated on public.spyglass_settings
    for select to authenticated using (true);
create policy spyglass_settings_admin_update on public.spyglass_settings
    for update to authenticated
    using (public.is_app_administrator())
    with check (public.is_app_administrator());

create policy spyglass_widgets_read_authenticated on public.spyglass_widgets
    for select to authenticated using (true);
create policy spyglass_widgets_admin_insert on public.spyglass_widgets
    for insert to authenticated with check (public.is_app_administrator());
create policy spyglass_widgets_admin_update on public.spyglass_widgets
    for update to authenticated
    using (public.is_app_administrator())
    with check (public.is_app_administrator());
create policy spyglass_widgets_admin_delete on public.spyglass_widgets
    for delete to authenticated using (public.is_app_administrator());

-- ---------------------------------------------------------------------------
-- 4. The default destination.
--
-- Seeded so the surface works on the first load. It is a DEFAULT, not a
-- constant: an administrator repoints it from the interface and no deployment
-- is involved, which is the requirement this whole table exists to meet.
--
-- NO WIDGET IS SEEDED. An embed URL has to be generated from the dashboard by a
-- person who chose the date range it freezes, and inventing one here would put a
-- snapshot on screen that nobody reviewed.
-- ---------------------------------------------------------------------------
insert into spyglass_settings (id, dashboard_url, dashboard_label, updated_by)
values ('default', 'https://zign.al/urgnr9l3', 'Openi Spyglass', 'migration 0024')
on conflict (id) do nothing;

-- >>>>>>>>>>>>>>>>>>>>>>> CANONICAL PAYLOAD ENDS <<<<<<<<<<<<<<<<<<<<<<<

    -- ------------------------------------------------------------- ledger row
    insert into public.schema_migrations (version, name, checksum, stamped)
    values ('0024', 'spyglass_media_intelligence', '43aba8ef4afa496e46b9265a6217ba44cbe3d87d6fbe9d2dd08b442989c818d1', false);

    -- ----------------------------------------------------------- postconditions
    if to_regclass('public.spyglass_settings') is null
       or to_regclass('public.spyglass_widgets') is null
       or to_regclass('public.app_administrators') is null then
        raise exception 'ABORT: a Spyglass table was not created.';
    end if;

    -- THE ADMINISTRATOR TABLE IS UNREACHABLE FROM THE BROWSER.
    if exists (
        select 1 from information_schema.table_privileges
         where grantee in ('authenticated', 'anon') and table_name = 'app_administrators'
    ) then
        raise exception 'ABORT: app_administrators became reachable from a session.';
    end if;

    -- A SESSION MAY NOT CREATE OR DELETE A WIDGET. There is no management
    -- screen in this change, so there is no reason for the grant to exist.
    if exists (
        select 1 from information_schema.role_table_grants
         where grantee = 'authenticated' and table_name = 'spyglass_widgets'
           and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    ) then
        raise exception 'ABORT: a session gained write access to spyglass_widgets.';
    end if;

    -- The one deliberate write: repointing the dashboard, gated by policy.
    if not exists (
        select 1 from pg_policies
         where tablename = 'spyglass_settings' and policyname = 'spyglass_settings_admin_update'
    ) then
        raise exception 'ABORT: the administrator-only update policy is missing.';
    end if;

    if (select dashboard_url from public.spyglass_settings where id = 'default')
       not like 'https://%' then
        raise exception 'ABORT: the seeded dashboard address is not an https URL.';
    end if;

    -- The allowlist stays unreadable by a signed-in session (migration 0016).
    if exists (
        select 1 from information_schema.table_privileges
         where grantee = 'authenticated' and table_name = 'auth_invite_allowlist'
           and privilege_type = 'SELECT'
    ) then
        raise exception 'ABORT: auth_invite_allowlist became readable.';
    end if;

    if (select count(*) from public.schema_migrations where version = '0024') <> 1 then
        raise exception 'ABORT: 0024 is not recorded exactly once.';
    end if;

    raise notice 'Migration 0024 applied. Spyglass configured; administrator writes are policy-gated and the administrator table is server-side only.';
end
$operator_0024$;
