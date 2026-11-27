export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "metodo_no_permitido" });
  }

  const url = String(process.env.SUPABASE_URL || "").trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) return res.status(200).json({ enabled: false });

  // La anon key es pública por diseño; el acceso a los datos lo limita RLS.
  return res.status(200).json({ enabled: true, url, anonKey });
}
