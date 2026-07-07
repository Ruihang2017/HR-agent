import { Link, Route, Routes } from "react-router-dom";
import JobsPage from "./pages/JobsPage";
import NewJobPage from "./pages/NewJobPage";
import JobDetailPage from "./pages/JobDetailPage";
import CandidatePage from "./pages/CandidatePage";

export default function App() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <Link to="/" className="text-2xl font-bold">Shortlist</Link>
        <span className="text-sm text-gray-500">AI hiring assistant — POC</span>
      </header>
      <Routes>
        <Route path="/" element={<JobsPage />} />
        <Route path="/jobs/new" element={<NewJobPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/applications/:id" element={<CandidatePage />} />
      </Routes>
    </div>
  );
}
