import { Routes, Route } from 'react-router-dom'
import { Nav } from './components/Nav'
import { Footer } from './components/Footer'
import { HomePage } from './pages/HomePage'
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage'
import { AccountDeletionPage } from './pages/AccountDeletionPage'
import { SupportPage } from './pages/SupportPage'

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/"                 element={<HomePage />} />
        <Route path="/privacy-policy"   element={<PrivacyPolicyPage />} />
        <Route path="/account-deletion" element={<AccountDeletionPage />} />
        <Route path="/support"          element={<SupportPage />} />
      </Routes>
      <Footer />
    </>
  )
}
