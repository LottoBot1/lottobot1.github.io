/* Typer49 – przycisk „Pokaż / Ukryj hasło” przy polach hasła (logowanie, nowe konto, nowe hasło).
   Jedna wspólna funkcja field() buduje pole z przyciskiem oka; bind() obsługuje kliknięcia dla całej strony.
   - przycisk type="button" (nie wysyła formularza), aria-label i title zmieniają się razem ze stanem,
   - fokus i pozycja kursora zostają w polu (ważne na iPhonie),
   - hideAll() wraca do stanu ukrytego (po wysłaniu formularza; przełączenie zakładek i tak buduje pole od nowa).
   Atrybuty name i autocomplete pola przekazuje app.js bez zmian (menedżery haseł).
   Funkcje nextType / labelFor / apply / toggle są testowane w tests/haslo.test.js. */
(function (root) {
  'use strict';

  const SVG = 'viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const EYE = `<svg ${SVG}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF = `<svg ${SVG}><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 4.9-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;

  /** Kolejny typ pola po kliknięciu oka. */
  const nextType = type => (type === 'password' ? 'text' : 'password');
  /** Opis przycisku dla danego typu pola: hasło ukryte → „Pokaż hasło”, widoczne → „Ukryj hasło”. */
  const labelFor = type => (type === 'password' ? 'Pokaż hasło' : 'Ukryj hasło');

  function buttonHtml() {
    const l = labelFor('password');
    return `<button type="button" class="pw-toggle" aria-label="${l}" title="${l}" aria-pressed="false">${EYE}</button>`;
  }

  /** Pole hasła z przyciskiem oka. attrs = pozostałe atrybuty pola (name, autocomplete, placeholder…) – stały tekst z app.js. */
  function field(attrs) {
    return `<div class="pw-wrap"><input class="input pw-input" type="password" ${attrs}>${buttonHtml()}</div>`;
  }

  const escAttr = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Ukryte pole z e-mailem konta dla menedżerów haseł przy ustawianiu nowego hasła (autocomplete="username").
      Bez atrybutu name – formularz go nie wysyła; tylko do odczytu, niewidoczne i poza kolejnością klawisza Tab. */
  function usernameField(email) {
    return `<input class="pm-hidden" type="email" autocomplete="username" value="${escAttr(email)}" readonly tabindex="-1" aria-hidden="true">`;
  }

  /** Ustawia pole i przycisk w danym stanie ('password' = ukryte, 'text' = widoczne). */
  function apply(input, btn, type) {
    input.type = type;
    const l = labelFor(type);
    btn.setAttribute('aria-label', l);
    btn.setAttribute('title', l);
    btn.setAttribute('aria-pressed', String(type === 'text'));
    btn.innerHTML = type === 'text' ? EYE_OFF : EYE;
  }

  /** Kliknięcie oka: zmienia typ pola, a jeśli pole miało fokus – oddaje go i przywraca pozycję kursora. */
  function toggle(btn, doc) {
    const wrap = btn.closest ? btn.closest('.pw-wrap') : btn.parentNode;
    const input = wrap && wrap.querySelector('input');
    if (!input) return null;
    const focused = !!doc && doc.activeElement === input;
    let start = null, end = null;
    try { start = input.selectionStart; end = input.selectionEnd; } catch { /* starsze przeglądarki */ }
    const type = nextType(input.type);
    apply(input, btn, type);
    if (focused) {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
      if (start != null) { try { input.setSelectionRange(start, end); } catch { /* brak zaznaczenia */ } }
    }
    return type;
  }

  /** Wszystkie pola hasła w danym fragmencie strony wracają do stanu ukrytego. */
  function hideAll(scope) {
    scope.querySelectorAll('.pw-wrap').forEach(w => {
      const input = w.querySelector('input'), btn = w.querySelector('.pw-toggle');
      if (input && btn && input.type !== 'password') apply(input, btn, 'password');
    });
  }

  /** Obsługa kliknięć dla całej strony (raz, przy starcie aplikacji). */
  function bind(doc) {
    const hit = e => e.target && e.target.closest && e.target.closest('.pw-toggle');
    // mousedown bez domyślnej akcji = przycisk nie zabiera fokusu polu (także po stuknięciu na iPhonie i Androidzie)
    doc.addEventListener('mousedown', e => { if (hit(e)) e.preventDefault(); });
    doc.addEventListener('click', e => { const b = hit(e); if (b) { e.preventDefault(); toggle(b, doc); } });
  }

  const api = { nextType, labelFor, field, usernameField, apply, toggle, hideAll, bind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TyperHaslo = api;
})(typeof window !== 'undefined' ? window : globalThis);
