import { NavLink } from 'react-router-dom'
import { useGroup } from '../context/GroupContext'

const linkClass = ({ isActive }) =>
  `px-3 py-2 rounded-full text-sm font-display font-semibold transition ${
    isActive ? 'bg-court text-court-line' : 'text-ink/70 hover:bg-ink/5'
  }`

export default function Nav() {
  const { currentGroup } = useGroup()

  return (
    <header className="sticky top-0 z-20 border-b border-ink/10 bg-court-line/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <NavLink to="/" className="flex items-center gap-2 font-display text-lg font-bold text-court">
            <span className="text-2xl">🏸</span> Badminton
          </NavLink>
          <nav className="hidden items-center gap-1 sm:flex">
            <NavLink to="/" end className={linkClass}>Home</NavLink>
            <NavLink to="/leaderboard" className={linkClass}>Leaderboard</NavLink>
            <NavLink to="/tournament" className={linkClass}>Tournament</NavLink>
          </nav>
        </div>

        <NavLink
          to="/groups"
          className="flex flex-col items-end rounded-xl border border-ink/10 bg-white px-3 py-1.5 leading-tight hover:border-court/40"
        >
          <span className="label">Current Group</span>
          {currentGroup ? (
            <span className="font-display text-sm font-semibold text-ink">
              {currentGroup.group_name} · {currentGroup.group_code}
            </span>
          ) : (
            <span className="font-display text-sm font-semibold text-cork-dark">Select a group</span>
          )}
        </NavLink>
      </div>
      <nav className="flex items-center gap-1 border-t border-ink/5 px-4 py-1.5 sm:hidden">
        <NavLink to="/" end className={linkClass}>Home</NavLink>
        <NavLink to="/leaderboard" className={linkClass}>Leaderboard</NavLink>
        <NavLink to="/tournament" className={linkClass}>Tournament</NavLink>
      </nav>
    </header>
  )
}
