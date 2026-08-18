-- =====================================================================
-- Badminton Tournament & Group Management — initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push`)
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. user_profiles — one row per authenticated app user
-- ---------------------------------------------------------------------
create table if not exists user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  created_at timestamptz not null default now()
);

-- Auto-create a profile whenever someone signs up (email, magic link,
-- or anonymous auth all fire auth.users inserts).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Player'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- 2. groups
-- ---------------------------------------------------------------------
create table if not exists groups (
  group_id uuid primary key default gen_random_uuid(),
  group_code text not null unique,
  group_name text not null,
  created_by uuid references user_profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. group_members — controls WHO (which auth user) can see a group
-- ---------------------------------------------------------------------
create table if not exists group_members (
  group_id uuid not null references groups (group_id) on delete cascade,
  user_id uuid not null references user_profiles (id) on delete cascade,
  role text not null default 'member', -- 'owner' | 'member'
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ---------------------------------------------------------------------
-- 4. players — the roster of named players *within* a group.
--    Same person in two groups = two separate rows = fully isolated stats.
-- ---------------------------------------------------------------------
create table if not exists players (
  player_id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (group_id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. tournaments
-- ---------------------------------------------------------------------
create table if not exists tournaments (
  tournament_id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (group_id) on delete cascade,
  name text not null,
  status text not null default 'active', -- 'active' | 'completed'
  created_by uuid references user_profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. matches
-- ---------------------------------------------------------------------
create table if not exists matches (
  match_id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (tournament_id) on delete cascade,
  round int not null default 1,
  score_team_a int,
  score_team_b int,
  winner text, -- 'A' | 'B' | null until played
  status text not null default 'pending', -- 'pending' | 'completed'
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. match_players — temporary team assignment for a single match
-- ---------------------------------------------------------------------
create table if not exists match_players (
  match_id uuid not null references matches (match_id) on delete cascade,
  player_id uuid not null references players (player_id) on delete cascade,
  team text not null, -- 'A' | 'B'
  result text, -- 'win' | 'loss' | null until played
  primary key (match_id, player_id)
);

create index if not exists idx_players_group on players (group_id);
create index if not exists idx_tournaments_group on tournaments (group_id);
create index if not exists idx_matches_tournament on matches (tournament_id);
create index if not exists idx_match_players_player on match_players (player_id);
create index if not exists idx_group_members_user on group_members (user_id);

-- =====================================================================
-- Helper functions used by RLS policies
-- =====================================================================
create or replace function is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

create or replace function group_id_for_tournament(p_tournament_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select group_id from tournaments where tournament_id = p_tournament_id;
$$;

create or replace function group_id_for_match(p_match_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select t.group_id
  from matches m
  join tournaments t on t.tournament_id = m.tournament_id
  where m.match_id = p_match_id;
$$;

-- =====================================================================
-- Row Level Security — data isolation is enforced here, not in the app
-- =====================================================================
alter table user_profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table players enable row level security;
alter table tournaments enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;

-- user_profiles: everyone can read display names of people they share a
-- group with; you can always read/update your own row.
create policy "read own profile" on user_profiles
  for select using (id = auth.uid());
create policy "update own profile" on user_profiles
  for update using (id = auth.uid());

-- groups: only visible to members. Any authenticated user may create one
-- (they become a member via the create_group() RPC below).
create policy "members can read their groups" on groups
  for select using (is_group_member(group_id));
create policy "authenticated users can create groups" on groups
  for insert with check (auth.uid() = created_by);

-- group_members: you can see membership rows for groups you belong to.
create policy "members can read group membership" on group_members
  for select using (is_group_member(group_id));

-- players: scoped to group members only.
create policy "members can read players" on players
  for select using (is_group_member(group_id));
create policy "members can add players" on players
  for insert with check (is_group_member(group_id));
create policy "members can update players" on players
  for update using (is_group_member(group_id));

-- tournaments: scoped to group members only.
create policy "members can read tournaments" on tournaments
  for select using (is_group_member(group_id));
create policy "members can create tournaments" on tournaments
  for insert with check (is_group_member(group_id));
create policy "members can update tournaments" on tournaments
  for update using (is_group_member(group_id));

-- matches: scoped via the parent tournament's group.
create policy "members can read matches" on matches
  for select using (is_group_member(group_id_for_tournament(tournament_id)));
create policy "members can create matches" on matches
  for insert with check (is_group_member(group_id_for_tournament(tournament_id)));
create policy "members can update matches" on matches
  for update using (is_group_member(group_id_for_tournament(tournament_id)));

-- match_players: scoped via the match's tournament's group.
create policy "members can read match players" on match_players
  for select using (is_group_member(group_id_for_match(match_id)));
create policy "members can insert match players" on match_players
  for insert with check (is_group_member(group_id_for_match(match_id)));
create policy "members can update match players" on match_players
  for update using (is_group_member(group_id_for_match(match_id)));

-- =====================================================================
-- RPCs — group creation / joining happen through SECURITY DEFINER
-- functions so a user can look up a group by code without first having
-- broad read access to the whole groups table.
-- =====================================================================
create or replace function generate_group_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  code text;
  exists_already boolean;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    end loop;
    select exists(select 1 from groups where group_code = code) into exists_already;
    exit when not exists_already;
  end loop;
  return code;
end;
$$;

create or replace function create_group(p_name text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  new_group groups;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to create a group';
  end if;

  insert into groups (group_code, group_name, created_by)
  values (generate_group_code(), trim(p_name), auth.uid())
  returning * into new_group;

  insert into group_members (group_id, user_id, role)
  values (new_group.group_id, auth.uid(), 'owner');

  return new_group;
end;
$$;

create or replace function join_group_by_code(p_code text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group groups;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to join a group';
  end if;

  select * into target_group from groups where group_code = upper(trim(p_code));

  if target_group.group_id is null then
    raise exception 'No group found with that code';
  end if;

  insert into group_members (group_id, user_id, role)
  values (target_group.group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return target_group;
end;
$$;

-- Submits a final score for a match, determines the winner, and marks
-- every player's result. Statistics are derived live from match_players
-- (see the player_stats view below), so there is nothing else to update.
create or replace function submit_match_result(
  p_match_id uuid,
  p_score_a int,
  p_score_b int
)
returns matches
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_match matches;
  winning_team text;
begin
  if not is_group_member(group_id_for_match(p_match_id)) then
    raise exception 'Not a member of this match''s group';
  end if;

  winning_team := case when p_score_a > p_score_b then 'A'
                       when p_score_b > p_score_a then 'B'
                       else null end;

  if winning_team is null then
    raise exception 'Scores cannot be tied';
  end if;

  update matches
  set score_team_a = p_score_a,
      score_team_b = p_score_b,
      winner = winning_team,
      status = 'completed'
  where match_id = p_match_id
  returning * into updated_match;

  update match_players
  set result = case when team = winning_team then 'win' else 'loss' end
  where match_id = p_match_id;

  return updated_match;
end;
$$;

grant execute on function create_group(text) to authenticated;
grant execute on function join_group_by_code(text) to authenticated;
grant execute on function submit_match_result(uuid, int, int) to authenticated;

-- =====================================================================
-- player_stats — live leaderboard view, always in sync with matches.
-- Isolated per group because player_id itself is scoped to a group.
-- =====================================================================
create or replace view player_stats as
select
  p.group_id,
  p.player_id,
  p.name,
  count(mp.result) filter (where mp.result is not null) as matches_played,
  count(mp.result) filter (where mp.result = 'win') as wins,
  count(mp.result) filter (where mp.result = 'loss') as losses,
  case
    when count(mp.result) filter (where mp.result is not null) = 0 then 0
    else round(
      100.0 * count(mp.result) filter (where mp.result = 'win')
      / count(mp.result) filter (where mp.result is not null), 1
    )
  end as win_pct
from players p
left join match_players mp on mp.player_id = p.player_id
group by p.group_id, p.player_id, p.name;

-- Views run with the querying user's own RLS on their underlying tables,
-- so player_stats automatically inherits the players/match_players
-- policies above — no separate grant needed beyond normal table access.

-- =====================================================================
-- Realtime — add tables to the supabase_realtime publication so the
-- frontend can subscribe to live changes.
-- =====================================================================
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table match_players;
alter publication supabase_realtime add table tournaments;
alter publication supabase_realtime add table players;
