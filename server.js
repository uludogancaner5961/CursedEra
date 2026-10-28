// Cursed Era online sunucusu: odalar, eşleştirme ve hasar doğrulama
const express = require('express'), http = require('http'), path = require('path');
const { Server } = require('socket.io');
const app = express(), srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const HP = { gojo: 130, sukuna: 150, yuta: 125, yuji: 140 };
const rooms = new Map();
let queue = null;
const ch = c => (HP[c] ? c : 'gojo');
const newCode = () => { let c; do c = 'CE' + Math.floor(1000 + Math.random() * 9000); while (rooms.has(c)); return c; };

function mk(code, s, c) {
  const r = { code, p: [s], ch: [ch(c)], hp: [], sc: [0, 0], st: [null, null], heal: [0, 0], lock: 0 };
  rooms.set(code, r); s.room = code; s.idx = 0; return r;
}
function sendHp(r) { r.p.forEach((s, i) => s.emit('hp', { hp: [r.hp[i], r.hp[1 - i]] })); }
function join(r, s, c) {
  r.p.push(s); r.ch.push(ch(c)); s.room = r.code; s.idx = 1;
  r.hp = r.ch.map(k => HP[k]);
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
    r.hp = r.ch.map(k => HP[k]); r.heal = [0, 0]; r.lock = 0;
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
    if (o.t === 'heal') {
      if (n - r.heal[s.idx] < 5800 || r.hp[s.idx] <= 0) return;
      r.heal[s.idx] = n; r.hp[s.idx] = Math.min(HP[r.ch[s.idx]], r.hp[s.idx] + 45); sendHp(r);
    }
    r.p[1 - s.idx].emit('a', { t: o.t, bf: o.bf ? 1 : 0 });
  });
  // hasar: sunucu doğrular ve uygular
  s.on('hit', o => {
    const r = live(s); if (!r || !o) return;
    const i = s.idx, j = 1 - i, n = Date.now();
    let d = Math.round(+o.d); if (!(d > 0) || r.hp[j] <= 0 || r.hp[i] <= 0) return;
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
srv.listen(PORT, () => console.log('Cursed Era sunucusu: http://localhost:' + PORT));
