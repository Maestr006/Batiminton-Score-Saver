import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'

const GroupContext = createContext(null)
const LAST_GROUP_KEY = 'badminton:lastGroupId'

export function GroupProvider({ children }) {
  const { user } = useAuth()
  const [groups, setGroups] = useState([])
  const [currentGroup, setCurrentGroup] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshGroups = useCallback(async () => {
    if (!user) return []
    setLoading(true)
    // group_members -> groups, restricted by RLS to the caller's own rows
    const { data, error } = await supabase
      .from('group_members')
      .select('role, joined_at, groups(*)')
      .order('joined_at', { ascending: true })

    if (error) {
      console.error('Failed to load groups', error)
      setLoading(false)
      return []
    }

    const list = (data || []).map((row) => ({ ...row.groups, role: row.role }))
    setGroups(list)
    setLoading(false)
    return list
  }, [user])

  useEffect(() => {
    if (!user) return
    refreshGroups().then((list) => {
      const savedId = localStorage.getItem(LAST_GROUP_KEY)
      const match = list.find((g) => g.group_id === savedId)
      setCurrentGroup(match || list[0] || null)
    })
  }, [user, refreshGroups])

  const selectGroup = useCallback((group) => {
    setCurrentGroup(group)
    if (group) localStorage.setItem(LAST_GROUP_KEY, group.group_id)
  }, [])

  const createGroup = useCallback(
    async (name) => {
      const { data, error } = await supabase.rpc('create_group', { p_name: name })
      if (error) return { error }
      const list = await refreshGroups()
      const created = list.find((g) => g.group_id === data.group_id) || data
      selectGroup(created)
      return { data: created }
    },
    [refreshGroups, selectGroup]
  )

  const joinGroup = useCallback(
    async (code) => {
      const { data, error } = await supabase.rpc('join_group_by_code', { p_code: code })
      if (error) return { error }
      const list = await refreshGroups()
      const joined = list.find((g) => g.group_id === data.group_id) || data
      selectGroup(joined)
      return { data: joined }
    },
    [refreshGroups, selectGroup]
  )

  return (
    <GroupContext.Provider
      value={{ groups, currentGroup, loading, selectGroup, createGroup, joinGroup, refreshGroups }}
    >
      {children}
    </GroupContext.Provider>
  )
}

export function useGroup() {
  const ctx = useContext(GroupContext)
  if (!ctx) throw new Error('useGroup must be used within GroupProvider')
  return ctx
}
