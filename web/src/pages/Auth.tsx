import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { History, KeyRound, LogIn, Sparkles, UserPlus, UserRound, Lock } from 'lucide-react'
import { api } from '../api/client'
import { useAuth, FullPageSpinner } from '../app/auth'
import { Button, Field, Input, PasswordInput, useToast } from '../components/ui'
import { Toolbar } from '../components/layout/Toolbar'
import { Logo } from '../components/Logo'
import { useI18n } from '../i18n'
import { useErrorMessage } from '../lib/errors'

function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="auth">
      <div className="auth-top">
        <Toolbar />
      </div>
      <aside className="auth-hero">
        <div className="auth-orbs" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="auth-hero-inner">
          <div className="brand brand-lg">
            <Logo size={40} />
            <span className="brand-name">{t('app.name')}</span>
          </div>
          <p className="auth-tagline">{t('app.tagline')}</p>
          <ul className="auth-features">
            <li><KeyRound size={18} />{t('auth.featureKeys')}</li>
            <li><History size={18} />{t('auth.featureHistory')}</li>
            <li><Sparkles size={18} />{t('auth.featureModels')}</li>
          </ul>
        </div>
      </aside>
      <section className="auth-panel">{children}</section>
    </div>
  )
}

export function LoginPage() {
  const { t } = useI18n()
  const { user, ready, meta, setUser } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const errMsg = useErrorMessage()
  const toast = useToast()
  const navigate = useNavigate()
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from || '/'

  if (!ready) return <FullPageSpinner />
  if (user) return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api.login(username, password)
      setUser(r.user)
      toast.success(t('auth.welcome', { name: r.user.username }))
      navigate(from, { replace: true })
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1 className="auth-title">{t('auth.loginTitle')}</h1>
        <p className="auth-subtitle">{t('auth.loginSubtitle')}</p>
        <Field label={t('auth.username')} htmlFor="login-user">
          <Input id="login-user" icon={<UserRound size={16} />} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </Field>
        <Field label={t('auth.password')} htmlFor="login-pass">
          <PasswordInput id="login-pass" icon={<Lock size={16} />} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <div className="form-error" role="alert">{error}</div>}
        <Button type="submit" variant="gradient" size="lg" block loading={busy} disabled={!username || !password} icon={<LogIn size={18} />}>
          {t('auth.login')}
        </Button>
        <p className="auth-switch">
          {meta?.allow_registration ? (
            <>
              {t('auth.noAccount')} <Link to="/register">{t('auth.registerLink')}</Link>
            </>
          ) : (
            <span className="muted">{t('auth.registrationDisabled')}</span>
          )}
        </p>
      </form>
    </AuthLayout>
  )
}

export function RegisterPage() {
  const { t } = useI18n()
  const { user, ready, meta, setUser } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const errMsg = useErrorMessage()
  const toast = useToast()
  const navigate = useNavigate()

  if (!ready) return <FullPageSpinner />
  if (user) return <Navigate to="/" replace />
  if (meta && !meta.allow_registration) {
    return (
      <AuthLayout>
        <div className="auth-card">
          <h1 className="auth-title">{t('auth.registerTitle')}</h1>
          <p className="form-error">{t('auth.registrationDisabled')}</p>
          <Link to="/login" className="auth-back">
            <Button block icon={<LogIn size={16} />}>{t('auth.loginLink')}</Button>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  const userOk = /^[A-Za-z0-9_.-]{3,32}$/.test(username)
  const passOk = password.length >= 8
  const match = password === confirm

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!userOk || !passOk || !match) return
    setBusy(true)
    setError('')
    try {
      const r = await api.register(username, password)
      setUser(r.user)
      toast.success(t('auth.welcome', { name: r.user.username }))
      navigate('/', { replace: true })
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1 className="auth-title">{t('auth.registerTitle')}</h1>
        <p className="auth-subtitle">{t('auth.registerSubtitle')}</p>
        <Field label={t('auth.username')} htmlFor="reg-user" hint={t('auth.usernameHint')} error={touched && !userOk ? t('errors.invalid_username') : undefined}>
          <Input id="reg-user" icon={<UserRound size={16} />} autoComplete="username" value={username} invalid={touched && !userOk} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </Field>
        <Field label={t('auth.password')} htmlFor="reg-pass" hint={t('auth.passwordHint')} error={touched && !passOk ? t('errors.weak_password') : undefined}>
          <PasswordInput id="reg-pass" icon={<Lock size={16} />} autoComplete="new-password" value={password} invalid={touched && !passOk} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={t('auth.confirmPassword')} htmlFor="reg-confirm" error={touched && !match ? t('auth.passwordMismatch') : undefined}>
          <PasswordInput id="reg-confirm" icon={<Lock size={16} />} autoComplete="new-password" value={confirm} invalid={touched && !match} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <div className="form-error" role="alert">{error}</div>}
        <Button type="submit" variant="gradient" size="lg" block loading={busy} icon={<UserPlus size={18} />}>
          {t('auth.register')}
        </Button>
        <p className="auth-switch">
          {t('auth.haveAccount')} <Link to="/login">{t('auth.loginLink')}</Link>
        </p>
      </form>
    </AuthLayout>
  )
}
