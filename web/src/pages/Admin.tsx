import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Activity, CheckCircle2, KeyRound, Lock, Pencil, Plug, Plus, RefreshCw, Server, Trash2, UserPlus, Users, XCircle, Zap,
} from 'lucide-react'
import { api } from '../api/client'
import type { AdminProvider, AuditEntry, Overview, ProviderType, User } from '../api/types'
import { useAuth } from '../app/auth'
import { useWorkspace } from '../app/workspace'
import {
  Badge, Button, Dialog, EmptyState, Field, IconButton, Input, PasswordInput, Segmented, Select, Skeleton, Spinner, Switch, Tabs, TagInput,
  useConfirm, useToast,
} from '../components/ui'
import { ProviderIcon } from '../features/workspace/ModelPicker'
import { useI18n } from '../i18n'
import { useErrorMessage } from '../lib/errors'
import { modelLabel } from '../lib/models'

type Tab = 'providers' | 'users' | 'audit' | 'system'

export function AdminPage() {
  const { t } = useI18n()
  const { tab = 'providers' } = useParams()
  const navigate = useNavigate()
  const current = (['providers', 'users', 'audit', 'system'].includes(tab) ? tab : 'providers') as Tab
  return (
    <div className="page admin">
      <div className="page-head">
        <h1 className="page-title">{t('admin.title')}</h1>
      </div>
      <Tabs
        value={current}
        onChange={(v) => navigate(`/admin/${v}`)}
        tabs={[
          { value: 'providers', label: t('admin.tabs.providers'), icon: <Plug size={16} /> },
          { value: 'users', label: t('admin.tabs.users'), icon: <Users size={16} /> },
          { value: 'audit', label: t('admin.tabs.audit'), icon: <Activity size={16} /> },
          { value: 'system', label: t('admin.tabs.system'), icon: <Server size={16} /> },
        ]}
      />
      <div className="admin-body" key={current}>
        {current === 'providers' && <ProvidersTab />}
        {current === 'users' && <UsersTab />}
        {current === 'audit' && <AuditTab />}
        {current === 'system' && <SystemTab />}
      </div>
    </div>
  )
}

// ---- providers ------------------------------------------------------------

