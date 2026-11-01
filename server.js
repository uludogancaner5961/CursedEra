// Cursed Era online sunucusu: odalar, eşleştirme ve hasar doğrulama
const express = require('express'), http = require('http'), path = require('path');
const { Server } = require('socket.io');
const app = express(), srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: '*' } });

// DÜZELTME: Dosyaların doğrudan ana dizinde okunabilmesi için yol güncellendi
app.use(express.static(path.join(__dirname)));

// Taban can degerleri; HP_MULT istemcideki (index.html) 1.6 carpaniyla AYNI olmali
const HP_MULT = 1.6;
const HP_BASE = { gojo: 180, sukuna: 210, yuta: 175, yuji: 200, higuruma: 190, toji: 190, hakari: 200, kashimo: 185, kenjaku: 175 };
const HP = Object.fromEntries(Object.entries(HP_BASE).map(([k, x]) => [k, Math.round(x * HP_MULT)]));
const BLK_WIN = 750, BLK_CD = 5000, GUARD_MS = 2500;   // blok penceresi / bekleme / basarili blok sonrasi hasar azaltma
const MAXCE = { gojo: 160, sukuna: 140, yuta: 190, yuji: 110, higuruma: 150, toji: 100, hakari: 170, kashimo: 150, kenjaku: 180 };
const DOM_CH = { gojo: 1, sukuna: 1, yuta: 1, yuji: 1, higuruma: 1, hakari: 1, kashimo: 1, kenjaku: 1 };   // Toji'nin alani yok
const C2 = { gojo: 25, sukuna: 25, yuta: 45, yuji: 35, higuruma: 40, toji: 30, hakari: 40, kashimo: 55, kenjaku: 50 };
const SIGN_MS = 2000;                                    // alan acma el hareketi suresi
// Ulti: Gojo Q (Hollow Purple), Sukuna Q (Dismantle), Yuta R (Rika), Yuji R (Double Black Flash)
// Istemci olay adlari: 's' = Q yetenegi, 'b' = R yetenegi, 'd' = alan, 'heal' = iyilesme, 'p' = yumruk
const ULT = { gojo: 's', sukuna: 's', yuta: 'b', yuji: 'b', higuruma: 'b', toji: 'b', hakari: 'b', kashimo: 'b', kenjaku: 'b' };
const ULT_CD = 7500, SLACK = 150;                       // ulti bekleme suresi 7.5 sn (+ ag gecikmesi payi)
const CD = { s: 700, b: 1100, d: 29500, heal: 5800 };   // normal bekleme sureleri (ms)
const DOM_MS = 5333;                                     // alan suresi (320 kare)
const REGEN = 0.021;                                     // CE/ms (0.35 kare basina)
const cost = (c, t) => (t === 's' ? 35 : t === 'd' ? 75 : t === 'heal' ? 40 : t === 'b' ? (C2[c] || 25) : 0);
const rooms = new Map();
let queue = null;
const ch = c => (HP[c] ? c : 'gojo');
const newCode = () => { let c; do c = 'CE' + Math.floor(1000 + Math.random() * 9000); while (rooms.has(c)); return c; };

