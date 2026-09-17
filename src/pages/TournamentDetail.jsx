import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// Looks at all of a tournament's pending matches and, if fewer than
// court_count are currently marked on_court, promotes the earliest
// queued ones to fill the gap. Acts as a client-side safety net on top
// of the database trigger, so a court frees up the moment ANY single
// active match finishes — not only once every active match has.
async function reconcileCourts(matches, courtCount) {
  const activePending = matches.filter((m) => m.on_court && m.status === 'pending')
  const queued = matches
    .filter((m) => !m.on_court && m.status === 'pending')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  const freeSlots = courtCount - activePending.length
  if (freeSlots <= 0 || queued.length === 0) return false

  const toPromote = queued.slice(0, freeSlots)
  await Promise.all(
    toPromote.map((m) => supabase.from('matches').update({ on_court: true }).eq('match_id', m.match_id))
  )
  return true
}

export default function TournamentDetail() {
  const { tournamentId } = useParams()
  const [tournament, setTournament] = useState(null)
  const [matches, setMatches] = useState([])
  const [byePlayers, setByePlayers] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [{ data: t }, { data: m }] = await Promise.all([
      supabase.from('tournaments').select('*').eq('tournament_id', tournamentId).single(),
      supabase
        .from('matches')
        .select('*, match_players(*, players(name))')
        .eq('tournament_id', tournamentId)
        .order('round')
        .order('created_at'),
    ])
    setTournament(t)

    let matchesData = m || []
    if (t && matchesData.length > 0) {
      const promoted = await reconcileCourts(matchesData, t.court_count)
      if (promoted) {
        const { data: fresh } = await supabase
          .from('matches')
          .select('*, match_players(*, players(name))')
          .eq('tournament_id', tournamentId)
          .order('round')
          .order('created_at')
        matchesData = fresh || matchesData
      }
    }
    setMatches(matchesData)

    if (t?.bye_player_ids?.length) {
      const { data: bp } = await supabase
        .from('players')
        .select('player_id, name')
        .in('player_id', t.bye_player_ids)
      setByePlayers(bp || [])
    } else {
      setByePlayers([])
    }
    setLoading(false)
  }, [tournamentId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase
      .channel(`tournament-${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [tournamentId, load])

  if (loading) return <p className="py-10 text-center text-ink/40">Loading tournament…</p>
  if (!tournament) return <p className="py-10 text-center text-ink/40">Tournament not found.</p>

  const isPlayoffs = tournament.format === 'playoffs'
  const finalMatch = matches.find((m) => m.stage === 'final')
  const losersFinalMatch = matches.find((m) => m.stage === 'losers_final')

  const winnersMatches = matches.filter((m) => m.stage !== 'losers_final')
  const highestRound = winnersMatches.reduce((max, m) => Math.max(max, m.round), 0)
  const currentRoundMatches = winnersMatches.filter((m) => m.round === highestRound)
  const currentRoundComplete = currentRoundMatches.length > 0 && currentRoundMatches.every((m) => m.status === 'completed')
  const canAdvance = isPlayoffs && !finalMatch && currentRoundComplete

  const rounds = {}
  for (const m of winnersMatches) {
    ;(rounds[m.round] ??= []).push(m)
  }
  const roundNumbers = Object.keys(rounds).map(Number).sort((a, b) => a - b)

  function roundLabel(roundNum, roundMatches) {
    if (roundMatches[0]?.stage === 'final') return '🏆 Final'
    if (roundNum === 1) return 'Round 1'
    return `Round ${roundNum}`
  }

  return (
    <div className="py-6">
      <Link to="/tournament" className="text-sm text-court hover:underline">← Back to tournaments</Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{tournament.name}</h1>
        <div className="flex items-center gap-2">
          {isPlayoffs && (
            <span className="rounded-full bg-cork/10 px-2.5 py-1 text-xs font-semibold text-cork-dark">
              🏆 Playoffs
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              tournament.status === 'completed' ? 'bg-ink/10 text-ink/50' : 'bg-court/10 text-court'
            }`}
          >
            {tournament.status}
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs text-ink/40">
        {tournament.court_count} court{tournament.court_count === 1 ? '' : 's'} available
      </p>

      <div className="mt-6 space-y-6">
        {roundNumbers.map((roundNum) => {
          const roundMatches = rounds[roundNum]
          const onCourt = roundMatches.filter((m) => m.on_court)
          const queued = roundMatches.filter((m) => !m.on_court)
          return (
            <div key={roundNum}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/30">
                {roundLabel(roundNum, roundMatches)}
              </p>
              <div className="space-y-4">
                {onCourt.map((m, i) => (
                  <MatchCard key={m.match_id} match={m} index={i} onScored={load} />
                ))}
              </div>
              {queued.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/30">
                    Up next — waiting for a court
                  </p>
                  <div className="space-y-4">
                    {queued.map((m, i) => (
                      <MatchCard key={m.match_id} match={m} index={onCourt.length + i} onScored={load} queued />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {losersFinalMatch && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/30">Losers Final</p>
            <MatchCard match={losersFinalMatch} index={0} onScored={load} queued={!losersFinalMatch.on_court} />
          </div>
        )}
      </div>

      {byePlayers.length > 0 && (
        <p className="mt-4 text-sm text-ink/40">
          Sat out this tournament: {byePlayers.map((p) => p.name).join(', ')}
        </p>
      )}

      {isPlayoffs && (
        <BracketControls
          tournamentId={tournamentId}
          canAdvance={canAdvance}
          hasFinal={!!finalMatch}
          hasLosersFinal={!!losersFinalMatch}
          onGenerated={load}
        />
      )}
    </div>
  )
}

function BracketControls({ tournamentId, canAdvance, hasFinal, hasLosersFinal, onGenerated }) {
  const [busy, setBusy] = useState('') // '' | 'advance' | 'losers_final'
  const [error, setError] = useState('')

  async function advance() {
    setBusy('advance')
    setError('')
    const { error } = await supabase.rpc('advance_bracket', { p_tournament_id: tournamentId })
    setBusy('')
    if (error) setError(error.message)
    else onGenerated()
  }

  async function losersFinal() {
    setBusy('losers_final')
    setError('')
    const { error } = await supabase.rpc('generate_losers_final', { p_tournament_id: tournamentId })
    setBusy('')
    if (error) setError(error.message)
    else onGenerated()
  }

  const showCard = canAdvance || (hasFinal && !hasLosersFinal)
  if (!showCard) return null

  return (
    <div className="card mt-6 space-y-3 p-5">
      <p className="label">Playoffs</p>
      <div className="flex flex-wrap gap-3">
        {canAdvance && (
          <button className="btn-primary" disabled={busy === 'advance'} onClick={advance}>
            {busy === 'advance' ? 'Advancing…' : '➡️ Advance to Next Round'}
          </button>
        )}
        {hasFinal && !hasLosersFinal && (
          <button className="btn-ghost" disabled={busy === 'losers_final'} onClick={losersFinal}>
            {busy === 'losers_final' ? 'Generating…' : 'Generate Losers Final (optional)'}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

const STAGE_LABEL = {
  final: '🏆 Final',
  losers_final: 'Losers Final',
}

function MatchCard({ match, index, onScored, queued = false }) {
  const teamA = match.match_players.filter((mp) => mp.team === 'A')
  const teamB = match.match_players.filter((mp) => mp.team === 'B')
  const isBye = teamB.length === 0
  const [scoreA, setScoreA] = useState(match.score_team_a ?? '')
  const [scoreB, setScoreB] = useState(match.score_team_b ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  const played = match.status === 'completed'
  const showForm = !isBye && !queued && (!played || editing)

  async function submit(e) {
    e.preventDefault()
    if (scoreA === '' || scoreB === '' || Number(scoreA) === Number(scoreB)) {
      setError('Enter two different scores.')
      return
    }
    setSubmitting(true)
    setError('')
    const { error } = await supabase.rpc('submit_match_result', {
      p_match_id: match.match_id,
      p_score_a: Number(scoreA),
      p_score_b: Number(scoreB),
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
    } else {
      setEditing(false)
      onScored()
    }
  }

  return (
    <div className={`card p-5 ${queued ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
          {STAGE_LABEL[match.stage] && match.stage !== 'bracket' && match.stage !== 'main'
            ? STAGE_LABEL[match.stage]
            : `Match ${index + 1}`}
        </p>
        {played && !editing && !isBye && !queued && (
          <button
            className="text-xs font-semibold text-court hover:underline"
            onClick={() => {
              setScoreA(match.score_team_a)
              setScoreB(match.score_team_b)
              setError('')
              setEditing(true)
            }}
          >
            Edit score
          </button>
        )}
      </div>

      {isBye ? (
        <div className="mt-3">
          <TeamLine names={teamA.map((p) => p.players.name)} won />
          <p className="mt-2 text-sm text-ink/40">Bye — advances automatically</p>
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <TeamLine names={teamA.map((p) => p.players.name)} won={match.winner === 'A'} />
            <span className="font-display text-sm text-ink/30">VS</span>
            <TeamLine names={teamB.map((p) => p.players.name)} won={match.winner === 'B'} align="right" />
          </div>

          {queued ? (
            <p className="mt-3 text-center text-sm text-ink/40">Waiting for a court to free up</p>
          ) : showForm ? (
            <form onSubmit={submit} className="mt-4 flex items-center justify-center gap-3">
              <input
                type="number"
                className="input w-20 text-center"
                value={scoreA}
                onChange={(e) => setScoreA(e.target.value)}
                placeholder="0"
              />
              <span className="text-ink/30">–</span>
              <input
                type="number"
                className="input w-20 text-center"
                value={scoreB}
                onChange={(e) => setScoreB(e.target.value)}
                placeholder="0"
              />
              <button type="submit" disabled={submitting} className="btn-primary shrink-0">
                {submitting ? '…' : editing ? 'Save' : 'Submit Result'}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn-ghost shrink-0"
                  onClick={() => { setEditing(false); setError('') }}
                >
                  Cancel
                </button>
              )}
            </form>
          ) : (
            <p className="mt-4 text-center font-display text-lg font-bold text-court">
              {match.score_team_a} — {match.score_team_b}
            </p>
          )}
        </>
      )}
      {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
    </div>
  )
}

function TeamLine({ names, won, align = 'left' }) {
  return (
    <div className={align === 'right' ? 'text-right' : 'text-left'}>
      <p className={`font-display font-semibold ${won ? 'text-court' : 'text-ink'}`}>
        {names.join(' + ')} {won && '🏆'}
      </p>
    </div>
  )
}
