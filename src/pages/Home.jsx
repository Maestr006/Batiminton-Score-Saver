import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useGroup } from '../context/GroupContext'

const medals = ['🥇', '🥈', '🥉']

export default function Home() {
  const { currentGroup } = useGroup()
  const [top, setTop] = useState([])
  const [stats, setStats] = useState({ players: 0, matches: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentGroup) return
    let mounted = true

    async function load() {
      setLoading(true)
      const { data: topPlayers } = await supabase
        .from('player_stats')
        .select('*')
        .eq('group_id', currentGroup.group_id)
        .order('wins', { ascending: false })
        .limit(3)

      const { count: playerCount } = await supabase
        .from('players')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', currentGroup.group_id)

      const { data: matchStats } = await supabase
        .from('player_stats')
        .select('matches_played')
        .eq('group_id', currentGroup.group_id)

      if (!mounted) return
      setTop(topPlayers || [])
      const totalMatches = (matchStats || []).reduce((sum, r) => sum + r.matches_played, 0) / 2
      setStats({ players: playerCount || 0, matches: Math.round(totalMatches) })
      setLoading(false)
    }

    load()
    return () => { mounted = false }
  }, [currentGroup])

  return (
    <div className="py-6">
      <section className="card overflow-hidden bg-court text-court-line">
        <div className="bg-court-dark/40 bg-court-lines px-6 py-10 sm:px-10 sm:py-14">
          <p className="label text-court-line/60">{currentGroup.group_name} · {currentGroup.group_code}</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
            Track matches. Create tournaments.<br />Compete with your group.
          </h1>
          <Link to="/tournament" className="btn-accent mt-6 inline-flex">
            🎲 Start Tournament
          </Link>
        </div>
      </section>

      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        <div className="card p-5">
          <p className="label">Players</p>
          <p className="mt-1 font-display text-3xl font-bold text-court">{stats.players}</p>
        </div>
        <div className="card p-5">
          <p className="label">Matches Played</p>
          <p className="mt-1 font-display text-3xl font-bold text-court">{stats.matches}</p>
        </div>
        <div className="card p-5">
          <p className="label">Group Code</p>
          <p className="mt-1 font-display text-3xl font-bold text-court">{currentGroup.group_code}</p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="label mb-3">Top Players</h2>
        {loading ? (
          <p className="text-ink/50">Loading…</p>
        ) : top.length === 0 ? (
          <p className="card p-5 text-ink/50">No completed matches yet — start a tournament to build the leaderboard.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {top.map((p, i) => (
              <div key={p.player_id} className="card flex items-center gap-3 p-4">
                <span className="text-3xl">{medals[i]}</span>
                <div>
                  <p className="font-display font-semibold">{p.name}</p>
                  <p className="text-sm text-ink/50">{p.wins} wins · {p.win_pct}% win rate</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
