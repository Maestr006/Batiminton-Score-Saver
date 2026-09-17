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

// Partitions the playing pool into teams of 2, trying to eliminate
// repeat partnerships entirely rather than just reduce them.
//
// A simple left-to-right greedy pick (pair player 1 with whoever they've
// played with least, then move on) can accidentally box in a later
// player so their only remaining options have all been their partners
// before — even when a different overall arrangement would have let
// everyone avoid a repeat. This does a real search instead: at each
// step it tries the least-repeated candidate first, and backtracks if
// that choice turns out to make a later pairing worse than the best
// found so far. Because it always tries the best option first, it finds
// a zero-repeat arrangement almost immediately whenever one exists, and
// otherwise settles for the arrangement with the fewest total repeats.
function findBestPairing(players, partnerCounts) {
  const pairKey = (a, b) => [a, b].sort().join('|')

  let best = null
  let bestScore = Infinity
  let attempts = 0
  const MAX_ATTEMPTS = 200000 // safety cap so a pathological input can't hang the browser

  function recurse(remaining, current, score) {
    attempts++
    if (bestScore === 0 || attempts > MAX_ATTEMPTS) return bestScore === 0
    if (score >= bestScore) return false

    if (remaining.length === 0) {
      best = current.map((t) => [...t])
      bestScore = score
      return score === 0
    }

    const [p1, ...rest] = remaining
    const candidates = rest
      .map((p2) => ({ p2, count: partnerCounts.get(pairKey(p1.player_id, p2.player_id)) || 0 }))
      .sort((a, b) => a.count - b.count)

    for (const { p2, count } of candidates) {
      const nextRemaining = rest.filter((p) => p !== p2)
      current.push([p1, p2])
      const solved = recurse(nextRemaining, current, score + count)
      current.pop()
      if (solved) return true
    }
    return false
  }

  recurse(players, [], 0)
  return best || []
}

// Given the selected players and their fairness history, decides:
//   1. Who sits out this tournament (benched). Priority order:
//        a. Players who've already partnered with EVERY other selected
//           player at least once ("graduated") and weren't benched last
//           time — they've gotten full rotation value, so resting them
//           makes room for people who still have partners left to try.
//        b. Graduated players who WERE benched last time — still
//           reasonable to rest again, but only once there's no fresher
//           graduate available, so nobody sits out two tournaments in a
//           row unless it's truly unavoidable.
//        c. Anyone who hasn't graduated yet — sorted by games played
//           descending, same fallback as before. These are the last
//           resort, since benching them would stall their rotation.
//   2. How to pair the rest into teams — searching for the arrangement
//      with the fewest repeat partnerships (zero, whenever possible),
//      not just a locally-good greedy guess.
//
// Ties within a tier are broken randomly, so the algorithm doesn't
// always pick the same players when stats are equal.
export function assignFairTeams(
  selectedPlayers,
  gamesPlayed = new Map(),
  partnerCounts = new Map(),
  lastBenchedIds = new Set()
) {
  const shuffle = (arr) => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  const pairKey = (a, b) => [a, b].sort().join('|')

  const hasPartneredWithAll = (player) =>
    selectedPlayers.length > 1 &&
    selectedPlayers.every(
      (other) =>
        other.player_id === player.player_id ||
        (partnerCounts.get(pairKey(player.player_id, other.player_id)) || 0) > 0
    )

  const tiered = shuffle(selectedPlayers).map((p) => {
    const graduated = hasPartneredWithAll(p)
    const benchedLastTime = lastBenchedIds.has(p.player_id)
    const tier = graduated ? (benchedLastTime ? 1 : 0) : 2
    return { p, tier, games: gamesPlayed.get(p.player_id) || 0 }
  })

  tiered.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.tier === 2) return b.games - a.games // fallback: most-played first
    return 0 // graduated tiers are already shuffled — keep random order
  })

  const ordered = tiered.map((t) => t.p)
  const benchCount = ordered.length % 4
  const benched = ordered.slice(0, benchCount)
  const playing = shuffle(ordered.slice(benchCount))

  const teams = findBestPairing(playing, partnerCounts)

  return { teams, benched }
}
