import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { CheckEmailPage } from '@/pages/auth/CheckEmailPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ForgotPasswordSentPage } from '@/pages/auth/ForgotPasswordSentPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { SignInPage } from '@/pages/auth/SignInPage'
import { SignUpPage } from '@/pages/auth/SignUpPage'
import { CostsPage } from '@/pages/CostsPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { HomePage } from '@/pages/HomePage'
import { LogEntryPage } from '@/pages/LogEntryPage'
import { AddVehiclePage } from '@/pages/onboarding/AddVehiclePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { RequireAuth } from './RequireAuth'
import { RootRedirect } from './RootRedirect'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/sign-up/check-email" element={<CheckEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/forgot-password/sent" element={<ForgotPasswordSentPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/v/:vehicleId/home" element={<HomePage />} />
          <Route path="/v/:vehicleId/history" element={<HistoryPage />} />
          <Route path="/v/:vehicleId/costs" element={<CostsPage />} />
          <Route path="/v/:vehicleId/log-entry" element={<LogEntryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/onboarding/add-vehicle" element={<AddVehiclePage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
