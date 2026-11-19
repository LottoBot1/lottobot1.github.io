// Typer49 – funkcja Supabase „powiadomienia” (Etap 4, krok 3).
// Wdrożenie: Supabase → Edge Functions → Deploy a new function → Via Editor → nazwa: powiadomienia,
// wklej ten plik, w ustawieniach funkcji WYŁĄCZ „Verify JWT” (funkcję chroni hasło z Vault, nie klucz).
// Sekrety (Edge Functions → Secrets): VAPID_PRIVATE_JWK = klucz prywatny VAPID (JSON).
// SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY ustawia Supabase sam – klucz service_role istnieje tylko tutaj.
//
// Polecenia przyjmuje wyłącznie od bazy: nagłówek x-typer-secret musi zgadzać się z hasłem
// 'typer_push_secret' w Vault (sprawdza to baza funkcją push_secret_ok).
//   {mode:'test', user_id}  – próbne powiadomienie na wszystkie urządzenia osoby (część A)
//   {mode:'draw'}           – powiadomienia po losowaniu (część B, jeszcze nie ma)
import { buildPushHTTPRequest } from "npm:@pushforge/builder@2.0.5";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID = Deno.env.get("VAPID_PRIVATE_JWK") ?? "";
const CONTACT = "mailto:typer49.kontakt@gmail.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sub = { endpoint: string; p256dh: string; auth: string; hide_details: boolean; user_id?: string };
type Payload = { title: string; body: string; url: string; tag: string };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Baza: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function secretOk(secret: string): Promise<boolean> {
  if (secret.length < 32) return false;
  const ok = await db("rpc/push_secret_ok", { method: "POST", body: JSON.stringify({ p_secret: secret }) });
  return ok === true;
}

// Wysyła do wszystkich adresów; martwe adresy (404/410 od dostawcy) usuwa z bazy.
async function sendAll(subs: Sub[], payloadFor: (s: Sub) => Payload) {
  const jwk = JSON.parse(VAPID);
  let sent = 0, removed = 0, failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < subs.length; i += 20) {
    await Promise.all(subs.slice(i, i + 20).map(async (s) => {
      try {
        const { endpoint, headers, body } = await buildPushHTTPRequest({
          privateJWK: jwk,
          subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          message: { payload: payloadFor(s), adminContact: CONTACT, options: { ttl: 6 * 3600, urgency: "normal" } },
        });
        const res = await fetch(endpoint, { method: "POST", headers, body });
        if (res.status === 404 || res.status === 410) {
          await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" });
          removed++;
        } else if (res.ok) {
          sent++;
        } else {
          failed++;
          if (errors.length < 5) errors.push(`${new URL(s.endpoint).host}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
      } catch (e) {
        failed++;
        if (errors.length < 5) errors.push(String((e as Error)?.message ?? e).slice(0, 200));
      }
    }));
  }
  return { sent, removed, failed, errors };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Tylko POST" }, 405);
    if (!(await secretOk(req.headers.get("x-typer-secret") ?? ""))) return json({ error: "Brak dostępu" }, 403);
    if (!VAPID) return json({ error: "Brak sekretu VAPID_PRIVATE_JWK" }, 500);
    const cmd = await req.json().catch(() => ({}));

    if (cmd.mode === "test") {
      if (!UUID.test(String(cmd.user_id))) return json({ error: "Zły user_id" }, 400);
      const subs: Sub[] = await db(`push_subscriptions?user_id=eq.${cmd.user_id}&select=endpoint,p256dh,auth,hide_details`);
      const r = await sendAll(subs, () => ({
        title: "Typer49",
        body: "Próbne powiadomienie – działa ✓",
        url: "./#bets",
        tag: "typer49-test",
      }));
      const region = Deno.env.get("SB_REGION") ?? "?";   // powinno być eu-central-1 (privacy.html, pkt 5)
      console.log("test", cmd.user_id, region, JSON.stringify(r));
      return json({ ...r, region });
    }
    return json({ error: "Nieznane polecenie" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
