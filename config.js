// Konfiguracja aplikacji.
// Klucz Supabase poniżej to klucz PUBLICZNY (anon / publishable) – może być jawny,
// bo dostęp do danych chronią reguły RLS w bazie (supabase/schema.sql).
// NIGDY nie wpisuj tu klucza "service_role" / "secret".
window.APP_CONFIG = {
  name: 'Typer49',
  // W okresie testów wszystkie funkcje Premium są darmowe. Po uruchomieniu płatności (Etap 6) → false.
  betaAllPremium: true,
  freeLimits: { pendingBets: 10, setsPerClick: 3 },
  // Poziomy planu od najniższego do najwyższego (nazwy jak w profiles.plan w bazie).
  // Drugi poziom Premium = dopisz np. 'premium_plus' na końcu i przypisz mu funkcje niżej.
  tiers: ['free', 'premium'],
  // Najniższy poziom, który ma daną funkcję. Funkcji spoza listy używa każdy.
  featureTiers: {
    trend: 'premium',          // metoda „Model trendu”
    longStats: 'premium',      // statystyki z 250 / 500 / wszystkich losowań
    heatModel: 'premium',      // mapa „Model”
    pairs: 'premium',          // najczęstsze pary
    manySets: 'premium',       // więcej zestawów na raz niż freeLimits.setsPerClick
    unlimitedBets: 'premium',  // więcej oczekujących zakładów niż freeLimits.pendingBets
    systems: 'premium',        // systemy skrócone
  },
  supabaseUrl: 'https://ydntwczvpzydwqqwhmof.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkbnR3Y3p2cHp5ZHdxcXdobW9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MjExNTQsImV4cCI6MjExMDQ5NzE1NH0.0IPGVzUu6XZUsUKc3ZKDoRcQBTfZRO2o7MQ5gHw9pSc',
};
