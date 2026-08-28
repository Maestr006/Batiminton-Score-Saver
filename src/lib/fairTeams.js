// Fetches each selected group's full match history and derives two things:
//   - gamesPlayed:   Map<player_id, number>  — how many matches they've been
//                     assigned to, ever, in this group (regardless of score).
//   - partnerCounts: Map<"idA|idB", number>  — how many times two players
//                     have been TEAMMATES before (sorted pair key).
//
// This is what lets team assignment prefer players who've played less, and
// prefer partnering people who haven't played together yet.
export async function fetchFairnessData(supabase, groupId) {
  const gamesPlayed = new Map()
  const partnerCounts = new Map()

  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('tournament_id')
    .eq('group_id', groupId)
  const tournamentIds = (tournaments || []).map((t) => t.tournament_id)
  if (tournamentIds.length === 0) return { gamesPlayed, partnerCounts }

  const { data: matches } = await supabase
    .from('matches')
    .select('match_id')
    .in('tournament_id', tournamentIds)
  const matchIds = (matches || []).map((m) => m.match_id)
  if (matchIds.length === 0) return { gamesPlayed, partnerCounts }

  const { data: matchPlayers } = await supabase
    .from('match_players')
    .select('match_id, player_id, team')
    .in('match_id', matchIds)

  const byMatch = new Map()
  for (const row of matchPlayers || []) {
    gamesPlayed.set(row.player_id, (gamesPlayed.get(row.player_id) || 0) + 1)
    if (!byMatch.has(row.match_id)) byMatch.set(row.match_id, { A: [], B: [] })
    byMatch.get(row.match_id)[row.team].push(row.player_id)
  }

  const pairKey = (a, b) => [a, b].sort().join('|')

  for (const { A, B } of byMatch.values()) {
    for (const team of [A, B]) {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const key = pairKey(team[i], team[j])
          partnerCounts.set(key, (partnerCounts.get(key) || 0) + 1)
        }
      }
    }
  }

  return { gamesPlayed, partnerCounts }
}

// Given the selected players and their fairness history, decides:
//   1. Who sits out this tournament (benched) — whoever has played the
//      MOST games so far, just enough of them to leave a clean multiple
//      of 4 players (so every team gets a full match, no leftover team).
//   2. How to pair the rest into teams — greedily partnering each player
//      with whoever they've played WITH the fewest times before.
//
// Ties (equal games played, equal partner history) are broken randomly,
// so the algorithm doesn't always pick the same players/pairs when stats
// are equal.
export function assignFairTeams(selectedPlayers, gamesPlayed = new Map(), partnerCounts = new Map()) {
  const shuffle = (arr) => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  // Shuffle first so equal-games ties break randomly, then sort
  // most-played-first — those are the ones we'll bench if we need to.
  const bySeniority = shuffle(selectedPlayers).sort(
    (a, b) => (gamesPlayed.get(b.player_id) || 0) - (gamesPlayed.get(a.player_id) || 0)
  )

  const benchCount = bySeniority.length % 4
  const benched = bySeniority.slice(0, benchCount)
  const playing = shuffle(bySeniority.slice(benchCount))

  const pairKey = (a, b) => [a, b].sort().join('|')

  const teams = []
  const remaining = [...playing]
  while (remaining.length >= 2) {
    const p1 = remaining.shift()
    let bestIdx = 0
    let bestCount = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const count = partnerCounts.get(pairKey(p1.player_id, remaining[i].player_id)) || 0
      if (count < bestCount) {
        bestCount = count
        bestIdx = i
      }
    }
    const [p2] = remaining.splice(bestIdx, 1)
    teams.push([p1, p2])
  }

  return { teams, benched }
}
