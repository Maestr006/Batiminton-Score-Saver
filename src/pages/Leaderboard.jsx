import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useGroup } from '../context/GroupContext'

export default function Leaderboard() {
  const { currentGroup } = useGroup()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!currentGroup) return
    const { data, error } = await supabase
      .from('player_stats')
      .select('*')
      .eq('group_id', currentGroup.group_id)
      .order('wins', { ascending: false })
      .order('win_pct', { ascending: false })

    if (!error) setRows(data || [])
    setLoading(false)
  }, [currentGroup])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // Live updates: whenever a match result is written for this group's
  // players, the underlying view changes, so just re-query.
  useEffect(() => {
    if (!currentGroup) return
    const channel = supabase
      .channel(`leaderboard-${currentGroup.group_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, load)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [currentGroup, load])

  return (
    <div className="py-6">
      <h1 className="text-2xl font-bold">Leaderboard</h1>
      <p className="mt-1 text-sm text-ink/60">{currentGroup.group_name} · updates live as scores come in</p>

      <div className="card mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink/5 text-ink/60">
            <tr>
              <th className="px-4 py-3 font-display">Rank</th>
              <th className="px-4 py-3 font-display">Player</th>
              <th className="px-4 py-3 text-right font-display">Played</th>
              <th className="px-4 py-3 text-right font-display">Wins</th>
              <th className="px-4 py-3 text-right font-display">Losses</th>
              <th className="px-4 py-3 text-right font-display">Win %</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/40">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/40">No players yet.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.player_id} className="border-t border-ink/5">
                  <td className="px-4 py-3 font-display font-semibold text-ink/50">{i + 1}</td>
                  <td className="px-4 py-3 font-display font-semibold">{r.name}</td>
                  <td className="px-4 py-3 text-right">{r.matches_played}</td>
                  <td className="px-4 py-3 text-right text-court">{r.wins}</td>
                  <td className="px-4 py-3 text-right text-ink/60">{r.losses}</td>
                  <td className="px-4 py-3 text-right font-semibold">{r.win_pct}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
