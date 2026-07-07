import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type ApplicationDetail } from "../api";

export default function CandidatePage() {
  const { id } = useParams();
  const appId = Number(id);
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [note, setNote] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => { api.getApplication(appId).then(setDetail); }, [appId]);
  useEffect(refresh, [refresh]);

  if (!detail) return <p>Loading…</p>;

  const decide = async (action: "shortlist" | "hold" | "reject") => {
    setError(null);
    try {
      await api.decide(appId, action, note || undefined);
      setNote("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  };

  const makeKit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.createKit(appId);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{detail.candidate_name}
        <span className="ml-3 text-sm font-normal text-gray-500">{detail.status}</span>
      </h1>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {detail.report && (
        <div className="rounded border p-3">
          <p className="mb-2"><span className="font-mono text-lg">{detail.report.overall}</span>
            <span className="ml-3 text-gray-600">{detail.report.rationale}</span></p>
          <table className="w-full text-sm">
            <tbody>
              {detail.report.results.map((r) => (
                <tr key={r.criterion_name} className="border-t">
                  <td className="py-1">{r.criterion_name}</td>
                  <td className="font-mono">
                    {r.met !== null ? (r.met ? "met" : "NOT met") : `${r.score}/5`}
                  </td>
                  <td className="text-gray-500">{r.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input className="grow rounded border p-2" placeholder="optional note"
               value={note} onChange={(e) => setNote(e.target.value)} />
        <button onClick={() => decide("shortlist")} className="rounded bg-green-600 px-3 py-2 text-white">Shortlist</button>
        <button onClick={() => decide("hold")} className="rounded bg-gray-500 px-3 py-2 text-white">Hold</button>
        <button onClick={() => decide("reject")} className="rounded bg-red-600 px-3 py-2 text-white">Reject</button>
      </div>
      {detail.decisions.length > 0 && (
        <ul className="text-sm text-gray-600">
          {detail.decisions.map((d, i) => (
            <li key={i}>• {d.action}{d.note ? ` — ${d.note}` : ""} ({d.created_at})</li>
          ))}
        </ul>
      )}

      <div className="rounded border p-3">
        <div className="mb-2 flex justify-between">
          <h2 className="font-medium">{showOriginal ? "Original resume" : "Redacted resume (what the AI scored)"}</h2>
          <button onClick={() => setShowOriginal(!showOriginal)} className="text-sm text-blue-700">
            {showOriginal ? "Show redacted" : "Show original"}
          </button>
        </div>
        <pre className="whitespace-pre-wrap text-sm">
          {showOriginal ? detail.raw_text : detail.redacted_text}
        </pre>
      </div>

      <div className="rounded border p-3">
        <div className="mb-2 flex justify-between">
          <h2 className="font-medium">Interview kit</h2>
          {!detail.kit && (
            <button onClick={makeKit} disabled={busy}
                    className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">
              {busy ? "Generating…" : "Generate kit"}
            </button>
          )}
        </div>
        {detail.kit?.questions.map((q, i) => (
          <div key={i} className="border-t py-2">
            <p>{i + 1}. {q.text}</p>
            <p className="text-sm text-gray-500">
              [{q.category}] listen for: {q.listen_for} — {q.criterion_name}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
