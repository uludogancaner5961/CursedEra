const express = require('express'), http = require('http'), path = require('path');
const { Server } = require('socket.io');
const app = express(), srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: '*' } });

// Tüm statik dosyaları ana dizinden sun
app.use(express.static(path.join(__dirname)));

// Kök dizine (/) istek geldiğinde doğrudan index.html'i gönder
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Taban can degerleri istemcideki CH tablosuyla ayni; HP_MULT istemcideki carpanla (index.html) AYNI olmali
const HP_MULT = 2;
const BASE_HP = { gojo: 130, sukuna: 150, yuta: 125, yuji: 140, higuruma: 135, toji: 145, hakari: 150, kashimo: 130, kenjaku: 140 };
const HP = Object.fromEntries(Object.entries(BASE_HP).map(([k, v]) => [k, Math.round(v * HP_MULT)]));
const MAXCE = { gojo: 160, sukuna: 140, yuta: 190, yuji: 110, higuruma: 150, toji: 90, hakari: 150, kashimo: 170, kenjaku: 200 };
// Ulti: Gojo Q (Hollow Purple), Sukuna Q (Dismantle), Yuta R (Rika), Yuji R (Double Black Flash)
// Istemci olay adlari: 's' = Q yetenegi, 'b' = R yetenegi, 'd' = alan, 'heal' = iyilesme, 'p' = yumruk
const ULT = { gojo: 's', sukuna: 's', yuta: 'b', yuji: 'b', higuruma: 's', toji: 's', hakari: 's', kashimo: 's', kenjaku: 's' };   // Q=ulti (Yuta/Yuji: istemcide tuslar yer degistirir, olay adi ayni)
const ULT_CD = 7500, SLACK = 150;                       // ulti bekleme suresi 7.5 sn (+ ag gecikmesi payi)
const CD = { s: 700, b: 1100, d: 29500, heal: 5800 };   // normal bekleme sureleri (ms)
const DOM_MS = 5333;                                     // alan suresi (320 kare)
const REGEN = 0.021;                                     // CE/ms (0.35 kare basina)
const cost = (c, t) => (t === 's' ? 35 : t === 'd' ? 75 : t === 'heal' ? 40 : t === 'b' ? (c === 'yuta' ? 45 : c === 'yuji' ? 35 : 25) : 0);
const rooms = new Map();
let queue = null;
const ch = c => (HP[c] ? c : 'gojo');
const newCode = () => { let c; do c = 'CE' + Math.floor(1000 + Math.random() * 9000); while (rooms.has(c)); return c; };

function mk(code, s, c) {
  const r = { code, p: [s], ch: [ch(c)], hp: [], sc: [0, 0], st: [null, null], heal: [0, 0], lock: 0 };
  rooms.set(code, r); s.room = code; s.idx = 0; return r;
}
function fresh(r) {
  r.ce = r.ch.map(c => MAXCE[c]); r.ct = [Date.now(), Date.now()];
  r.last = [{ s: 0, b: 0, d: 0, heal: 0 }, { s: 0, b: 0, d: 0, heal: 0 }];
  r.ult = [0, 0]; r.dom = [0, 0]; r.deny = [0, 0];
}
// Eylem dogrulama: gecerliyse enerji/sureleri isler ve null doner, degilse neden dondurur
function check(r, i, t, n) {
  if (r.hp[i] <= 0) return 'dead';
  if (t === 'p') return null;
  const c = r.ch[i], k = cost(c, t);
  r.ce[i] = Math.min(MAXCE[c], r.ce[i] + (n - r.ct[i]) * REGEN); r.ct[i] = n;
  if (ULT[c] === t) {
    if (n < Math.max(r.dom[0], r.dom[1]) - SLACK) return 'domain';   // herhangi bir alan aktifken ulti yok
    if (n - r.ult[i] < ULT_CD - SLACK) return 'ult';
  }
  if (r.ce[i] < k - 8) return 'ce';
  if (n - r.last[i][t] < CD[t] - SLACK) return 'cd';
  r.ce[i] = Math.max(0, r.ce[i] - k); r.last[i][t] = n;
  if (ULT[c] === t) r.ult[i] = n;
  if (t === 'd') r.dom[i] = n + DOM_MS;
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
    const r = live(s); if (!r || !o || !['p', 's', 'b', 'd', 'heal'].includes(o.t)) return;
    const n = Date.now(); if (n - (s.la || 0) < 50) return; s.la = n;
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
    d = Math.min(d, 75);
    const b = s.bk = Math.min(300, (s.bk === undefined ? 300 : s.bk) + (n - (s.bt || n)) * 0.3); s.bt = n;
    if (b < d) return; s.bk = b - d;
    if (o.m && r.st[i] && r.st[j] && Math.abs(r.st[i].x - r.st[j].x) > 260) return;
    r.hp[j] = Math.max(0, r.hp[j] - d);
    r.p[j].emit('hurt', { d, kb: Math.max(-14, Math.min(14, +o.kb || 0)), bf: o.bf ? 1 : 0 });
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
if (require.main === module) srv.listen(PORT, () => console.log('Cursed Era sunucusu: http://localhost:' + PORT));
module.exports = { check, fresh };
