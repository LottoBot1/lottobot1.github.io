// Testy przycisku „Pokaż / Ukryj hasło” (haslo.js) – bez przeglądarki, na prostych atrapach pola i przycisku.
// Uruchomienie: node --test tests/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../haslo.js');

// Atrapa pola <input> z zaznaczeniem tekstu i fokusem
function fakeInput(type = 'password', value = 'tajne123') {
  return {
    type, value, selectionStart: 3, selectionEnd: 5, focusCalls: 0,
    focus() { this.focusCalls++; doc.activeElement = this; },
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
  };
}
function fakeButton() {
  const attrs = {};
  return { attrs, innerHTML: '', setAttribute(k, v) { attrs[k] = v; } };
}
const doc = { activeElement: null };
function wrap(input, btn) {
  const w = { querySelector: s => (s === 'input' ? input : btn) };
  btn.closest = () => w;
  return w;
}

test('nextType i opis przycisku: ukryte ↔ widoczne', () => {
  assert.equal(H.nextType('password'), 'text');
  assert.equal(H.nextType('text'), 'password');
  assert.equal(H.labelFor('password'), 'Pokaż hasło');
  assert.equal(H.labelFor('text'), 'Ukryj hasło');
});

test('kliknięcie oka przełącza typ pola, aria-label i title razem ze stanem', () => {
  const input = fakeInput(), btn = fakeButton(); wrap(input, btn);
  assert.equal(H.toggle(btn, doc), 'text');
  assert.equal(input.type, 'text');
  assert.equal(btn.attrs['aria-label'], 'Ukryj hasło');
  assert.equal(btn.attrs.title, 'Ukryj hasło');
  assert.equal(btn.attrs['aria-pressed'], 'true');
  assert.equal(H.toggle(btn, doc), 'password');
  assert.equal(input.type, 'password');
  assert.equal(btn.attrs['aria-label'], 'Pokaż hasło');
  assert.equal(btn.attrs['aria-pressed'], 'false');
  assert.equal(input.value, 'tajne123', 'wartość pola bez zmian');
});

test('pole z fokusem: fokus i pozycja kursora zostają po przełączeniu', () => {
  const input = fakeInput(), btn = fakeButton(); wrap(input, btn);
  doc.activeElement = input;
  input.setSelectionRange(4, 4);
  input.type = 'password';
  H.toggle(btn, doc);
  assert.equal(input.focusCalls, 1);
  assert.equal(doc.activeElement, input);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [4, 4]);
});

test('pole bez fokusu: przełączenie nie przenosi fokusu', () => {
  const input = fakeInput(), btn = fakeButton(); wrap(input, btn);
  doc.activeElement = null;
  H.toggle(btn, doc);
  assert.equal(input.focusCalls, 0);
});

test('hideAll: widoczne hasła wracają do ukrytych', () => {
  const a = fakeInput('text'), ba = fakeButton(), b = fakeInput('password'), bb = fakeButton();
  const scope = { querySelectorAll: () => [wrap(a, ba), wrap(b, bb)] };
  H.hideAll(scope);
  assert.equal(a.type, 'password');
  assert.equal(ba.attrs['aria-label'], 'Pokaż hasło');
  assert.equal(b.type, 'password');
});

test('field: przycisk type="button" z opisem, pole z przekazanymi atrybutami (autocomplete bez zmian)', () => {
  const html = H.field('name="pw" autocomplete="current-password" required');
  assert.match(html, /<input class="input pw-input" type="password" name="pw" autocomplete="current-password" required>/);
  assert.match(html, /<button type="button" class="pw-toggle" aria-label="Pokaż hasło" title="Pokaż hasło" aria-pressed="false">/);
  assert.match(html, /<svg [^>]*aria-hidden="true"/, 'ikona jako SVG w kodzie');
  assert.ok(!/https?:\/\//.test(html.replace(/xmlns="[^"]*"/g, '')), 'bez zewnętrznych adresów');
});

test('app.js używa wspólnej funkcji dla wszystkich pól hasła i nie ma surowych pól type="password"', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const raw = app.match(/<input[^>]*type="password"/g) || [];
  assert.deepEqual(raw, ['<input class="input" type="password"'], 'tylko zapasowe pole, gdy brak haslo.js');
  assert.equal((app.match(/TH\.field\(/g) || []).length, 2, 'logowanie/nowe konto i nowe hasło');
  assert.ok(app.includes("autocomplete=\"${reg ? 'new-password' : 'current-password'}\""), 'autocomplete logowania');
  assert.ok(app.includes('autocomplete="new-password" placeholder="Nowe hasło'), 'autocomplete nowego hasła');
});

test('ukryte pole e-mail dla menedżerów haseł: wartość z konta, autocomplete="username", bez name', () => {
  const html = H.usernameField('jan@example.com');
  assert.match(html, /^<input class="pm-hidden" type="email" autocomplete="username" value="jan@example\.com" readonly tabindex="-1" aria-hidden="true">$/);
  assert.ok(!/\sname=/.test(html), 'bez name – formularz go nie wysyła');
  assert.match(H.usernameField('a"b<c>@x.pl'), /value="a&quot;b&lt;c&gt;@x\.pl"/, 'wartość zabezpieczona');
  assert.match(H.usernameField(null), /value=""/);
});

test('formularz „Ustaw nowe hasło” ma ukryte pole e-mail, a zmiana hasła używa tylko pola hasła', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const form = app.slice(app.indexOf('<form id="pwForm"'), app.indexOf('</form>', app.indexOf('<form id="pwForm"')));
  assert.ok(form.includes('TH.usernameField(u.email)'), 'e-mail zalogowanego konta');
  assert.ok(form.indexOf('usernameField') < form.indexOf('TH.field('), 'pole e-mail przed polem hasła');
  assert.ok(app.includes('await Cloud.updatePassword(f.pw.value)'), 'do bazy idzie tylko nowe hasło');
  const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
  const rule = (css.match(/\.pm-hidden \{[^}]*\}/) || [''])[0];
  assert.ok(rule.includes('opacity: 0') && rule.includes('position: absolute') && !rule.includes('display: none'), 'ukryte bez display:none');
});

test('haslo.js jest ładowany przed app.js i jest w pamięci offline', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.ok(html.indexOf('src="haslo.js"') > 0 && html.indexOf('src="haslo.js"') < html.indexOf('src="app.js"'));
  assert.ok(/SHELL = \[[^\]]*'haslo\.js'/.test(sw));
});
