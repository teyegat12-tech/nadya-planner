// Микро-радости: звук «пуньк», конфетти, вибрация
let ctx = null;
const soundOn = () => { try { return localStorage.getItem('pl_sound') !== '0'; } catch { return true; } };
export function setSound(on) { try { localStorage.setItem('pl_sound', on ? '1' : '0'); } catch {} }
export const isSoundOn = soundOn;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// одна мягкая «капля»: частота, когда начать, длительность
function blip(a, freq, at, dur = 0.14, vol = 0.18, type = 'sine') {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  o.frequency.exponentialRampToValueAtTime(freq * 1.5, at + 0.03);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(a.destination);
  o.start(at); o.stop(at + dur + 0.02);
}

// задача выполнена: «пу-ньк»
export function playDone() {
  if (!soundOn()) return;
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  blip(a, 660, t, 0.12);
  blip(a, 990, t + 0.07, 0.18);
}

// весь день закрыт: «пунь-пунь-пуньк!»
export function playDayDone() {
  if (!soundOn()) return;
  const a = audio(); if (!a) return;
  const t = a.currentTime + 0.25;
  [523, 659, 784, 1047].forEach((f, i) => blip(a, f, t + i * 0.09, 0.22, 0.16));
}

// снять отметку: тихий «тук»
export function playUndo() {
  if (!soundOn()) return;
  const a = audio(); if (!a) return;
  blip(a, 330, a.currentTime, 0.1, 0.1, 'triangle');
}

export function buzz(ms = 12) { try { navigator.vibrate?.(ms); } catch {} }

// конфетти из точки (x, y)
export function burst(x, y, { count = 14, colors } = {}) {
  const cs = colors || ['#DDFC5A', '#FE9853', '#F590B2', '#B5A3E6', '#9A7CFA', '#5CCB8A'];
  const layer = document.createElement('div');
  layer.className = 'burst';
  layer.style.left = x + 'px';
  layer.style.top = y + 'px';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 28 + Math.random() * 34;
    p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(ang) * dist - 10 + 'px');
    p.style.setProperty('--r', Math.random() * 360 + 'deg');
    p.style.background = cs[i % cs.length];
    if (i % 3 === 0) p.classList.add('round');
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 900);
}

// большой салют на весь экран
export function celebrate() {
  const w = window.innerWidth;
  [0.2, 0.5, 0.8].forEach((k, i) => setTimeout(() => burst(w * k, window.innerHeight * 0.35, { count: 22 }), i * 140));
}
