import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './app/auth'
import { WorkspaceProvider } from './app/workspace'
import { AppShell } from './components/layout/AppShell'
import { ConfirmProvider, ToastProvider } from './components/ui'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme/ThemeProvider'
import { LoginPage, RegisterPage } from './pages/Auth'
import { WorkspacePage } from './pages/Workspace'
import { HistoryPage } from './pages/History'
import { AdminPage } from './pages/Admin'
import { AccountPage } from './pages/Account'

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <WorkspaceProvider>
                <BrowserRouter>
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                      <Route index element={<WorkspacePage />} />
                      <Route path="history" element={<HistoryPage />} />
                      <Route path="account" element={<AccountPage />} />
                      <Route path="admin/:tab?" element={<RequireAuth admin><AdminPage /></RequireAuth>} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </BrowserRouter>
              </WorkspaceProvider>
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
