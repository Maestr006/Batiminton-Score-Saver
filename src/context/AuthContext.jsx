import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (!error) setProfile(data)
    return data
  }, [])

  useEffect(() => {
    let mounted = true

    async function init() {
      const { data: { session } } = await supabase.auth.getSession()

      if (session?.user) {
        if (mounted) setUser(session.user)
        await loadProfile(session.user.id)
      } else {
        // Frictionless onboarding: sign the visitor in anonymously.
        // They can still set a display name that other members will see.
        const { data, error } = await supabase.auth.signInAnonymously()
        if (!error && mounted) {
          setUser(data.user)
          // small delay so the on_auth_user_created trigger has run
          setTimeout(() => loadProfile(data.user.id), 400)
        }
      }
      if (mounted) setLoading(false)
    }

    init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const updateDisplayName = useCallback(
    async (name) => {
      if (!user) return
      const { data, error } = await supabase
        .from('user_profiles')
        .update({ display_name: name })
        .eq('id', user.id)
        .select()
        .single()
      if (!error) setProfile(data)
      return { data, error }
    },
    [user]
  )

  return (
    <AuthContext.Provider value={{ user, profile, loading, updateDisplayName }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
