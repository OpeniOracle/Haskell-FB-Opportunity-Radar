drop trigger if exists reject_reserved_address on auth_invite_allowlist;
drop function if exists auth_reject_reserved_address();
drop table if exists reserved_service_addresses cascade;
