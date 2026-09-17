import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useGroup } from '../context/GroupContext'
import { pairTeamsIntoMatches } from '../lib/teamRandomizer'
import { fetchFairnessData, assignFairTeams } from '../lib/fairTeams'

export default function Tournament() {
  const { currentGroup } = useGroup()
  const navigate = useNavigate()

  const [tournaments, setTournaments] = useState([])
  const [players, setPlayers] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [newPlayerName, setNewPlayerName] = useState('')
  const [tournamentName, setTournamentName] = useState('')
  const [format, setFormat] = useState('random') // 'random' | 'playoffs'
  const [courtCount, setCourtCount] = useState(2)
  const [teams, setTeams] = useState(null) // null until randomized
  const [benched, setBenched] = useState([]) // players sitting out this tournament
  const [creating, setCreating] = useState(false)
  const [randomizing, setRandomizing] = useState(false)
  const [error, setError] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [selectionInitialized, setSelectionInitialized] = useState(false)

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

  // Pre-check whoever played (or sat out) in the most recent tournament,
  // since it's usually mostly the same people showing up again. Only
  // runs once, so it never overwrites a selection you've made yourself.
  useEffect(() => {
    if (selectionInitialized || players.length === 0) return
    if (tournaments.length === 0) {
      setSelectionInitialized(true)
      return
    }
    async function loadLastSelection() {
      const last = tournaments[0]
      const { data: lastMatches } = await supabase
        .from('matches')
        .select('match_players(player_id)')
        .eq('tournament_id', last.tournament_id)

      const ids = new Set()
      for (const m of lastMatches || []) {
        for (const mp of m.match_players || []) ids.add(mp.player_id)
      }
      for (const id of last.bye_player_ids || []) ids.add(id)

      const validIds = new Set(players.map((p) => p.player_id))
      setSelected(new Set([...ids].filter((id) => validIds.has(id))))
      setSelectionInitialized(true)
    }
    loadLastSelection()
  }, [tournaments, players, selectionInitialized])

  function togglePlayer(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setTeams(null)
    setBenched([])
  }

  function selectAll() {
    setSelected(new Set(players.map((p) => p.player_id)))
    setTeams(null)
    setBenched([])
  }

  function selectNone() {
    setSelected(new Set())
    setTeams(null)
    setBenched([])
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

  async function handleRandomize() {
    const chosen = players.filter((p) => selected.has(p.player_id))
    if (chosen.length < 4) {
      setError('Select at least 4 players to form two teams.')
      return
    }
    setError('')
    setRandomizing(true)
    const { gamesPlayed, partnerCounts } = await fetchFairnessData(supabase, currentGroup.group_id)
    const { teams: generatedTeams, benched: benchedPlayers } = assignFairTeams(
      chosen,
      gamesPlayed,
      partnerCounts
    )
    setRandomizing(false)

    if (generatedTeams.length < 2) {
      setError('Not enough players left to form two teams after byes — select a few more.')
      setTeams(null)
      return
    }
    setTeams(generatedTeams)
    setBenched(benchedPlayers)
  }

  function swapIn(benchedPlayer, playingPlayerId) {
    let outgoing = null
    const newTeams = teams.map((team) => {
      const idx = team.findIndex((p) => p.player_id === playingPlayerId)
      if (idx === -1) return team
      outgoing = team[idx]
      const copy = [...team]
      copy[idx] = benchedPlayer
      return copy
    })
    if (!outgoing) return
    setTeams(newTeams)
    setBenched((prev) => prev.filter((p) => p.player_id !== benchedPlayer.player_id).concat(outgoing))
  }

  async function handleCreateTournament() {
    if (!teams) return
    setCreating(true)
    setError('')

    const { matches: pairedMatches } = pairTeamsIntoMatches(teams)
    const byeIds = benched.map((p) => p.player_id)

    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .insert({
        group_id: currentGroup.group_id,
        name: tournamentName.trim() || `Tournament ${new Date().toLocaleDateString()}`,
        status: 'active',
        format,
        bye_player_ids: byeIds,
        court_count: courtCount,
      })
      .select()
      .single()

    if (tErr) {
      setError(tErr.message)
      setCreating(false)
      return
    }

    for (const [i, { teamA, teamB }] of pairedMatches.entries()) {
      const { data: match, error: mErr } = await supabase
        .from('matches')
        .insert({
          tournament_id: tournament.tournament_id,
          round: 1,
          status: 'pending',
          on_court: i < courtCount,
        })
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
            <label className="label">Courts available</label>
            <input
              type="number"
              min={1}
              className="input mt-1 w-24"
              value={courtCount}
              onChange={(e) => setCourtCount(Math.max(1, Number(e.target.value) || 1))}
            />
            <p className="mt-1.5 text-xs text-ink/40">
              Only this many matches will be active at once. As soon as one finishes, the next
              queued match automatically becomes playable — no need to wait for everyone to finish
              before starting more.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label">Select players</label>
              <div className="flex gap-3 text-xs font-semibold text-court">
                <button type="button" onClick={selectAll} className="hover:underline">Select all</button>
                <button type="button" onClick={selectNone} className="hover:underline">Select none</button>
              </div>
            </div>
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

          <button className="btn-accent w-full" onClick={handleRandomize} disabled={randomizing}>
            {randomizing ? 'Balancing teams…' : `🎲 Randomize Teams (${selected.size} selected)`}
          </button>

          {teams && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="label">Matchups</p>
                <button
                  type="button"
                  onClick={handleRandomize}
                  disabled={randomizing}
                  className="text-xs font-semibold text-court hover:underline disabled:opacity-50"
                >
                  {randomizing ? 'Regenerating…' : '🔁 Regenerate'}
                </button>
              </div>
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
              {benched.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-sm text-ink/50">
                    Not playing this tournament — auto-picked for fair rotation:
                  </p>
                  <ul className="space-y-1.5">
                    {benched.map((p) => (
                      <li key={p.player_id} className="flex items-center justify-between gap-2 text-sm">
                        <span>{p.name}</span>
                        <select
                          className="input !w-auto !py-1 text-xs"
                          value=""
                          onChange={(e) => { if (e.target.value) swapIn(p, e.target.value) }}
                        >
                          <option value="">Swap in for…</option>
                          {teams.flat().map((pl) => (
                            <option key={pl.player_id} value={pl.player_id}>{pl.name}</option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
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
