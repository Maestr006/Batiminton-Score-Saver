-- Track which players sat out (bye) when the tournament's round-1
-- matches were generated, so it can be displayed on the tournament
-- page itself, not just in the creation wizard.

alter table tournaments
  add column if not exists bye_player_ids uuid[] not null default '{}';
