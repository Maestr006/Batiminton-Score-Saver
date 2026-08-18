# 🏸 Badminton — Groups, Tournaments & Leaderboards

A multi-user, real-time badminton tournament and leaderboard tracker. Built with
React + Vite + Tailwind on the frontend, and Supabase (PostgreSQL + Auth +
Realtime) as the shared backend, so the architecture can later back a React
Native/Expo mobile app with **no backend changes**.

**🔗 Live site:** [batminton-navy.vercel.app](https://batminton-navy.vercel.app/)

Open the link, pick a display name, and either create a new group or join an
existing one with its 6-character code.

## What's included

- **Group system** — create a group (gets a random 6-character code like
  `ABC123`) or join one with a code. Every player, tournament, match, and
  stat is scoped to a group at the database level (see RLS below), so two
  groups never see each other's data even if player names collide.
- **Home** — group snapshot + top 3 players.
- **Leaderboard** — live-updating win/loss/win% table, computed straight
  from match history (no denormalized counters to drift out of sync).
- **Tournament** — pick players from the group roster (or add new ones),
  randomize them into temporary 2-player teams, auto-generate the round's
  matches, then enter scores. Winners get +1 win, losers +1 loss, broadcast
  to everyone else looking at the same tournament via Supabase Realtime.
- **Byes handled properly** — if an odd number of players is selected, the
  leftover player sits out that round as a bye instead of being forced into
  an uneven team. If the number of teams is odd, one whole team sits out
  too. Both are shown on the tournament page ("Sat out this round: …").
- **Editable scores** — completed matches have an "Edit score" option.
  Saving an edit re-runs the same result logic as a fresh submission, so
  win/loss records and the leaderboard recalculate automatically.
- **Playoffs format (optional)** — when creating a tournament, choose
  "🏆 Playoffs" instead of "Random matches." Once both round-1 matches are
  completed, you can generate a **Final** (winners vs. winners) and,
  optionally, a **Losers Final** (losers vs. losers).
- **Row Level Security** — enforced in Postgres, not just in the React
  code, so isolation holds even against a malicious or buggy client.

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. On the creation screen, under **Security**:
   - Keep **Enable Data API** checked.
   - Turn **off** "Automatically expose new tables" (Supabase's own
     recommendation — access is controlled explicitly instead, see the
     grants note in step 2).
   - **Enable automatic RLS** is safe to leave on; it's a safety net for
     any table created outside the migrations below.
3. In **Project Settings → API**, copy the **Project URL** (or build it
   yourself from the **Project ID** shown under Project Settings →
   General: `https://YOUR-PROJECT-ID.supabase.co`) and the **Publishable
   key** (`sb_publishable_...`) — this is what goes in `VITE_SUPABASE_ANON_KEY`
   below. Never use the **Secret key** (`sb_secret_...`) in the frontend —
   that one bypasses RLS entirely and must stay server-side only.
4. In **Authentication → Providers** (or **Authentication → Settings**),
   enable **Allow anonymous sign-ins**, and make sure it actually saves.
   This app signs visitors in anonymously so people can jump straight into
   a group without creating a password — they just pick a display name.
   (You can swap this for email/magic-link auth later; the schema doesn't
   care how someone authenticates, only that `auth.uid()` exists.)
   You can confirm sign-in is working under **Authentication → Users** —
   a new row should appear each time someone opens the app for the first
   time.
5. In **Database → Replication**, replication is enabled automatically by
   the migration below (it adds tables to the `supabase_realtime`
   publication), but double check Realtime is turned on for the project.

## 2. Run the database migrations

Open **SQL Editor** in your Supabase dashboard and run each file in
`supabase/migrations/`, **in order**:

| File | What it does |
|---|---|
| `0001_init.sql` | Core schema: `user_profiles`, `groups`, `group_members`, `players`, `tournaments`, `matches`, `match_players`; the `player_stats` view; the `create_group`, `join_group_by_code`, `submit_match_result` RPCs; and RLS policies on every table. |
| `0002_fix_grants.sql` | **Required.** Grants basic `SELECT`/`INSERT`/`UPDATE` table privileges to the `authenticated` role. Without this, every request fails with a `42501` (insufficient privilege) error, because RLS policies alone don't grant access — they only restrict access that's already been granted. This is only needed if "Automatically expose new tables" was off when the tables were created (see step 1). |
| `0003_playoffs_and_edit.sql` | Adds `tournaments.format` and `matches.stage`, plus the `generate_stage_matches()` RPC that builds the Final and Losers Final from the two round-1 matches. |
| `0004_bye_players.sql` | Adds `tournaments.bye_player_ids` so who sat out a round is persisted and shown on the tournament page, not just at creation time. |

Policies use `create policy`, which errors if it already exists — if
you're iterating on a migration, drop the relevant policies first.

## 3. Configure the frontend

```bash
cp .env.example .env
```

Fill in:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

## 4. Run it locally

```bash
npm install
npm run dev
```

Visit the printed local URL (usually `http://localhost:5173`). You'll be
signed in anonymously and dropped into **Groups** to create or join one.

## 5. Deploy to Vercel

```bash
npm i -g vercel   # if you don't have it
vercel
```

Or connect the repo in the Vercel dashboard (**Connect Git** — recommended,
since it auto-deploys on every `git push` instead of requiring a manual
`vercel --prod` each time).

Either way:

- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel
  project's **Settings → Environment Variables** (for Production at
  minimum). Local `.env` files are never uploaded automatically, so this
  step is easy to miss — if the deployed site loads but never gets past
  "Loading your groups…", this is almost always why.
