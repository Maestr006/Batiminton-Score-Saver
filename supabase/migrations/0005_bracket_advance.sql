-- =====================================================================
-- Generalizes the playoffs bracket to work with ANY number of round-1
-- teams, not just exactly 2 matches. Winners advance round by round
-- (with an automatic bye if a round has an odd number of winners) until
-- one match remains, which is marked 'final'. The optional Losers Final
-- (3rd place) can still be generated afterward, from the two semifinal
-- losers — but only if neither semifinal was itself a bye.
-- =====================================================================

alter table matches drop constraint if exists matches_stage_check;
alter table matches
  add constraint matches_stage_check check (stage in ('main', 'bracket', 'final', 'losers_final'));

drop function if exists generate_stage_matches(uuid, text);

-- Advances the winners of the current highest round into a new round.
-- If that round had an odd number of winners, the leftover winner gets
-- an automatic bye (a 'completed' match with only a team A, no
-- opponent) and advances straight through without playing.
create or replace function advance_bracket(p_tournament_id uuid)
returns setof matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_format text;
  cur_round int;
  total_winners int;
  pairs_count int;
  has_bye boolean;
  new_round int;
  new_stage text;
  i int;
  m1_id uuid; m1_winner text;
  m2_id uuid; m2_winner text;
  new_match_id uuid;
  bye_match_id uuid;
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

  if exists (select 1 from matches where tournament_id = p_tournament_id and stage = 'final') then
    raise exception 'This tournament already has a champion — nothing left to advance';
  end if;

  select max(round) into cur_round
  from matches
  where tournament_id = p_tournament_id and stage in ('main', 'bracket');

  if cur_round is null then
    raise exception 'No matches found to advance';
  end if;

  if exists (
    select 1 from matches
    where tournament_id = p_tournament_id and round = cur_round and status <> 'completed'
  ) then
    raise exception 'All matches in the current round must be completed before advancing';
  end if;

  create temporary table winners_seq on commit drop as
  select row_number() over (order by created_at) as seq, match_id, winner
  from matches
  where tournament_id = p_tournament_id and round = cur_round;

  select count(*) into total_winners from winners_seq;

  if total_winners < 2 then
    raise exception 'Not enough winners to form another round';
  end if;

  pairs_count := total_winners / 2;
  has_bye := (total_winners % 2 = 1);
  new_round := cur_round + 1;
  new_stage := case when (pairs_count + (case when has_bye then 1 else 0 end)) = 1
                     then 'final' else 'bracket' end;

  for i in 1..pairs_count loop
    select match_id, winner into m1_id, m1_winner from winners_seq where seq = 2 * i - 1;
    select match_id, winner into m2_id, m2_winner from winners_seq where seq = 2 * i;

    insert into matches (tournament_id, round, status, stage)
    values (p_tournament_id, new_round, 'pending', new_stage)
    returning match_id into new_match_id;

    insert into match_players (match_id, player_id, team)
      select new_match_id, player_id, 'A' from match_players
      where match_id = m1_id and team = m1_winner;
    insert into match_players (match_id, player_id, team)
      select new_match_id, player_id, 'B' from match_players
      where match_id = m2_id and team = m2_winner;
  end loop;

  if has_bye then
    declare
      m_last_id uuid;
      m_last_winner text;
    begin
      select match_id, winner into m_last_id, m_last_winner
      from winners_seq where seq = total_winners;

      insert into matches (tournament_id, round, status, stage, winner)
      values (p_tournament_id, new_round, 'completed', new_stage, 'A')
      returning match_id into bye_match_id;

      insert into match_players (match_id, player_id, team)
        select bye_match_id, player_id, 'A' from match_players
        where match_id = m_last_id and team = m_last_winner;
    end;
  end if;

  return query select * from matches where tournament_id = p_tournament_id and round = new_round;
end;
$$;

grant execute on function advance_bracket(uuid) to authenticated;

-- Optional 3rd-place decider: the two losers of the semifinal round
-- (the round right before the final). Only possible if BOTH semifinal
-- slots were real matches (not byes) — a bye produces no loser.
create or replace function generate_losers_final(p_tournament_id uuid)
returns matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  final_match matches;
  semi_round int;
  semi_count int;
  s1 matches;
  s2 matches;
  new_match matches;
begin
  select group_id into v_group_id from tournaments where tournament_id = p_tournament_id;

  if v_group_id is null then
    raise exception 'Tournament not found';
  end if;

  if not is_group_member(v_group_id) then
    raise exception 'Not a member of this group';
  end if;

  if exists (select 1 from matches where tournament_id = p_tournament_id and stage = 'losers_final') then
    raise exception 'Losers Final has already been generated';
  end if;

  select * into final_match from matches
  where tournament_id = p_tournament_id and stage = 'final';

  if final_match.match_id is null then
    raise exception 'The Final hasn''t been decided yet';
  end if;

  semi_round := final_match.round - 1;

  select count(*) into semi_count
  from matches
  where tournament_id = p_tournament_id and round = semi_round and stage in ('main', 'bracket');

  if semi_count <> 2 then
    raise exception 'Losers Final needs exactly two semifinal matches (found %) — not available when a bye was involved', semi_count;
  end if;

  select * into s1 from matches
    where tournament_id = p_tournament_id and round = semi_round and stage in ('main', 'bracket')
    order by created_at asc limit 1;
  select * into s2 from matches
    where tournament_id = p_tournament_id and round = semi_round and stage in ('main', 'bracket')
    order by created_at asc offset 1 limit 1;

  if not exists (select 1 from match_players where match_id = s1.match_id and team = 'B')
     or not exists (select 1 from match_players where match_id = s2.match_id and team = 'B') then
    raise exception 'Losers Final isn''t available — one of the semifinals was a bye with no loser';
  end if;

  insert into matches (tournament_id, round, status, stage)
  values (p_tournament_id, final_match.round, 'pending', 'losers_final')
  returning * into new_match;

  insert into match_players (match_id, player_id, team)
    select new_match.match_id, player_id, 'A' from match_players
    where match_id = s1.match_id and team <> s1.winner;
  insert into match_players (match_id, player_id, team)
    select new_match.match_id, player_id, 'B' from match_players
    where match_id = s2.match_id and team <> s2.winner;

  return new_match;
end;
$$;

grant execute on function generate_losers_final(uuid) to authenticated;
