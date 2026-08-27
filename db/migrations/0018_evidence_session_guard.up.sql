-- 0018  Immediate revocation for the evidence proxy
--
-- THE PROBLEM THIS SOLVES.
--
-- A Supabase access token is a JWT. Signing out revokes the SESSION — the
-- refresh token stops working and the `auth.sessions` row is deleted — but the
-- access token already in the caller's hands stays cryptographically valid
-- until its own `exp`. Verifying the signature therefore answers "was this
-- issued to a real user" and NOT "is this caller still signed in". For an
-- ordinary dashboard read that window is the documented, accepted behaviour of
-- Supabase and this migration does not change it.
--
-- For CONFIDENTIAL EVIDENCE it is not acceptable. The evidence proxy exists
-- precisely because a credential that outlives its authorisation is the wrong
-- control for preserved source material, and an unexpired-but-signed-out JWT is
-- exactly that credential wearing a different hat.
--
-- So the proxy asks the database a question no JWT can answer: does the session
-- named in this token still exist, and does it still belong to this user?
--
-- WHY A FUNCTION RATHER THAN A QUERY.
--
-- The answer lives in `auth.sessions`, which is GoTrue's private state. Granting
-- any application role read access to it would expose every session for every
-- user — device metadata, refresh cadence, AAL, last-seen times — to answer a
-- yes/no question. This function is the yes/no question and nothing else:
--
--   * `security definer`, so the CALLER never needs rights on `auth`.
--   * returns `boolean`. No session id, no timestamps, no row, no count. A
--     caller learns "authorised" or "not authorised" and cannot tell which of
--     the four checks refused them.
--   * execute is revoked from `public`, `anon` and `authenticated`, and granted
--     only to `service_role`. A browser session cannot call it at all — not to
--     probe for another user's session id, not to enumerate the allowlist.
--   * `search_path` is pinned, so a caller cannot shadow `auth.sessions` or
--     `auth_invite_allowlist` with a table of their own.

create or replace function public.authorize_evidence_access(
    p_user_id    uuid,
    p_session_id uuid
)
returns boolean
language plpgsql
security definer
stable
set search_path = public, auth, pg_temp
as $$
declare
    v_email text;
begin
    -- A token with no `session_id` claim reaches here as null. It cannot be
    -- checked against the session table, so it cannot be authorised — this is
    -- the deny direction and it is deliberate.
    if p_user_id is null or p_session_id is null then
        return false;
    end if;

    -- 1. The user must still exist, and must still have an address. A deleted
    --    account and an anonymous account both fail here.
    select u.email into v_email from auth.users u where u.id = p_user_id;
    if v_email is null or trim(v_email) = '' then
        return false;
    end if;

    -- 2. The session must still exist AND belong to this user. Sign-out deletes
    --    the row, so the very next request with the same unexpired token is
    --    refused. The `user_id` half is not redundant: without it a caller who
    --    learned any live session id could pair it with their own `sub`.
    if not exists (
        select 1 from auth.sessions s
        where s.id = p_session_id
          and s.user_id = p_user_id
    ) then
        return false;
    end if;

    -- 3. Membership is the CURRENT answer, not the one minted into the token.
    --    Removing someone from the allowlist takes effect on their next
    --    request rather than on their token's expiry.
    if not exists (
        select 1 from public.auth_invite_allowlist a
        where a.email_normalized = lower(trim(v_email))
    ) then
        return false;
    end if;

    return true;
end
$$;

comment on function public.authorize_evidence_access(uuid, uuid) is
    'Yes/no authorisation for the evidence proxy: user exists, session still exists and belongs to that user, address still on the invite allowlist. Returns a boolean and never session data. service_role only.';

-- A `security definer` function is granted to PUBLIC on creation. Revoking that
-- is not optional; without it every browser session could call this.
revoke all on function public.authorize_evidence_access(uuid, uuid) from public;
revoke all on function public.authorize_evidence_access(uuid, uuid) from anon;
revoke all on function public.authorize_evidence_access(uuid, uuid) from authenticated;
grant execute on function public.authorize_evidence_access(uuid, uuid) to service_role;