- Build command `npm run build`, output directory `dist` (Vercel
  auto-detects this for Vite projects).
- After adding/changing env vars, you must trigger a **new** deployment
  (`vercel --prod`, or push to git) for them to take effect — clicking
  "Redeploy" on an existing deployment reuses the files that were already
  uploaded and won't pick up changes made locally since then.
- `vercel.json` (included) adds a rewrite so every route serves
  `index.html`. Without it, direct links or refreshes on any page other
  than the homepage (e.g. `/groups`, `/tournament/xyz`) return a
  `404: NOT_FOUND` from Vercel, since React Router's client-side routing
  only works once `index.html` has already loaded.

## Project structure

```
supabase/migrations/0001_init.sql              Core schema, RLS policies, RPCs, realtime setup
supabase/migrations/0002_fix_grants.sql        Table grants for the authenticated role
supabase/migrations/0003_playoffs_and_edit.sql Playoffs format + Final/Losers Final generation
supabase/migrations/0004_bye_players.sql       Persisted bye tracking
vercel.json                                    SPA rewrite so direct/refreshed routes work
src/lib/supabaseClient.js                      Supabase client singleton
src/lib/teamRandomizer.js                      Shuffle players into temporary teams, handling byes
src/context/AuthContext.jsx                    Anonymous auth + profile/display name
src/context/GroupContext.jsx                   Current group, group list, create/join
src/components/Nav.jsx                         Top nav + current-group indicator
src/pages/Groups.jsx                           Create / join / switch groups
src/pages/Home.jsx                             Landing page, top 3, group stats
src/pages/Leaderboard.jsx                      Live leaderboard table
src/pages/Tournament.jsx                       Tournament list + creation wizard (format, byes)
src/pages/TournamentDetail.jsx                 Match list, score entry/editing, bracket controls
```

## Design decisions worth knowing about

- **Players are group-scoped rows**, not shared identities across
  groups. This directly satisfies "same-named player in two groups must
  never share stats" — there's no cross-group foreign key to accidentally
  leak through.
- **Teams are never stored on the player.** `match_players.team` ('A'/'B')
  only exists for the lifetime of that one match, so the same person can
  be on a totally different team in the next tournament.
- **Stats are computed, not stored.** `player_stats` is a view over
  `match_players`, so there's no separate "wins" counter that can drift
  out of sync with match history — the leaderboard is always exactly
  derived from completed matches. Editing a score re-derives everything
  downstream for free, since nothing is denormalized.
- **RLS, not app code, is the isolation boundary.** Every policy checks
  group membership via `group_members`, so even a bug in the React app
  can't leak one group's data into another. RLS restricts access on top
  of table grants — both are required, which is what `0002_fix_grants.sql`
  addresses.
- **Byes are player-level, not just team-level.** An odd number of
  selected players never gets merged into an uneven team; the extra
  player sits out instead, same as an odd number of teams producing a
  team-level bye.
- **Playoffs brackets are currently 2-main-match only.** `generate_stage_matches()`
  builds the Final and Losers Final from exactly two round-1 matches
  (winners vs. winners, losers vs. losers). Larger brackets (multiple
  semifinal rounds) aren't supported yet.

## Extending toward the mobile app

Nothing here is web-specific except the React components themselves.
A React Native/Expo app can reuse `@supabase/supabase-js`, the same
migrations, the same RPCs, and the same Realtime channels — only the UI
layer needs to be rebuilt.
