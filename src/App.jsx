import { Routes, Route, Navigate } from 'react-router-dom'
import Nav from './components/Nav'
import { useAuth } from './context/AuthContext'
import { useGroup } from './context/GroupContext'
import Home from './pages/Home'
import Leaderboard from './pages/Leaderboard'
import Tournament from './pages/Tournament'
import TournamentDetail from './pages/TournamentDetail'
import Groups from './pages/Groups'

function RequireGroup({ children }) {
  const { currentGroup, loading } = useGroup()
  if (loading) return <CenteredNote text="Loading your groups…" />
  if (!currentGroup) return <Navigate to="/groups" replace />
  return children
}

function CenteredNote({ text }) {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center text-ink/60">{text}</div>
  )
}

export default function App() {
  const { loading } = useAuth()

  if (loading) return <CenteredNote text="🏸 Warming up…" />

  return (
    <div className="min-h-screen bg-court-line">
      <Nav />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-6">
        <Routes>
          <Route path="/groups" element={<Groups />} />
          <Route
            path="/"
            element={
              <RequireGroup>
                <Home />
              </RequireGroup>
            }
          />
          <Route
            path="/leaderboard"
            element={
              <RequireGroup>
                <Leaderboard />
              </RequireGroup>
            }
          />
          <Route
            path="/tournament"
            element={
              <RequireGroup>
                <Tournament />
              </RequireGroup>
            }
          />
          <Route
            path="/tournament/:tournamentId"
            element={
              <RequireGroup>
                <TournamentDetail />
              </RequireGroup>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
