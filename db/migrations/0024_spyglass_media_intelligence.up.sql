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
begin;

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
-- 4. NO ROWS ARE WRITTEN HERE.
--
-- The default dashboard destination is DATA. See
-- db/seed/0008_spyglass_defaults.sql.
--
-- It is a DEFAULT, not a constant: an administrator repoints it from the
-- interface and no deployment is involved, which is the requirement this table
-- exists to meet. Until the seed runs, the surface says it is not configured —
-- which is true, and is a state it renders properly.
--
-- NO WIDGET IS SEEDED ANYWHERE. An embed URL has to be generated from the
-- dashboard by a person who chose the date range it freezes, and inventing one
-- would put a snapshot on screen that nobody reviewed.
-- ---------------------------------------------------------------------------

commit;
