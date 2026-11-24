import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api, setUnauthorizedHandler } from '../api/client'
import type { Meta, User } from '../api/types'
import { Spinner } from '../components/ui'

interface AuthValue {
  user: User | null
  meta: Meta | null
  ready: boolean
  setUser: (u: User | null) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    Promise.allSettled([api.meta(), api.me()]).then(([m, me]) => {
      if (m.status === 'fulfilled') setMeta(m.value)
      if (me.status === 'fulfilled') setUser(me.value.user)
      setReady(true)
    })
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    setUser(null)
  }, [])

  return <AuthContext.Provider value={{ user, meta, ready, setUser, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

export function FullPageSpinner() {
  return (
    <div className="full-center">
      <Spinner size={28} />
    </div>
  )
}

export function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}