function mk(code, s, c) {
  const r = { code, p: [s], ch: [ch(c)], hp: [], sc: [0, 0], st: [null, null], heal: [0, 0], lock: 0 };
  rooms.set(code, r); s.room = code; s.idx = 0; return r;
}
function fresh(r) {
  const n = Date.now();
  r.ce = r.ch.map(c => MAXCE[c]); r.ct = [n, n];
  r.last = [{ s: 0, b: 0, d: 0, heal: 0 }, { s: 0, b: 0, d: 0, heal: 0 }];
  r.ult = [0, 0]; r.dom = [0, 0]; r.deny = [0, 0]; r.jp = [0, 0];
  r.bl = [0, 0]; r.bc = [0, 0]; r.bu = [1, 1]; r.gd = [0, 0];
}
// Eylem dogrulama: gecerliyse enerji/sureleri isler ve null doner, degilse neden dondurur
function check(r, i, t, n) {
  if (r.hp[i] <= 0) return 'dead';
  const c = r.ch[i];
  if (t === 'p') return null;
  if (t === 'dc') { r.dom[i] = 0; return null; }                 // alan acma yarida kesildi
  if (t === 'jp') {                                               // Hakari jackpot: sadece R veya alan sonrasi
    if (c !== 'hakari') return 'cd';
    if (!(n - r.last[i].b < 1500 || Math.abs(n - r.dom[i]) < 3200)) return 'cd';
    r.jp[i] = n + 10000; return null;
  }
  const k = cost(c, t);
  if (r.jp[i] > n) r.ce[i] = MAXCE[c];                            // jackpot sirasinda sinirsiz CE
  r.ce[i] = Math.min(MAXCE[c], r.ce[i] + (n - r.ct[i]) * REGEN); r.ct[i] = n;
  if (t === 'd' && !DOM_CH[c]) return 'cd';
  const active = n < Math.max(r.dom[0], r.dom[1]) - SLACK;        // el hareketi + alan suresi boyunca
  if (t === 'd' && active) return 'domain';                        // ayni anda tek alan
  if (ULT[c] === t) {
    if (active) return 'domain';                                   // herhangi bir alan aktifken ulti yok
    if (n - r.ult[i] < ULT_CD - SLACK) return 'ult';
  }
  if (r.ce[i] < k - 8) return 'ce';
  if (n - r.last[i][t] < CD[t] - SLACK) return 'cd';
  r.ce[i] = Math.max(0, r.ce[i] - k); r.last[i][t] = n;
  if (ULT[c] === t) r.ult[i] = n;
  if (t === 'd') r.dom[i] = n + SIGN_MS + DOM_MS;
  return null;
}
function sendHp(r) { r.p.forEach((s, i) => s.emit('hp', { hp: [r.hp[i], r.hp[1 - i]] })); }
function join(r, s, c) {
  r.p.push(s); r.ch.push(ch(c)); s.room = r.code; s.idx = 1;
  r.hp = r.ch.map(k => HP[k]); fresh(r);
  r.p.forEach((p, i) => p.emit('start', { me: i, chars: r.ch, hp: r.hp }));
}
function kill(r) { rooms.delete(r.code); r.p.forEach(p => { p.room = null; }); }
function endRound(r, w) {
  r.lock = 1; r.sc[w]++;
  const over = r.sc[w] >= 2;
  r.p.forEach((s, i) => s.emit('round', { sc: [r.sc[i], r.sc[1 - i]], w: i === w ? 1 : 0, over: over ? 1 : 0 }));
  if (over) { setTimeout(() => kill(r), 6000); return; }
  setTimeout(() => {
    if (!rooms.has(r.code)) return;
    r.hp = r.ch.map(k => HP[k]); fresh(r); r.lock = 0;
    r.p.forEach(s => s.emit('reset')); sendHp(r);
  }, 3000);
}
const live = s => { const r = rooms.get(s.room); return r && r.p.length === 2 && !r.lock ? r : null; };

