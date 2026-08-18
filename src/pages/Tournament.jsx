import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useGroup } from '../context/GroupContext'
import { randomizeTeams, pairTeamsIntoMatches } from '../lib/teamRandomizer'

export default function Tournament() {
  const { currentGroup } = useGroup()
  const navigate = useNavigate()

  const [tournaments, setTournaments] = useState([])
  const [players, setPlayers] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [newPlayerName, setNewPlayerName] = useState('')
  const [tournamentName, setTournamentName] = useState('')
  const [format, setFormat] = useState('random') // 'random' | 'playoffs'
  const [teams, setTeams] = useState(null) // null until randomized
  const [teamBye, setTeamBye] = useState(null) // leftover odd team, sits out this round
  const [playerBye, setPlayerBye] = useState([]) // leftover odd player(s), sit out this round
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [showWizard, setShowWizard] = useState(false)

  const loadData = useCallback(async () => {
    if (!currentGroup) return
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase
        .from('tournaments')
        .select('*')
        .eq('group_id', currentGroup.group_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('players')
        .select('*')
        .eq('group_id', currentGroup.group_id)
        .order('name'),
    ])
    setTournaments(t || [])
    setPlayers(p || [])
  }, [currentGroup])

  useEffect(() => { loadData() }, [loadData])

  function togglePlayer(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setTeams(null)
    setTeamBye(null)
    setPlayerBye([])
  }

  async function addPlayer(e) {
    e.preventDefault()
    if (!newPlayerName.trim()) return
    const { data, error } = await supabase
      .from('players')
      .insert({ group_id: currentGroup.group_id, name: newPlayerName.trim() })
      .select()
      .single()
    if (!error) {
      setPlayers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setSelected((prev) => new Set(prev).add(data.player_id))
      setNewPlayerName('')
    }
  }

  function handleRandomize() {
    const chosen = players.filter((p) => selected.has(p.player_id))
    if (chosen.length < 4) {
      setError('Select at least 4 players to form two teams.')
      return
    }
    setError('')
    const { teams: generatedTeams, playerBye: leftoverPlayers } = randomizeTeams(chosen, 2)
    if (generatedTeams.length < 2) {
      setError('Not enough players left to form two teams after byes — select a few more.')
      setTeams(null)
      return
    }
    setTeams(generatedTeams)
    setPlayerBye(leftoverPlayers)
    const { bye: byeTeam } = pairTeamsIntoMatches(generatedTeams)
    setTeamBye(byeTeam)
  }

  async function handleCreateTournament() {
    if (!teams) return
    setCreating(true)
    setError('')

    const { matches: pairedMatches } = pairTeamsIntoMatches(teams)
    const byeIds = [...playerBye, ...(teamBye || [])].map((p) => p.player_id)

    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .insert({
        group_id: currentGroup.group_id,
        name: tournamentName.trim() || `Tournament ${new Date().toLocaleDateString()}`,
        status: 'active',
        format,
        bye_player_ids: byeIds,
      })
      .select()
      .single()

    if (tErr) {
      setError(tErr.message)
      setCreating(false)
      return
    }

    for (const { teamA, teamB } of pairedMatches) {
      const { data: match, error: mErr } = await supabase
        .from('matches')
        .insert({ tournament_id: tournament.tournament_id, round: 1, status: 'pending' })
        .select()
        .single()
      if (mErr) { setError(mErr.message); continue }

      const rows = [
        ...teamA.map((p) => ({ match_id: match.match_id, player_id: p.player_id, team: 'A' })),
        ...teamB.map((p) => ({ match_id: match.match_id, player_id: p.player_id, team: 'B' })),
      ]
      await supabase.from('match_players').insert(rows)
    }

    setCreating(false)
    navigate(`/tournament/${tournament.tournament_id}`)
  }

  return (
    <div className="py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tournaments</h1>
        <button className="btn-primary" onClick={() => setShowWizard((v) => !v)}>
          {showWizard ? 'Close' : '🎲 New Tournament'}
        </button>
      </div>

      {showWizard && (
        <div className="card mt-6 space-y-6 p-5">
          <div>
            <label className="label">Tournament name (optional)</label>
            <input
              className="input mt-1"
              value={tournamentName}
              onChange={(e) => setTournamentName(e.target.value)}
              placeholder="e.g. Friday Night Doubles"
            />
          </div>

          <div>
            <label className="label">Format</label>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setFormat('random')}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  format === 'random'
                    ? 'border-court bg-court text-court-line'
                    : 'border-ink/15 bg-white hover:border-court/40'
                }`}
              >
                Random matches
              </button>
              <button
                type="button"
                onClick={() => setFormat('playoffs')}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  format === 'playoffs'
                    ? 'border-court bg-court text-court-line'
                    : 'border-ink/15 bg-white hover:border-court/40'
                }`}
              >
                🏆 Playoffs
              </button>
            </div>
            {format === 'playoffs' && (
              <p className="mt-1.5 text-xs text-ink/40">
                After the two main matches finish, you'll get an option to generate a Final
                (winners vs winners) and, if you want, a Losers Final.
              </p>
            )}
          </div>

          <div>
            <label className="label">Select players</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {players.map((p) => (
                <button
                  key={p.player_id}
                  onClick={() => togglePlayer(p.player_id)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    selected.has(p.player_id)
                      ? 'border-court bg-court text-court-line'
                      : 'border-ink/15 bg-white hover:border-court/40'
                  }`}
                >
                  {p.name}
                </button>
              ))}
              {players.length === 0 && <p className="text-sm text-ink/40">No players yet — add some below.</p>}
            </div>

            <form onSubmit={addPlayer} className="mt-3 flex gap-2">
              <input
                className="input"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                placeholder="Add a new player…"
              />
              <button type="submit" className="btn-ghost shrink-0">Add</button>
            </form>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button className="btn-accent w-full" onClick={handleRandomize}>
            🎲 Randomize Teams ({selected.size} selected)
          </button>

          {teams && (
            <div>
              <p className="label mb-2">Matchups</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {pairTeamsIntoMatches(teams).matches.map((m, i) => (
                  <div key={i} className="card p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Match {i + 1}</p>
                    <p className="mt-1 font-display font-semibold">{m.teamA.map((p) => p.name).join(' + ')}</p>
                    <p className="my-1 text-center text-xs text-ink/40">vs</p>
                    <p className="font-display font-semibold">{m.teamB.map((p) => p.name).join(' + ')}</p>
                  </div>
                ))}
              </div>
              {teamBye && (
                <p className="mt-3 text-sm text-ink/50">
                  Team bye this round: {teamBye.map((p) => p.name).join(' + ')}
                </p>
              )}
              {playerBye.length > 0 && (
                <p className="mt-1 text-sm text-ink/50">
                  Player bye this round: {playerBye.map((p) => p.name).join(', ')}
                </p>
              )}
              <button
                className="btn-primary mt-4 w-full"
                onClick={handleCreateTournament}
                disabled={creating}
              >
                {creating ? 'Creating…' : 'Create Tournament & Generate Matches'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-8">
        <h2 className="label mb-3">Past &amp; active tournaments</h2>
        {tournaments.length === 0 ? (
          <p className="card p-5 text-ink/50">No tournaments yet for this group.</p>
        ) : (
          <ul className="space-y-2">
            {tournaments.map((t) => (
              <li key={t.tournament_id}>
                <button
                  onClick={() => navigate(`/tournament/${t.tournament_id}`)}
                  className="card flex w-full items-center justify-between p-4 text-left hover:border-court/40"
                >
                  <div>
                    <p className="font-display font-semibold">{t.name}</p>
                    <p className="text-xs text-ink/40">{new Date(t.created_at).toLocaleString()}</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      t.status === 'completed' ? 'bg-ink/10 text-ink/50' : 'bg-court/10 text-court'
                    }`}
                  >
                    {t.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
