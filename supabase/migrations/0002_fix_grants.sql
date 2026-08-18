-- =====================================================================
-- Fix: grant table-level privileges to the authenticated role.
-- RLS policies still apply on top of these — this just lets the
-- authenticated role attempt the operation at all. Without this,
-- every request fails with 42501 (insufficient_privilege) before
-- RLS is ever evaluated, because "Automatically expose new tables"
-- was turned off when the project was created.
-- =====================================================================

grant usage on schema public to authenticated;

grant select, update on user_profiles to authenticated;
grant select, insert on groups to authenticated;
grant select, insert on group_members to authenticated;
grant select, insert, update on players to authenticated;
grant select, insert, update on tournaments to authenticated;
grant select, insert, update on matches to authenticated;
grant select, insert, update on match_players to authenticated;

-- player_stats is a view; select access follows from the underlying
-- table grants above, but views need their own explicit grant too.
grant select on player_stats to authenticated;
