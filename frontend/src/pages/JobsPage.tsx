import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type JobSummary } from "../api";

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  useEffect(() => { api.listJobs().then(setJobs); }, []);
  return (
    <div>
      <div className="mb-4 flex justify-between">
        <h1 className="text-xl font-semibold">Jobs</h1>
        <Link to="/jobs/new" className="rounded bg-blue-600 px-3 py-1 text-white">New job</Link>
      </div>
      <ul className="divide-y rounded border">
        {jobs.map((j) => (
          <li key={j.id} className="flex justify-between p-3">
            <Link to={`/jobs/${j.id}`} className="text-blue-700">
              {j.title ?? "(untitled — intake in progress)"}
            </Link>
            <span className="text-sm text-gray-500">{j.status}</span>
          </li>
        ))}
        {jobs.length === 0 && <li className="p-3 text-gray-500">No jobs yet.</li>}
      </ul>
    </div>
  );
}
