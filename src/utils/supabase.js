// src/utils/supabase.js
// Lines 13–64 of App.jsx (extracted)

const SUPABASE_URL = "https://lxaaqtqvlwjvyuedyauo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YWFxdHF2bHdqdnl1ZWR5YXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDYzNTUsImV4cCI6MjA4NzM4MjM1NX0.UItPw2j2oo5F2_zJZmf43gmZnNHVQ5FViQgbd4QEii0";

export async function supabaseQuery(path, method = "GET", body = null, onConflict = null) {
  try {
    const isUpsert = method === "UPSERT";
    const sep = path.includes("?") ? "&" : "?";
    const url = (isUpsert && onConflict)
      ? `${SUPABASE_URL}/rest/v1${path}${sep}on_conflict=${onConflict}`
      : `${SUPABASE_URL}/rest/v1${path}`;

    const opts = {
      method: isUpsert ? "POST" : method,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": isUpsert
          ? "resolution=merge-duplicates,return=representation"
          : method === "POST" ? "return=representation" : "",
      },
    };

    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);

    if (!res.ok) {
      const errText = await res.text();

      // If UPSERT fails due to missing unique constraint (42P10), fall back to
      // plain INSERT with ignore-duplicates so the app keeps working until
      // the constraint is added in Supabase.
      if (isUpsert && onConflict && errText.includes("42P10")) {
        console.warn(
          `[supabase] UPSERT on_conflict="${onConflict}" failed — constraint missing. ` +
          `Falling back to INSERT (duplicates ignored). ` +
          `Fix: CREATE UNIQUE INDEX on ${path.split("?")[0]} (${onConflict}) WHERE ${onConflict} IS NOT NULL;`
        );
        const fallbackUrl = `${SUPABASE_URL}/rest/v1${path.split("?")[0]}`;
        const fallbackOpts = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            "Prefer": "resolution=ignore-duplicates,return=representation",
          },
          body: JSON.stringify(body),
        };
        const fallbackRes = await fetch(fallbackUrl, fallbackOpts);
        if (!fallbackRes.ok) {
          console.error("Supabase fallback error:", await fallbackRes.text());
          return null;
        }
        const fallbackText = await fallbackRes.text();
        return fallbackText ? JSON.parse(fallbackText) : [];
      }

      console.error("Supabase error:", errText);
      return null;
    }

    const text = await res.text();
    return text ? JSON.parse(text) : [];

  } catch (e) {
    console.error("Supabase:", e);
    return null;
  }
}
