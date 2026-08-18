-- =====================================================================
-- Adds:
--   1. tournaments.format ('random' | 'playoffs') — chosen at creation
--   2. matches.stage ('main' | 'final' | 'losers_final')
--   3. generate_stage_matches() RPC — builds the Final (winners of the
--      two round-1 matches) or the Losers Final (losers of those two
--      matches), only for playoffs-format tournaments.
--
-- Manual score editing needs NO new RPC: submit_match_result() already
-- unconditionally overwrites score/winner/results for a given match_id,
-- regardless of its current status, so it doubles as an edit endpoint.
-- =====================================================================

alter table tournaments
  add column if not exists format text not null default 'random'
  check (format in ('random', 'playoffs'));

alter table matches
  add column if not exists stage text not null default 'main'
  check (stage in ('main', 'final', 'losers_final'));

create or replace function generate_stage_matches(p_tournament_id uuid, p_stage text)
returns matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_format text;
  new_match matches;
  m1 matches;
  m2 matches;
  main_count int;
begin
  select group_id, format into v_group_id, v_format
  from tournaments where tournament_id = p_tournament_id;

  if v_group_id is null then
    raise exception 'Tournament not found';
  end if;

  if not is_group_member(v_group_id) then
    raise exception 'Not a member of this group';
  end if;

  if v_format <> 'playoffs' then
    raise exception 'This tournament is not in playoffs format';
  end if;

  if p_stage not in ('final', 'losers_final') then
    raise exception 'Invalid stage: %', p_stage;
  end if;

  if exists (select 1 from matches where tournament_id = p_tournament_id and stage = p_stage) then
    raise exception 'This stage has already been generated';
  end if;

  select count(*) into main_count
  from matches where tournament_id = p_tournament_id and stage = 'main';

  if main_count <> 2 then
    raise exception 'Generating % requires exactly 2 main-round matches (found %)', p_stage, main_count;
  end if;

  select * into m1 from matches
    where tournament_id = p_tournament_id and stage = 'main' order by created_at asc limit 1;
  select * into m2 from matches
    where tournament_id = p_tournament_id and stage = 'main' order by created_at asc offset 1 limit 1;

  if m1.status <> 'completed' or m2.status <> 'completed' then
    raise exception 'Both main-round matches must be completed first';
  end if;

  insert into matches (tournament_id, round, status, stage)
  values (p_tournament_id, 2, 'pending', p_stage)
  returning * into new_match;

  if p_stage = 'final' then
    insert into match_players (match_id, player_id, team)
      select new_match.match_id, player_id, 'A' from match_players
      where match_id = m1.match_id and team = m1.winner;
    insert into match_players (match_id, player_id, team)
      select new_match.match_id, player_id, 'B' from match_players
      where match_id = m2.match_id and team = m2.winner;
  else
    insert into match_players (match_id, player_id, team)
      select new_match.match_id, player_id, 'A' from match_players
      where match_id = m1.match_id and team <> m1.winner;
    insert into match_players (match_id, player_id, team)
      select new_match.match_id, player_id, 'B' from match_players
      where match_id = m2.match_id and team <> m2.winner;
  end if;

  return new_match;
end;
$$;

grant execute on function generate_stage_matches(uuid, text) to authenticated;
