// Konfiguracja aplikacji.
// Klucz Supabase poniżej to klucz PUBLICZNY (anon / publishable) – może być jawny,
// bo dostęp do danych chronią reguły RLS w bazie (supabase/schema.sql).
// NIGDY nie wpisuj tu klucza "service_role" / "secret".
window.APP_CONFIG = {
  name: 'Typer49',
  // W okresie testów wszystkie funkcje Premium są darmowe. Po uruchomieniu płatności (Etap 3) → false.
  betaAllPremium: true,
  freeLimits: { pendingBets: 10, setsPerClick: 3 },
  supabaseUrl: 'https://ydntwczvpzydwqqwhmof.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkbnR3Y3p2cHp5ZHdxcXdobW9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MjExNTQsImV4cCI6MjExMDQ5NzE1NH0.0IPGVzUu6XZUsUKc3ZKDoRcQBTfZRO2o7MQ5gHw9pSc',
};
