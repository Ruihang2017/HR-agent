import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type IntakeDecision } from "../api";

export default function NewJobPage() {
  const nav = useNavigate();
  const [description, setDescription] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [decision, setDecision] = useState<IntakeDecision | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    const r = await api.createJob(description);
    setJobId(r.job_id);
    setDecision(r.decision);
    setBusy(false);
    if (r.decision.action === "finalize") nav(`/jobs/${r.job_id}`);
  };

  const reply = async () => {
    if (jobId === null) return;
    setBusy(true);
    const r = await api.answerIntake(jobId, answer);
    setDecision(r.decision);
    setAnswer("");
    setBusy(false);
    if (r.decision.action === "finalize") nav(`/jobs/${jobId}`);
  };

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Describe the role</h1>
      {jobId === null ? (
        <>
          <textarea
            className="w-full rounded border p-2"
            rows={4}
            placeholder="e.g. I need a part-time barista, weekends, must be able to open the shop alone"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button onClick={start} disabled={busy || !description.trim()}
                  className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            {busy ? "Thinking…" : "Start"}
          </button>
        </>
      ) : (
        decision?.action === "ask" && (
          <div className="space-y-3 rounded border p-4">
            <p className="font-medium">{decision.question}</p>
            <input className="w-full rounded border p-2" value={answer}
                   onChange={(e) => setAnswer(e.target.value)} />
            <button onClick={reply} disabled={busy || !answer.trim()}
                    className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
              {busy ? "Thinking…" : "Answer"}
            </button>
          </div>
        )
      )}
    </div>
  );
}
