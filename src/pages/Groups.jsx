import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGroup } from '../context/GroupContext'
import { useAuth } from '../context/AuthContext'

export default function Groups() {
  const { groups, currentGroup, selectGroup, createGroup, joinGroup } = useGroup()
  const { profile, updateDisplayName } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState('switch')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState(profile?.display_name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')
    const { error } = await createGroup(name.trim())
    setBusy(false)
    if (error) return setError(error.message)
    navigate('/')
  }

  async function handleJoin(e) {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setError('')
    const { error } = await joinGroup(code.trim())
    setBusy(false)
    if (error) return setError(error.message)
    navigate('/')
  }

  async function handleSaveName(e) {
    e.preventDefault()
    if (!displayName.trim()) return
    await updateDisplayName(displayName.trim())
  }

  return (
    <div className="mx-auto max-w-lg py-6">
      <h1 className="text-2xl font-bold">Groups</h1>
      <p className="mt-1 text-sm text-ink/60">
        Every group has completely separate players, tournaments, and stats.
      </p>

      <form onSubmit={handleSaveName} className="card mt-6 flex items-center gap-2 p-4">
        <div className="flex-1">
          <label className="label">Your display name</label>
          <input
            className="input mt-1"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Abhinav"
          />
        </div>
        <button type="submit" className="btn-ghost mt-5">Save</button>
      </form>

      {groups.length > 0 && (
        <div className="card mt-6 p-4">
          <h2 className="label mb-3">Your groups</h2>
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.group_id}>
                <button
                  onClick={() => {
                    selectGroup(g)
                    navigate('/')
                  }}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                    currentGroup?.group_id === g.group_id
                      ? 'border-court bg-court/5'
                      : 'border-ink/10 hover:border-court/40'
                  }`}
                >
                  <span className="font-display font-semibold">{g.group_name}</span>
                  <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-mono tracking-wider text-ink/60">
                    {g.group_code}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <button
          onClick={() => setMode('create')}
          className={mode === 'create' ? 'btn-primary flex-1' : 'btn-ghost flex-1'}
        >
          Create Group
        </button>
        <button
          onClick={() => setMode('join')}
          className={mode === 'join' ? 'btn-primary flex-1' : 'btn-ghost flex-1'}
        >
          Join Group
        </button>
      </div>

      {mode === 'create' && (
        <form onSubmit={handleCreate} className="card mt-4 space-y-3 p-4">
          <div>
            <label className="label">Group name</label>
            <input
              className="input mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Friday Badminton"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="btn-accent w-full">
            {busy ? 'Creating…' : 'Create Group'}
          </button>
        </form>
      )}

      {mode === 'join' && (
        <form onSubmit={handleJoin} className="card mt-4 space-y-3 p-4">
          <div>
            <label className="label">Group code</label>
            <input
              className="input mt-1 font-mono uppercase tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="btn-accent w-full">
            {busy ? 'Joining…' : 'Join Group'}
          </button>
        </form>
      )}
    </div>
  )
}