io.on('connection', s => {
  s.on('create', (o, cb) => {
    cb = cb || (() => {});
    if (s.room) return cb({ ok: 0, e: 'Zaten bir odadasın' });
    const c = newCode(); mk(c, s, o && o.c); s.emit('wait', c); cb({ ok: 1 });
  });
  s.on('join', (o, cb) => {
    cb = cb || (() => {});
    if (s.room) return cb({ ok: 0, e: 'Zaten bir odadasın' });
    const r = rooms.get(String((o && o.code) || '').toUpperCase());
    if (!r) return cb({ ok: 0, e: 'Oda bulunamadı' });
    if (r.p.length >= 2) return cb({ ok: 0, e: 'Oda dolu' });
    join(r, s, o.c); cb({ ok: 1 });
  });
  s.on('quick', o => {
    if (s.room) return;
    if (queue && queue.connected && queue !== s && rooms.has(queue.room)) {
      const r = rooms.get(queue.room); queue = null; join(r, s, o && o.c); return;
    }
    mk(newCode(), s, o && o.c); queue = s; s.emit('wait', '');
  });
  // konum: sınırla ve rakibe ilet
  s.on('s', o => {
    const r = rooms.get(s.room); if (!r || r.p.length < 2 || !o) return;
    const x = Math.max(0, Math.min(1280, +o.x || 0)), y = Math.max(-200, Math.min(700, +o.y || 0));
    r.st[s.idx] = { x, y };
    r.p[1 - s.idx].volatile.emit('s', { x, y, f: o.f < 0 ? -1 : 1, ce: +o.ce || 0, h: +o.h, g: o.g ? 1 : 0 });
  });
  // eylemler (görsel senkron) ve iyileşme doğrulaması
  s.on('act', o => {
    const r = live(s); if (!r || !o || !['p', 's', 'b', 'd', 'heal', 'dc', 'jp', 'blk'].includes(o.t)) return;
    const n = Date.now(); if (n - (s.la || 0) < 50) return; s.la = n;
    if (o.t === 'blk') {                                           // blok: bagimsiz bekleme, denetim disi (reddedilirse baska eylemi etkilemez)
      if (r.hp[s.idx] <= 0 || n - r.bc[s.idx] < BLK_CD - SLACK) return;
      r.bc[s.idx] = n; r.bl[s.idx] = n; r.bu[s.idx] = 0;
      r.p[1 - s.idx].emit('a', { t: 'blk' }); return;
    }
    const why = check(r, s.idx, o.t, n);
    if (why) { r.deny[s.idx] = n + 900; s.emit('deny', { t: o.t, why }); return; }   // reddedilen eylem: enerji/sure islenmez
    if (o.t === 'heal') {
      if (r.hp[s.idx] >= HP[r.ch[s.idx]]) return;
      r.hp[s.idx] = Math.min(HP[r.ch[s.idx]], r.hp[s.idx] + 45); sendHp(r);
    }
    r.p[1 - s.idx].emit('a', { t: o.t, bf: o.bf ? 1 : 0 });
  });
  // hasar: sunucu doğrular ve uygular
  s.on('hit', o => {
    const r = live(s); if (!r || !o) return;
    const i = s.idx, j = 1 - i, n = Date.now();
    let d = Math.round(+o.d); if (!(d > 0) || r.hp[j] <= 0 || r.hp[i] <= 0) return;
    if (!o.m && n < r.deny[i]) return;   // reddedilen yetenegin mermi hasari sayilmaz
    d = Math.min(d, 140);
    const b = s.bk = Math.min(300, (s.bk === undefined ? 300 : s.bk) + (n - (s.bt || n)) * 0.3); s.bt = n;
    if (b < d) return; s.bk = b - d;
    if (o.m && r.st[i] && r.st[j] && Math.abs(r.st[i].x - r.st[j].x) > 260) return;
    let bl = 0; const strong = !!o.s;                              // blok: 80 hasar -> 20; guclu saldiri -> minimum
    if (n - r.bl[j] <= BLK_WIN && !r.bu[j]) { d = Math.max(1, Math.round(d * (strong ? .15 : .25))); r.bu[j] = 1; r.gd[j] = n + GUARD_MS; bl = 1; }
    else if (r.gd[j] > n) d = Math.max(1, Math.round(d * (strong ? .3 : .35)));
    r.hp[j] = Math.max(0, r.hp[j] - d);
    r.p[j].emit('hurt', { bl, d, kb: Math.max(-14, Math.min(14, +o.kb || 0)), bf: o.bf ? 1 : 0, st: Math.max(0, Math.min(90, +o.st || 0)) });
    sendHp(r);
    if (r.hp[j] <= 0) endRound(r, i);
  });
  s.on('disconnect', () => {
    if (queue === s) queue = null;
    const r = rooms.get(s.room); if (!r) return;
    rooms.delete(r.code);
    r.p.forEach(p => { if (p !== s) { p.room = null; p.emit('left'); } });
  });
});

const PORT = process.env.PORT || 3000;
// Hakari jackpot: sunucu tarafli hizli iyilesme (yaklasik 11 can/sn)
if (require.main === module) setInterval(() => {
  const n = Date.now();
  rooms.forEach(r => {
    if (r.p.length < 2 || r.lock || !r.jp) return;
    let dirty = false;
    [0, 1].forEach(i => { if (r.jp[i] > n && r.hp[i] > 0 && r.hp[i] < HP[r.ch[i]]) { r.hp[i] = Math.min(HP[r.ch[i]], r.hp[i] + 2.7); dirty = true; } });
    if (dirty) sendHp(r);
  });
}, 250);
if (require.main === module) srv.listen(PORT, () => console.log('Cursed Era sunucusu: http://localhost:' + PORT));
module.exports = { check, fresh };