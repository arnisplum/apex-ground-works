import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

type QuoteRow = {
  id: string;
  created_at: string;
  status: string;
  customer_name: string;
  customer_email: string;
  project_address: string;
  project_description: string;
  ai_summary: string | null;
};

type NoteRow = {
  id: string;
  body: string;
  created_at: string;
};

function parseHash(): { view: "queue" | "detail"; id: string | null } {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h.startsWith("quote/")) {
    const id = h.slice("quote/".length).trim();
    return { view: "detail", id: id || null };
  }
  return { view: "queue", id: null };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [staffOk, setStaffOk] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [route, setRoute] = useState(parseHash);

  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);

  const [detail, setDetail] = useState<QuoteRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [statusEdit, setStatusEdit] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      sub.data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      setStaffOk(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("id")
        .eq("id", session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setStaffOk(false);
        setErr(error.message);
        return;
      }
      setStaffOk(!!data);
      if (!data) setErr(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const loadQueue = useCallback(async () => {
    setQuotesLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("quote_requests")
      .select(
        "id, created_at, status, customer_name, customer_email, project_address, project_description, ai_summary",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    setQuotesLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setQuotes((data as QuoteRow[]) || []);
  }, []);

  useEffect(() => {
    if (staffOk !== true || route.view !== "queue") return;
    loadQueue();
  }, [staffOk, route.view, loadQueue]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setErr(null);
      const { data: q, error: qe } = await supabase
        .from("quote_requests")
        .select(
          "id, created_at, status, customer_name, customer_email, project_address, project_description, ai_summary",
        )
        .eq("id", id)
        .maybeSingle();
      if (qe) {
        setErr(qe.message);
        setDetailLoading(false);
        return;
      }
      if (!q) {
        setErr("Quote not found.");
        setDetail(null);
        setDetailLoading(false);
        return;
      }
      const row = q as QuoteRow;
      setDetail(row);
      setStatusEdit(row.status);

      const { data: n, error: ne } = await supabase
        .from("quote_notes")
        .select("id, body, created_at")
        .eq("quote_request_id", id)
        .order("created_at", { ascending: false });
      if (ne) setErr(ne.message);
      setNotes((n as NoteRow[]) || []);
      setDetailLoading(false);
    },
    [],
  );

  useEffect(() => {
    if (staffOk !== true || route.view !== "detail" || !route.id) return;
    loadDetail(route.id);
  }, [staffOk, route.view, route.id, loadDetail]);

  async function signInGoogle() {
    setErr(null);
    const redirect = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirect },
    });
    if (error) setErr(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.hash = "";
  }

  async function saveDetail() {
    if (!detail || !session?.user) return;
    setSaving(true);
    setErr(null);
    const { error } = await supabase
      .from("quote_requests")
      .update({ status: statusEdit })
      .eq("id", detail.id);
    if (error) setErr(error.message);
    else setDetail({ ...detail, status: statusEdit });
    setSaving(false);
  }

  async function addNote() {
    if (!detail || !session?.user || !noteBody.trim()) return;
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("quote_notes").insert({
      quote_request_id: detail.id,
      author_id: session.user.id,
      body: noteBody.trim(),
    });
    if (error) {
      setErr(error.message);
      setSaving(false);
      return;
    }
    setNoteBody("");
    await loadDetail(detail.id);
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="admin-shell">
        <main className="admin-main muted">Loading…</main>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="admin-shell">
        <header className="admin-header">
          <h1>Apex — Quote queue</h1>
          <button type="button" className="btn btn-primary" onClick={signInGoogle}>
            Sign in with Google
          </button>
        </header>
        <main className="admin-main card">
          <p className="eyebrow">Staff</p>
          <p className="muted">
            Sign in with the Google account that was invited in{" "}
            <code>staff_invites</code>. See docs/SUPABASE-SETUP.md.
          </p>
          {err ? <p className="err">{err}</p> : null}
        </main>
      </div>
    );
  }

  if (staffOk === false) {
    return (
      <div className="admin-shell">
        <header className="admin-header">
          <h1>Apex — Quote queue</h1>
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
        </header>
        <main className="admin-main card">
          <p className="eyebrow">Access</p>
          <p className="muted">
            No staff profile for this account. Ask an admin to add your email to{" "}
            <code>staff_invites</code>, then sign in again.
          </p>
          {err ? <p className="err">{err}</p> : null}
        </main>
      </div>
    );
  }

  if (staffOk !== true) {
    return (
      <div className="admin-shell">
        <main className="admin-main muted">Checking access…</main>
      </div>
    );
  }

  if (route.view === "detail" && route.id) {
    return (
      <div className="admin-shell">
        <header className="admin-header">
          <h1>Quote detail</h1>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                window.location.hash = "";
              }}
            >
              ← Queue
            </button>
            <button type="button" className="btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>
        <main className="admin-main stack">
          {detailLoading ? (
            <p className="muted">Loading…</p>
          ) : detail ? (
            <>
              <div className="card">
                <p className="eyebrow">Customer</p>
                <p>
                  <strong>{detail.customer_name}</strong> · {detail.customer_email}
                </p>
                <p className="muted">{detail.project_address}</p>
                <p style={{ marginTop: "1rem" }}>{detail.project_description}</p>
                <div className="field" style={{ marginTop: "1rem" }}>
                  <label htmlFor="st">Status</label>
                  <select
                    id="st"
                    className="input"
                    value={statusEdit}
                    onChange={(e) => setStatusEdit(e.target.value)}
                  >
                    {[
                      "draft",
                      "submitted",
                      "ai_processing",
                      "ai_ready",
                      "ai_failed",
                      "reviewed",
                      "closed",
                    ].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || statusEdit === detail.status}
                  onClick={saveDetail}
                >
                  Save status
                </button>
              </div>

              {detail.ai_summary ? (
                <div className="card">
                  <p className="eyebrow">AI summary</p>
                  <p style={{ whiteSpace: "pre-wrap" }}>{detail.ai_summary}</p>
                </div>
              ) : null}

              <div className="card">
                <p className="eyebrow">Internal notes</p>
                <div className="field">
                  <label htmlFor="nb">Add note</label>
                  <textarea
                    id="nb"
                    className="textarea"
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="Estimator note (visible to staff only)"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !noteBody.trim()}
                  onClick={addNote}
                >
                  Add note
                </button>
                <ul style={{ listStyle: "none", padding: 0, marginTop: "1rem" }}>
                  {notes.map((n) => (
                    <li
                      key={n.id}
                      style={{
                        padding: "0.75rem 0",
                        borderBottom: "1px solid var(--color-border)",
                      }}
                    >
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="muted">Not found.</p>
          )}
          {err ? <p className="err">{err}</p> : null}
        </main>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <h1>Quote queue</h1>
        <button type="button" className="btn" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main className="admin-main">
        <div className="card">
          <p className="eyebrow">Smart Quote</p>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Newest submissions first. Open a row to update status and add notes.
          </p>
          {quotesLoading ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Status</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Address</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.id}>
                      <td>{new Date(q.created_at).toLocaleString()}</td>
                      <td>{q.status}</td>
                      <td>{q.customer_name}</td>
                      <td>{q.customer_email}</td>
                      <td>{q.project_address}</td>
                      <td>
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            window.location.hash = `#/quote/${q.id}`;
                          }}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {err ? <p className="err">{err}</p> : null}
        </div>
      </main>
    </div>
  );
}
