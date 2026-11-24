import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { History, LayoutGrid, LogOut, Shield, UserRound } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Logo } from '../Logo'
import { Toolbar } from './Toolbar'
import { Menu } from '../ui'
import { useI18n } from '../../i18n'
import { useAuth } from '../../app/auth'
import { useWorkspace } from '../../app/workspace'

export function AppShell() {
  const { t, locale } = useI18n()
  const { pathname } = useLocation()
  const { user, logout } = useAuth()
  const { runningCount } = useWorkspace()
  const navigate = useNavigate()
  const nav = useRef<HTMLElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)

  const links = [
    { to: '/', label: t('nav.workspace'), icon: <LayoutGrid size={17} />, end: true },
    { to: '/history', label: t('nav.history'), icon: <History size={17} /> },
    ...(user?.role === 'admin' ? [{ to: '/admin', label: t('nav.admin'), icon: <Shield size={17} /> }] : []),
  ]

  // Slide a pill behind the active nav link.
  useLayoutEffect(() => {
    const update = () => {
      const el = nav.current?.querySelector<HTMLElement>('.nav-link.active')
      const next = el ? { left: el.offsetLeft, width: el.offsetWidth } : null
      setPill((prev) => (prev?.left === next?.left && prev?.width === next?.width ? prev : next))
    }
    update()
    const ro = new ResizeObserver(update)
    if (nav.current) ro.observe(nav.current)
    return () => ro.disconnect()
  }, [pathname, links.length, locale])

  return (
    <div className="app">
      <header className="app-header">
        <NavLink to="/" className="brand">
          <Logo size={30} />
          <span className="brand-name">{t('app.name')}</span>
        </NavLink>
        <nav ref={nav} className="nav">
          {pill && <span className="nav-pill" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} />}
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="nav-link">
              {l.icon}
              <span className="nav-label">{l.label}</span>
              {l.to === '/' && runningCount > 0 && <span className="nav-dot" aria-label={t('workspace.running', { n: runningCount })}>{runningCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="header-right">
          <Toolbar />
          <Menu
            trigger={
              <button type="button" className="avatar-btn" aria-label={t('nav.account')}>
                <span className="avatar">{user?.username.slice(0, 1).toUpperCase()}</span>
              </button>
            }
            header={
              <div className="menu-user">
                <span className="avatar avatar-lg">{user?.username.slice(0, 1).toUpperCase()}</span>
                <div>
                  <div className="menu-user-name">{user?.username}</div>
                  <div className="menu-user-role">{user?.role === 'admin' ? t('admin.users.roles.admin') : t('admin.users.roles.user')}</div>
                </div>
              </div>
            }
            items={[
              { key: 'account', label: t('nav.account'), icon: <UserRound size={16} />, onSelect: () => navigate('/account') },
              ...(user?.role === 'admin' ? [{ key: 'admin', label: t('nav.admin'), icon: <Shield size={16} />, onSelect: () => navigate('/admin') }] : []),
              { key: 'd', label: '', divider: true },
              {
                key: 'logout', label: t('nav.logout'), icon: <LogOut size={16} />, danger: true,
                onSelect: async () => {
                  await logout()
                  navigate('/login')
                },
              },
            ]}
          />
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
