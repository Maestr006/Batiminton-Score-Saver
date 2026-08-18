// Shuffle selected players and split them into teams of `teamSize`
// (default 2, i.e. doubles). If the count doesn't divide evenly, the
// extra player(s) sit out this round as a bye instead of being forced
// into an uneven team — every team returned is always exactly `teamSize`.
export function randomizeTeams(players, teamSize = 2) {
  const shuffled = [...players]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const remainder = shuffled.length % teamSize
  const playerBye = remainder > 0 ? shuffled.splice(0, remainder) : []

  const teams = []
  for (let i = 0; i < shuffled.length; i += teamSize) {
    teams.push(shuffled.slice(i, i + teamSize))
  }

  return { teams, playerBye }
}

// Pair teams into head-to-head matches: [0]v[1], [2]v[3], ...
// If there's an odd team out, it gets a bye (returned separately).
export function pairTeamsIntoMatches(teams) {
  const matches = []
  let bye = null
  for (let i = 0; i < teams.length; i += 2) {
    if (teams[i + 1]) {
      matches.push({ teamA: teams[i], teamB: teams[i + 1] })
    } else {
      bye = teams[i]
    }
  }
  return { matches, bye }
}