const DEFAULT_MODELS: Record<ProviderType, string[]> = {
  openai: ['gpt-image-2', 'chatgpt-image-latest', 'gpt-image-1.5', 'gpt-image-1-mini'],
  gemini: ['gemini-3-pro-image', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'],
}

function ProvidersTab() {
  const { t } = useI18n()
  const toast = useToast()
  const confirm = useConfirm()
  const errMsg = useErrorMessage()
  const { reloadProviders } = useWorkspace()
  const [items, setItems] = useState<AdminProvider[] | null>(null)
  const [editing, setEditing] = useState<AdminProvider | 'new' | null>(null)
  const [testing, setTesting] = useState<number | null>(null)

  const load = useCallback(() => {
    api.admin.providers().then((r) => setItems(r.items)).catch((e) => toast.error(errMsg(e)))
  }, [toast, errMsg])
  useEffect(load, [load])

  const changed = () => {
    load()
    reloadProviders()
  }

  const test = async (p: AdminProvider) => {
    setTesting(p.id)
    try {
      const r = await api.admin.testProvider(p.id)
      if (r.ok) toast.success(t('admin.providers.testOk', { ms: r.latency_ms }))
      else
        toast.error(
          r.hint === 'check_base_url' ? (
            <>
              {t('admin.providers.testFail', { error: r.error ?? '' })}
              <span className="toast-hint">{t('admin.providers.testHintBaseUrl')}</span>
            </>
          ) : (
            t('admin.providers.testFail', { error: r.error ?? '' })
          ),
        )
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setTesting(null)
    }
  }

  const toggle = async (p: AdminProvider, enabled: boolean) => {
    try {
      await api.admin.updateProvider(p.id, { enabled })
      changed()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const remove = async (p: AdminProvider) => {
    if (!(await confirm({ title: t('admin.providers.deleteTitle', { name: p.name }), body: t('admin.providers.deleteBody'), danger: true, confirmText: t('common.delete') }))) return
    try {
      await api.admin.deleteProvider(p.id)
      toast.success(t('admin.providers.deleted'))
      changed()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  if (!items) return <div className="provider-grid">{[0, 1].map((i) => <Skeleton key={i} style={{ height: 180, borderRadius: 18 }} />)}</div>

  return (
    <>
      <div className="section-bar">
        <span className="muted">{items.length > 0 && t('admin.providers.modelCount', { n: items.reduce((a, p) => a + p.models.length, 0) })}</span>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>{t('admin.providers.add')}</Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<Plug size={26} />} title={t('admin.providers.empty')} body={t('admin.providers.emptyBody')}
          action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>{t('admin.providers.add')}</Button>} />
      ) : (
        <div className="provider-grid">
          {items.map((p) => {
            const locked = p.source === 'config'
            return (
              <div key={p.id} className={`provider-card${p.enabled ? '' : ' is-disabled'}`}>
                <div className="provider-card-head">
                  <ProviderIcon type={p.type} size={36} />
                  <div className="provider-card-title">
                    <h3>{p.name}</h3>
                    <span className="muted small">{p.type === 'openai' ? t('admin.providers.typeOpenAI') : t('admin.providers.typeGemini')}</span>
                  </div>
                  <Switch checked={p.enabled} disabled={locked} onChange={(v) => toggle(p, v)} label={t('admin.providers.enabled')} />
                </div>
                <div className="provider-card-info">
                  <div className="info-line"><Server size={14} /><code>{p.base_url || (p.type === 'openai' ? 'api.openai.com/v1' : 'generativelanguage.googleapis.com')}</code></div>
                  <div className="info-line"><KeyRound size={14} />{p.has_key ? <code>{p.api_key_masked}</code> : <span className="danger-text">{t('admin.providers.noKey')}</span>}</div>
                </div>
                <div className="provider-models">
                  {p.models.map((m, i) => (
                    <span key={m} className={`tag${i === 0 ? ' is-primary' : ''}`} title={m}>{modelLabel(m) ?? m}</span>
                  ))}
                </div>
                <div className="provider-card-foot">
                  {locked ? (
                    <Badge tone="info"><Lock size={12} /> {t('admin.providers.fromConfig')}</Badge>
                  ) : <span />}
                  <div className="row-actions">
                    <Button size="sm" variant="ghost" icon={testing === p.id ? <Spinner size={14} /> : <Zap size={14} />} disabled={testing === p.id} onClick={() => test(p)}>
                      {t('admin.providers.test')}
                    </Button>
                    {!locked && (
                      <>
                        <IconButton size="sm" label={t('common.edit')} onClick={() => setEditing(p)}><Pencil size={15} /></IconButton>
                        <IconButton size="sm" variant="danger" label={t('common.delete')} onClick={() => remove(p)}><Trash2 size={15} /></IconButton>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ProviderDialog value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed() }} />
    </>
  )
}

function ProviderDialog({ value, onClose, onSaved }: { value: AdminProvider | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const errMsg = useErrorMessage()
  const isNew = value === 'new'
  const [type, setType] = useState<ProviderType>('openai')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!value) return
    setError('')
    setApiKey('')
    if (value === 'new') {
      setType('openai')
      setName('OpenAI')
      setBaseUrl('')
      setModels(DEFAULT_MODELS.openai)
    } else {
      setType(value.type)
      setName(value.name)
      setBaseUrl(value.base_url)
      setModels(value.models)
    }
  }, [value])

  const switchType = (v: ProviderType) => {
    setType(v)
    if (isNew) {
      setModels(DEFAULT_MODELS[v])
      if (!name || name === 'OpenAI' || name === 'Google Gemini') setName(v === 'openai' ? 'OpenAI' : 'Google Gemini')
    }
  }

  const save = async () => {
    if (!name.trim()) return setError(t('errors.invalid_provider'))
    setBusy(true)
    setError('')
    try {
      const body = { name: name.trim(), type, base_url: baseUrl.trim(), models, ...(apiKey ? { api_key: apiKey } : {}) }
      if (isNew) await api.admin.createProvider(body)
      else if (value) await api.admin.updateProvider(value.id, body)
      toast.success(t('admin.providers.saved'))
      onSaved()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={!!value}
      onClose={onClose}
      title={isNew ? t('admin.providers.add') : t('admin.providers.edit')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={save}>{isNew ? t('common.create') : t('common.save')}</Button>
        </>
      }
    >
      <div className="form-stack">
        <Field label={t('admin.providers.type')}>
          <Segmented block value={type} onChange={switchType} options={[
            { value: 'openai', label: <span className="seg-provider"><ProviderIcon type="openai" size={16} />{t('admin.providers.typeOpenAI')}</span> },
            { value: 'gemini', label: <span className="seg-provider"><ProviderIcon type="gemini" size={16} />{t('admin.providers.typeGemini')}</span> },
          ]} />
        </Field>
        <Field label={t('admin.providers.name')} htmlFor="pv-name">
          <Input id="pv-name" value={name} placeholder={t('admin.providers.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('admin.providers.baseUrl')} htmlFor="pv-url" aside={t('common.optional')}
          hint={type === 'openai' ? t('admin.providers.baseUrlHintOpenAI') : t('admin.providers.baseUrlHintGemini')}>
          <Input id="pv-url" value={baseUrl} placeholder={type === 'openai' ? 'https://api.openai.com/v1' : 'https://generativelanguage.googleapis.com'} onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
        <Field label={t('admin.providers.apiKey')} htmlFor="pv-key"
          hint={!isNew && value && value.has_key ? `${t('admin.providers.apiKeyStored')} · ${value.api_key_masked} · ${t('admin.providers.apiKeyKeep')}` : t('admin.providers.apiKeyStored')}>
          <PasswordInput id="pv-key" icon={<KeyRound size={16} />} value={apiKey} autoComplete="off" placeholder={type === 'openai' ? 'sk-…' : 'AIza…'} onChange={(e) => setApiKey(e.target.value)} />
        </Field>
        <Field label={t('admin.providers.models')} hint={t('admin.providers.modelsHint')}>
          <TagInput value={models} onChange={setModels} placeholder={t('admin.providers.modelPlaceholder')} suggestions={DEFAULT_MODELS[type]} suggestionsLabel={t('admin.providers.suggestions')} />
        </Field>
        {error && <div className="form-error">{error}</div>}
      </div>
    </Dialog>
  )
}

// ---- users ----------------------------------------------------------------

function UsersTab() {
  const { t, formatDate, formatRelative } = useI18n()
  const { user: me } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const errMsg = useErrorMessage()
  const [items, setItems] = useState<User[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<User | null>(null)

  const load = useCallback(() => {
    api.admin.users().then((r) => setItems(r.items)).catch((e) => toast.error(errMsg(e)))
  }, [toast, errMsg])
  useEffect(load, [load])

  const update = async (u: User, body: { role?: string; disabled?: boolean }) => {
    try {
      await api.admin.updateUser(u.id, body)
      toast.success(t('admin.users.saved'))
      load()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const remove = async (u: User) => {
    if (!(await confirm({ title: t('admin.users.deleteTitle', { name: u.username }), body: t('admin.users.deleteBody'), danger: true, confirmText: t('common.delete') }))) return
    try {
      await api.admin.deleteUser(u.id)
      toast.success(t('admin.users.deleted'))
      load()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  if (!items) return <Skeleton style={{ height: 240, borderRadius: 16 }} />

  return (
    <>
      <div className="section-bar">
        <span className="muted">{t('admin.system.users')} · {items.length}</span>
        <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setCreating(true)}>{t('admin.users.add')}</Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('admin.users.username')}</th>
              <th>{t('admin.users.role')}</th>
              <th>{t('admin.users.status')}</th>
              <th className="num">{t('admin.users.generations')}</th>
              <th>{t('admin.users.lastLogin')}</th>
              <th>{t('admin.users.created')}</th>
              <th className="actions-col"><span className="sr-only">{t('admin.users.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => {
              const self = u.id === me?.id
              return (
                <tr key={u.id} className={u.disabled ? 'is-muted' : ''}>
                  <td>
                    <span className="user-cell">
                      <span className="avatar avatar-sm">{u.username[0].toUpperCase()}</span>
                      {u.username}
                      {self && <Badge tone="accent">{t('admin.users.you')}</Badge>}
                    </span>
                  </td>
                  <td>
                    <Select size="sm" value={u.role} disabled={self} onChange={(v) => update(u, { role: v })}
                      options={[{ value: 'admin', label: t('admin.users.roles.admin') }, { value: 'user', label: t('admin.users.roles.user') }]} />
                  </td>
                  <td>
                    <span className="status-cell">
                      <Switch size="sm" checked={!u.disabled} disabled={self} onChange={(v) => update(u, { disabled: !v })} label={t('admin.users.status')} />
                      <span className={u.disabled ? 'danger-text' : 'success-text'}>{u.disabled ? t('admin.users.disabled') : t('admin.users.active')}</span>
                    </span>
                  </td>
                  <td className="num">{u.generations ?? 0}</td>
                  <td title={u.last_login_at ? formatDate(u.last_login_at) : undefined}>{u.last_login_at ? formatRelative(u.last_login_at) : <span className="muted">{t('admin.users.never')}</span>}</td>
                  <td>{formatDate(u.created_at, { dateStyle: 'medium' })}</td>
                  <td className="actions-col">
                    <div className="row-actions">
                      <IconButton size="sm" label={t('admin.users.resetPassword')} onClick={() => setResetting(u)}><KeyRound size={15} /></IconButton>
                      {!self && <IconButton size="sm" variant="danger" label={t('common.delete')} onClick={() => remove(u)}><Trash2 size={15} /></IconButton>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load() }} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </>
  )
}

function CreateUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const errMsg = useErrorMessage()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setUsername('')
      setPassword('')
      setRole('user')
      setError('')
    }
  }, [open])
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api.admin.createUser({ username, password, role })
      toast.success(t('admin.users.createdToast'))
      onCreated()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title={t('admin.users.add')} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!username || !password} onClick={save}>{t('common.create')}</Button></>}>
      <div className="form-stack">
        <Field label={t('admin.users.username')} hint={t('auth.usernameHint')} htmlFor="nu-name">
          <Input id="nu-name" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t('admin.users.password')} hint={t('auth.passwordHint')} htmlFor="nu-pass">
          <PasswordInput id="nu-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label={t('admin.users.role')}>
          <Segmented block value={role} onChange={setRole} options={[{ value: 'user', label: t('admin.users.roles.user') }, { value: 'admin', label: t('admin.users.roles.admin') }]} />
        </Field>
        {error && <div className="form-error">{error}</div>}
      </div>
    </Dialog>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const errMsg = useErrorMessage()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setPassword('')
    setError('')
  }, [user])
  const save = async () => {
    if (!user) return
    setBusy(true)
    try {
      await api.admin.resetPassword(user.id, password)
      toast.success(t('admin.users.passwordReset'))
      onClose()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!user} onClose={onClose} title={user ? t('admin.users.resetTitle', { name: user.username }) : ''} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={password.length < 8} onClick={save}>{t('common.save')}</Button></>}>
      <Field label={t('admin.users.newPassword')} hint={t('auth.passwordHint')} error={error || undefined} htmlFor="rp-pass">
        <PasswordInput id="rp-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
    </Dialog>
  )
}

// ---- audit ----------------------------------------------------------------

const ACTION_PREFIXES = ['auth', 'account', 'generation', 'provider', 'user']

export function AuditTable({ items, showUser = true }: { items: AuditEntry[]; showUser?: boolean }) {
  const { t, tx, formatDate } = useI18n()
  return (
    <div className="table-wrap">
      <table className="table audit-table">
        <thead>
          <tr>
            <th>{t('admin.audit.time')}</th>
            {showUser && <th>{t('admin.audit.user')}</th>}
            <th>{t('admin.audit.action')}</th>
            <th>{t('admin.audit.target')}</th>
            <th>{t('admin.audit.ip')}</th>
            <th>{t('admin.audit.detail')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td className="nowrap">{formatDate(a.created_at, { dateStyle: 'short', timeStyle: 'medium' })}</td>
              {showUser && <td>{a.username || '—'}</td>}
              <td>
                <Badge tone={a.action.includes('failed') || a.action.includes('rejected') ? 'danger' : a.action.startsWith('generation') ? 'accent' : 'neutral'}>
                  {tx(`actions.${a.action}`, a.action)}
                </Badge>
              </td>
              <td className="mono truncate-cell" title={a.target}>{a.target || '—'}</td>
              <td className="mono nowrap">{a.ip}</td>
              <td className="mono detail-cell" title={a.detail ? JSON.stringify(a.detail) : ''}>
                {a.detail ? Object.entries(a.detail).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('  ') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const { t } = useI18n()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="pager">
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('common.prev')}</Button>
      <span className="muted small">{t('common.page', { page, total: pages })}</span>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('common.next')}</Button>
    </div>
  )
}

function AuditTab() {
  const { t } = useI18n()
  const toast = useToast()
  const errMsg = useErrorMessage()
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: AuditEntry[]; total: number } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.admin.audit({ page, page_size: 50, action }).then(setData).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false))
  }, [page, action, toast, errMsg])
  useEffect(load, [load])

  return (
    <>
      <div className="section-bar">
        <Select className="filter-select" value={action} onChange={(v) => { setAction(v); setPage(1) }}
          options={[{ value: '', label: t('admin.audit.all') }, ...ACTION_PREFIXES.map((p) => ({ value: p, label: p }))]} />
        <Button variant="ghost" icon={loading ? <Spinner size={14} /> : <RefreshCw size={15} />} onClick={load}>{t('common.refresh')}</Button>
      </div>
      {!data ? <Skeleton style={{ height: 300, borderRadius: 16 }} /> : data.items.length === 0 ? (
        <EmptyState icon={<Activity size={26} />} title={t('admin.audit.empty')} />
      ) : (
        <>
          <AuditTable items={data.items} />
          <Pager page={page} total={data.total} pageSize={50} onPage={setPage} />
        </>
      )}
    </>
  )
}

