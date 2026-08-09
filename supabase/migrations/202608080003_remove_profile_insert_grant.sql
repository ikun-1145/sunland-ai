begin;

-- Application login already creates user_profiles through the service-role
-- Worker. Short-lived database tokens may only read their profile and update
-- the explicitly granted presentation columns.
revoke insert on table public.user_profiles from authenticated;

commit;
