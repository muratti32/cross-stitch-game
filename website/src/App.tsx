import { Routes, Route } from 'react-router-dom'
import { Nav } from './components/Nav'
import { Footer } from './components/Footer'
import { HomePage } from './pages/HomePage'
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage'
import { TermsOfServicePage } from './pages/TermsOfServicePage'
import { AccountDeletionPage } from './pages/AccountDeletionPage'
import { SupportPage } from './pages/SupportPage'
import { SharePatternPage } from './pages/SharePatternPage'
import { ShareProfilePage } from './pages/ShareProfilePage'

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/"                  element={<HomePage />} />
        <Route path="/privacy-policy"    element={<PrivacyPolicyPage />} />
        <Route path="/terms-of-service"  element={<TermsOfServicePage />} />
        <Route path="/account-deletion"  element={<AccountDeletionPage />} />
        <Route path="/support"           element={<SupportPage />} />
        <Route path="/pattern/:id"       element={<SharePatternPage />} />
        <Route path="/profile/:username" element={<ShareProfilePage />} />
      </Routes>
      <Footer />
    </>
  )
}

