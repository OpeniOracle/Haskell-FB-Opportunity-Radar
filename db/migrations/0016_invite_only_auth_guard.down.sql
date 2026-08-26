drop trigger if exists enforce_invite_only on auth.users;
drop function if exists auth_enforce_invite_only();
drop table if exists auth_invite_allowlist cascade;
