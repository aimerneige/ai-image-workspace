import { useRef } from 'react'
import { Languages, Monitor, Moon, Sun } from 'lucide-react'
import { IconButton, Menu } from '../ui'
import { GithubIcon } from '../GithubIcon'
import { locales, useI18n } from '../../i18n'
import { useTheme, type ThemeMode } from '../../theme/ThemeProvider'
import { useAuth } from '../../app/auth'

const REPO = 'https://github.com/aimerneige/ai-image-workspace'

/** Language, theme and GitHub controls shared by the app and auth pages. */
export function Toolbar() {
  const { t, locale, setLocale } = useI18n()
  const { mode, resolved, setMode } = useTheme()
  const { meta } = useAuth()
  const themeBtn = useRef<HTMLButtonElement>(null)

  const pick = (m: ThemeMode) => {
    const r = themeBtn.current?.getBoundingClientRect()
    setMode(m, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined)
  }
  const themeIcon = mode === 'system' ? <Monitor size={18} /> : resolved === 'dark' ? <Moon size={18} /> : <Sun size={18} />

  return (
    <div className="toolbar">
      <Menu
        trigger={
          <IconButton label={t('nav.language')} placement="bottom">
            <Languages size={18} />
          </IconButton>
        }
        items={locales.map((l) => ({ key: l.code, label: l.name, checked: l.code === locale, onSelect: () => setLocale(l.code) }))}
      />
      <Menu
        trigger={
          <IconButton ref={themeBtn} label={t('nav.theme')} placement="bottom">
            <span className="theme-icon" key={mode + resolved}>{themeIcon}</span>
          </IconButton>
        }
        items={[
          { key: 'light', label: t('nav.light'), icon: <Sun size={16} />, checked: mode === 'light', onSelect: () => pick('light') },
          { key: 'dark', label: t('nav.dark'), icon: <Moon size={16} />, checked: mode === 'dark', onSelect: () => pick('dark') },
          { key: 'system', label: t('nav.system'), icon: <Monitor size={16} />, checked: mode === 'system', onSelect: () => pick('system') },
        ]}
      />
      <a className="icon-btn icon-btn-md icon-btn-ghost github-link" href={meta?.repo_url || REPO} target="_blank" rel="noreferrer" aria-label={t('nav.github')} title={t('nav.github')}>
        <GithubIcon size={18} />
      </a>
    </div>
  )
}