// ---- system ---------------------------------------------------------------

function SystemTab() {
  const { t } = useI18n()
  const [o, setO] = useState<Overview | null>(null)
  useEffect(() => {
    api.admin.overview().then(setO).catch(() => {})
  }, [])
  if (!o) return <Skeleton style={{ height: 200, borderRadius: 16 }} />
  const rows: [string, React.ReactNode][] = [
    [t('admin.system.version'), <code key="v">{o.version}</code>],
    [t('admin.system.database'), <Badge key="d" tone="info">{o.database}</Badge>],
    [t('admin.system.registration'), (
      <span key="r" className="status-cell">
        {o.allow_registration ? <CheckCircle2 size={16} className="success-text" /> : <XCircle size={16} className="danger-text" />}
        {o.allow_registration ? t('common.enabled') : t('common.disabled')}
        <span className="muted small">{t('admin.system.registrationHint')}</span>
      </span>
    )],
    [t('admin.system.users'), o.users],
    [t('admin.system.timeout'), o.generation_timeout],
    [t('admin.system.concurrent'), o.max_concurrent],
    [t('admin.system.maxUpload'), `${o.max_upload_mb} MB`],
  ]
  return (
    <div className="card system-card">
      <dl className="kv kv-wide">
        {rows.map(([k, v]) => (
          <div key={k} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </div>
  )
}
