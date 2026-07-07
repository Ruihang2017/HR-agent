import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type ApplicationRow, type JobDetail } from "../api";

export default function JobDetailPage() {
  const { id } = useParams();
  const jobId = Number(id);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [apps, setApps] = useState<ApplicationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getJob(jobId).then(setJob);
    api.listApplications(jobId).then(setApps);
  }, [jobId]);
  useEffect(refresh, [refresh]);

  const seedAndScreen = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.seed(jobId, 50);
      await api.screen(jobId);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  if (!job) return <p>Loading…</p>;
  const scored = apps.filter((a) => a.meets_all_must_haves !== false);
  const didNotMeet = apps.filter((a) => a.meets_all_must_haves === false);

  const Row = ({ a }: { a: ApplicationRow }) => (
    <li className="flex items-center justify-between p-3">
      <Link to={`/applications/${a.id}`} className="text-blue-700">{a.candidate_name}</Link>
      <div className="flex items-center gap-4 text-sm">
        {a.rationale && <span className="max-w-md truncate text-gray-500">{a.rationale}</span>}
        <span className="font-mono">{a.overall ?? "—"}</span>
        <span className="text-gray-400">{a.status}</span>
      </div>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">{job.title ?? "(untitled)"}</h1>
        <div className="flex gap-2">
          <button onClick={seedAndScreen} disabled={busy}
                  className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">
            {busy ? "Working…" : "Seed 50 + screen"}
          </button>
          <button onClick={refresh} className="rounded border px-3 py-1">Refresh</button>
        </div>
      </div>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {job.lint_results && !job.lint_results.implemented && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">
          Discrimination linter: stub (Phase 2) — no checks applied yet.
        </p>
      )}

      <details className="rounded border p-3">
        <summary className="cursor-pointer font-medium">Job description</summary>
        <pre className="mt-2 whitespace-pre-wrap text-sm">{job.jd_markdown}</pre>
      </details>

      <details className="rounded border p-3">
        <summary className="cursor-pointer font-medium">Scoring rubric</summary>
        <table className="mt-2 w-full text-sm">
          <thead><tr className="text-left text-gray-500">
            <th>Criterion</th><th>Type</th><th>Weight</th><th>Evidence guidance</th>
          </tr></thead>
          <tbody>
            {job.rubric?.map((c) => (
              <tr key={c.name} className="border-t">
                <td className="py-1">{c.name}</td><td>{c.type}</td>
                <td>{c.type === "weighted" ? c.weight : "pass/fail"}</td>
                <td className="text-gray-500">{c.evidence_guidance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div>
        <h2 className="mb-2 font-semibold">Ranked candidates ({scored.length})</h2>
        <ul className="divide-y rounded border">{scored.map((a) => <Row key={a.id} a={a} />)}</ul>
      </div>

      {didNotMeet.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold text-gray-600">
            Did not meet stated requirements ({didNotMeet.length}) — your call, never auto-rejected
          </h2>
          <ul className="divide-y rounded border">{didNotMeet.map((a) => <Row key={a.id} a={a} />)}</ul>
        </div>
      )}
    </div>
  );
}
