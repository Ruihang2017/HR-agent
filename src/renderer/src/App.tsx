import { HashRouter, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import SystemPage from './pages/SystemPage'
import JobsPage from './pages/JobsPage'
import JobDetailPage from './pages/JobDetailPage'
import CandidatePage from './pages/CandidatePage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/candidates/:id" element={<CandidatePage />} />
          <Route path="/system" element={<SystemPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
