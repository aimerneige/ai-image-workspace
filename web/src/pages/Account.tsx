import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { api } from '../api/client'
import type { AuditEntry } from '../api/types'
import { useAuth } from '../app/auth'
import { Badge, Button, Card, EmptyState, Field, PasswordInput, Skeleton, useToast } from '../components/ui'
import { AuditTable, Pager } from './Admin'
import { useI18n } from '../i18n'
import { useErrorMessage } from '../lib/errors'

export function AccountPage() {
  const { t, formatDate } = useI18n()
  const { user } = useAuth()
  const toast = useToast()
  const errMsg = useErrorMessage()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [activity, setActivity] = useState<{ items: AuditEntry[]; total: number } | null>(null)

  useEffect(() => {
    api.myActivity(page).then(setActivity).catch(() => {})
  }, [page])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return setError(t('auth.passwordMismatch'))
    if (next.length < 8) return setError(t('errors.weak_password'))
    setBusy(true)
    setError('')
    try {
      await api.changePassword(current, next)
      toast.success(t('account.updated'))
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  if (!user) return null
  return (
    <div className="page account">
      <div className="account-hero">
        <span className="avatar avatar-xl">{user.username[0].toUpperCase()}</span>
        <div>
          <h1 className="page-title">{user.username}</h1>
          <p className="page-subtitle">
            <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{t(`admin.users.roles.${user.role}`)}</Badge>
            <span>{t('account.memberSince', { date: formatDate(user.created_at, { dateStyle: 'long' }) })}</span>
          </p>
        </div>
      </div>
      <div className="account-grid">
        <Card className="account-card">
          <h2 className="card-title"><KeyRound size={18} />{t('account.password')}</h2>
          <form className="form-stack" onSubmit={submit}>
            <Field label={t('account.current')} htmlFor="ac-cur">
              <PasswordInput id="ac-cur" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label={t('account.next')} hint={t('auth.passwordHint')} htmlFor="ac-new">
              <PasswordInput id="ac-new" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label={t('account.confirm')} htmlFor="ac-conf">
              <PasswordInput id="ac-conf" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
            {error && <div className="form-error">{error}</div>}
            <Button type="submit" variant="primary" loading={busy} disabled={!current || !next || !confirm}>{t('account.save')}</Button>
          </form>
        </Card>
        <div className="account-activity">
          <h2 className="card-title">{t('account.activity')}</h2>
          {!activity ? <Skeleton style={{ height: 240, borderRadius: 16 }} /> : activity.items.length === 0 ? (
            <EmptyState title={t('admin.audit.empty')} />
          ) : (
            <>
              <AuditTable items={activity.items} showUser={false} />
              <Pager page={page} total={activity.total} pageSize={20} onPage={setPage} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
