-- =====================================================================
-- Court-based queueing: a tournament now records how many courts are
-- physically available. When matches are created, only that many are
-- marked "on court" (active, ready to score); the rest sit queued. As
-- soon as an active match is completed, a trigger automatically
-- promotes the next queued match onto a court — no need to wait for
-- every match in a round to finish before the group can keep playing.
-- =====================================================================

alter table tournaments
  add column if not exists court_count integer not null default 1 check (court_count >= 1);

alter table matches
  add column if not exists on_court boolean not null default true;

create or replace function promote_queued_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_match_id uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select match_id into next_match_id
    from matches
    where tournament_id = new.tournament_id
      and on_court = false
      and status = 'pending'
    order by created_at asc
    limit 1;

    if next_match_id is not null then
      update matches set on_court = true where match_id = next_match_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_promote_queued_match on matches;
create trigger trg_promote_queued_match
  after update on matches
  for each row execute function promote_queued_match();

-- Re-create advance_bracket and generate_losers_final so newly created
-- rounds respect the tournament's court_count too (only the first
-- court_count matches of a fresh round start "on court").
create or replace function advance_bracket(p_tournament_id uuid)
returns setof matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_format text;
  v_court_count int;
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
  select group_id, format, court_count into v_group_id, v_format, v_court_count
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

    insert into matches (tournament_id, round, status, stage, on_court)
    values (p_tournament_id, new_round, 'pending', new_stage, i <= v_court_count)
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

      insert into matches (tournament_id, round, status, stage, winner, on_court)
      values (p_tournament_id, new_round, 'completed', new_stage, 'A', true)
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
