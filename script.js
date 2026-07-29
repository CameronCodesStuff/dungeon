import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, increment,
  onSnapshot, collection, addDoc, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD5k9TCLBMtALgjPhcM1ac6aH_famFzrC4",
  authDomain: "dungeon-a93fe.firebaseapp.com",
  projectId: "dungeon-a93fe",
  storageBucket: "dungeon-a93fe.firebasestorage.app",
  messagingSenderId: "1077128513566",
  appId: "1:1077128513566:web:5d10aae061e77afdc0060f",
  measurementId: "G-NBCEB4THT2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const STARTING_BALANCE = 1000;
const MIN_BET = 10;
const HOUSE_EDGE = 0.95;
const CHIP_VALUES = [10, 25, 50, 100, 250];
const FEED_LIMIT = 30;

const nameInput = document.getElementById('name-input');
const balanceDisplay = document.getElementById('balance-display');
const feedList = document.getElementById('feed-list');

const doorsEl = document.getElementById('doors');
const promptEl = document.getElementById('prompt-text');
const hudDepth = document.getElementById('hud-depth');
const hudMult = document.getElementById('hud-mult');
const hudPayout = document.getElementById('hud-payout');
const riskFill = document.getElementById('risk-fill');
const logEl = document.getElementById('log');

const posBet = document.getElementById('pos-bet');
const posMult = document.getElementById('pos-mult');
const posPayout = document.getElementById('pos-payout');

const amountInput = document.getElementById('amount-input');
const amtMinus = document.getElementById('amt-minus');
const amtPlus = document.getElementById('amt-plus');
const chipRow = document.getElementById('chip-row');
const btnBuy = document.getElementById('btn-buy');
const btnSell = document.getElementById('btn-sell');
const btnReset = document.getElementById('btn-reset');
const betHint = document.getElementById('bet-hint');

let uid = null;
let myName = localStorage.getItem('dungeon-gamble-name') || '';
let myBalance = 0;
let ready = false;

let run = {
  active: false,
  bet: 0,
  depth: 0,
  multiplier: 1,
  locked: false,
  canSell: false,
};

function randomName() {
  const adjectives = ['Rogue', 'Grim', 'Sly', 'Bold', 'Lucky', 'Shadow', 'Iron', 'Wild', 'Silent', 'Reckless'];
  const n = adjectives[Math.floor(Math.random() * adjectives.length)];
  return n + Math.floor(100 + Math.random() * 900);
}

function formatMoney(n) {
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
}

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}
function beep(freq, duration, type, gain) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  g.gain.value = gain || 0.08;
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start();
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.stop(ctx.currentTime + duration);
}
function sfxTreasure() {
  beep(523.25, 0.15, 'triangle', 0.09);
  setTimeout(() => beep(783.99, 0.2, 'triangle', 0.09), 90);
}
function sfxTrap() {
  beep(160, 0.35, 'sawtooth', 0.1);
  setTimeout(() => beep(90, 0.4, 'sawtooth', 0.09), 80);
}
function sfxSell() {
  beep(659.25, 0.12, 'sine', 0.08);
  setTimeout(() => beep(880, 0.25, 'sine', 0.08), 100);
  setTimeout(() => beep(1046.5, 0.3, 'sine', 0.07), 200);
}
function sfxClick() { beep(300, 0.06, 'square', 0.04); }
function sfxChip() { beep(700, 0.05, 'square', 0.05); }

function log(msg) {
  logEl.style.opacity = 0;
  setTimeout(() => {
    logEl.textContent = msg;
    logEl.style.opacity = 0.65;
  }, 150);
}

function doorsForDepth(depth) {
  return Math.min(3 + Math.floor(depth / 2), 9);
}
function trapsForDepth(depth) {
  const doors = doorsForDepth(depth);
  const raw = 1 + Math.floor(depth / 2);
  return Math.min(raw, doors - 1);
}
function multiplierForDepth(depth) {
  const doors = doorsForDepth(depth);
  const traps = trapsForDepth(depth);
  const safe = doors - traps;
  const fair = doors / safe;
  return Math.round(fair * HOUSE_EDGE * 100) / 100;
}
function safeFractionForDepth(depth) {
  const doors = doorsForDepth(depth);
  const traps = trapsForDepth(depth);
  return (doors - traps) / doors;
}

function renderChips() {
  chipRow.innerHTML = '';
  CHIP_VALUES.forEach((val) => {
    const chip = document.createElement('button');
    chip.className = `chip c${val}`;
    chip.textContent = '$' + val;
    chip.addEventListener('click', () => {
      sfxChip();
      amountInput.value = val;
      syncChipSelection();
    });
    chipRow.appendChild(chip);
  });
  syncChipSelection();
}

function syncChipSelection() {
  const val = Number(amountInput.value);
  Array.from(chipRow.children).forEach((chip, i) => {
    chip.classList.toggle('selected', CHIP_VALUES[i] === val);
    chip.classList.toggle('disabled', CHIP_VALUES[i] > myBalance);
  });
}

amtMinus.addEventListener('click', () => {
  sfxClick();
  amountInput.value = Math.max(MIN_BET, Number(amountInput.value) - 10);
  syncChipSelection();
});
amtPlus.addEventListener('click', () => {
  sfxClick();
  amountInput.value = Math.min(myBalance || MIN_BET, Number(amountInput.value) + 10);
  syncChipSelection();
});
amountInput.addEventListener('input', () => {
  let v = Number(amountInput.value) || MIN_BET;
  if (v > myBalance) v = myBalance;
  if (v < MIN_BET) v = MIN_BET;
  amountInput.value = v;
  syncChipSelection();
});

function refreshBetPanel() {
  balanceDisplay.textContent = formatMoney(myBalance);
  syncChipSelection();

  if (!ready) {
    btnBuy.disabled = true;
    betHint.textContent = 'Connecting to the vault...';
    return;
  }

  if (run.active) {
    btnBuy.classList.add('hidden');
    btnSell.classList.remove('hidden');
    btnSell.disabled = !run.canSell;
    betHint.textContent = run.canSell
      ? 'Sell anytime to lock in your payout.'
      : 'Open a door to unlock selling.';
  } else {
    btnBuy.classList.remove('hidden');
    btnSell.classList.add('hidden');
    if (myBalance < MIN_BET) {
      btnBuy.disabled = true;
      betHint.textContent = "You're out of gold.";
      btnReset.classList.remove('hidden');
    } else {
      btnBuy.disabled = false;
      betHint.textContent = 'Buy in to start your descent.';
      btnReset.classList.add('hidden');
    }
  }
}

function updateHud() {
  hudDepth.textContent = run.depth;
  hudMult.textContent = 'x' + run.multiplier.toFixed(2);
  const payout = run.bet * run.multiplier;
  hudPayout.textContent = formatMoney(payout);
  posBet.textContent = formatMoney(run.bet);
  posMult.textContent = 'x' + run.multiplier.toFixed(2);
  posPayout.textContent = formatMoney(payout);
  const safeFrac = run.depth > 0 ? safeFractionForDepth(run.depth) : 1;
  riskFill.style.left = `${(1 - safeFrac) * 100}%`;
}

function renderIdleDoors() {
  doorsEl.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('div');
    d.className = 'door locked';
    d.innerHTML = `<div class="door-face"><span class="door-number">🔒</span></div><div class="door-reveal"></div>`;
    doorsEl.appendChild(d);
  }
}

function buildLevel() {
  run.depth += 1;
  const doorCount = doorsForDepth(run.depth);
  const traps = trapsForDepth(run.depth);
  const levelMult = multiplierForDepth(run.depth);

  const layout = [];
  for (let i = 0; i < doorCount; i++) layout.push('treasure');
  for (let i = 0; i < traps; i++) layout[i] = 'trap';
  for (let i = layout.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [layout[i], layout[j]] = [layout[j], layout[i]];
  }

  renderDoors(layout, levelMult);
  updateHud();
  promptEl.textContent = `Depth ${run.depth} — this door pays x${levelMult.toFixed(2)}. ${traps} of ${doorCount} hide a trap.`;
}

function renderDoors(layout, levelMult) {
  doorsEl.innerHTML = '';
  run.locked = false;
  layout.forEach((kind, i) => {
    const doorEl = document.createElement('div');
    doorEl.className = 'door';
    doorEl.innerHTML = `<div class="door-face"><span class="door-number">${i + 1}</span></div><div class="door-reveal"></div>`;
    doorEl.addEventListener('click', () => handlePick(doorEl, kind, levelMult));
    doorsEl.appendChild(doorEl);
  });
}

function handlePick(doorEl, kind, levelMult) {
  if (run.locked) return;
  run.locked = true;
  sfxClick();

  const allDoors = Array.from(doorsEl.children);
  allDoors.forEach((d) => d.classList.add('disabled'));
  doorEl.classList.add('chosen');
  const reveal = doorEl.querySelector('.door-reveal');

  setTimeout(() => {
    if (kind === 'treasure') {
      doorEl.classList.add('result-treasure');
      reveal.innerHTML = `<span class="icon">💰</span><span class="mult-text">x${levelMult.toFixed(2)}</span>`;
      sfxTreasure();
      run.multiplier = Math.round(run.multiplier * levelMult * 100) / 100;
      run.canSell = true;
      updateHud();
      refreshBetPanel();
      log(`Safe! Multiplier now x${run.multiplier.toFixed(2)}.`);
      setTimeout(() => {
        allDoors.forEach((d) => { if (d !== doorEl) d.classList.add('faded'); });
        setTimeout(() => buildLevel(), 550);
      }, 500);
    } else {
      doorEl.classList.add('result-trap');
      reveal.innerHTML = `<span class="icon">💀</span>`;
      sfxTrap();
      log('A trap springs shut...');
      setTimeout(() => {
        allDoors.forEach((d) => { if (d !== doorEl) d.classList.add('faded'); });
        finishRun(false);
      }, 700);
    }
  }, 350);
}

async function finishRun(won) {
  const payout = won ? run.bet * run.multiplier : 0;
  const depthReached = run.depth;
  const multReached = run.multiplier;
  const betAmount = run.bet;

  run.active = false;
  run.canSell = false;

  if (won) {
    promptEl.textContent = `Cashed out for ${formatMoney(payout)} at depth ${depthReached}.`;
  } else {
    promptEl.textContent = `The dungeon claimed your ${formatMoney(betAmount)} bet at depth ${depthReached}.`;
  }
  renderIdleDoors();
  refreshBetPanel();

  if (!uid) return;

  try {
    if (won) {
      await updateDoc(doc(db, 'users', uid), { balance: increment(payout) });
    }
    await addDoc(collection(db, 'feed'), {
      uid,
      name: myName || randomName(),
      result: won ? 'win' : 'loss',
      amount: won ? payout : betAmount,
      bet: betAmount,
      multiplier: multReached,
      depth: depthReached,
      ts: serverTimestamp(),
    });
  } catch (e) {
    log('Connection issue saving your result.');
  }
}

async function startRun() {
  if (!ready || run.active) return;
  const bet = Number(amountInput.value);
  if (bet < MIN_BET || bet > myBalance) return;

  ensureAudio();
  sfxClick();

  run.active = true;
  run.bet = bet;
  run.depth = 0;
  run.multiplier = 1;
  run.locked = false;
  run.canSell = false;
  updateHud();
  refreshBetPanel();

  try {
    await updateDoc(doc(db, 'users', uid), { balance: increment(-bet) });
  } catch (e) {
    log('Connection issue placing your bet.');
    run.active = false;
    refreshBetPanel();
    return;
  }

  buildLevel();
}

function sellRun() {
  if (!run.active || !run.canSell) return;
  sfxSell();
  finishRun(true);
}

btnBuy.addEventListener('click', startRun);
btnSell.addEventListener('click', sellRun);

btnReset.addEventListener('click', async () => {
  if (!uid) return;
  await updateDoc(doc(db, 'users', uid), { balance: STARTING_BALANCE });
});

nameInput.addEventListener('change', async () => {
  const val = nameInput.value.trim().slice(0, 16) || randomName();
  nameInput.value = val;
  myName = val;
  localStorage.setItem('dungeon-gamble-name', val);
  if (uid) {
    try { await updateDoc(doc(db, 'users', uid), { name: val }); } catch (e) {}
  }
});

function renderFeedEntry(data) {
  const el = document.createElement('div');
  el.className = `feed-entry ${data.result === 'win' ? 'win' : 'lose'}`;
  const name = data.name || 'Adventurer';
  const amt = data.result === 'win' ? formatMoney(data.amount) : '-' + formatMoney(data.amount);
  const verb = data.result === 'win' ? 'won' : 'lost';
  el.innerHTML = `
    <div><span class="feed-name">${escapeHtml(name)}</span> ${verb} <span class="feed-amount">${amt}</span></div>
    <div class="feed-meta">Depth ${data.depth} · x${(data.multiplier || 1).toFixed(2)}</div>
  `;
  return el;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function listenFeed() {
  const q = query(collection(db, 'feed'), orderBy('ts', 'desc'), limit(FEED_LIMIT));
  onSnapshot(q, (snap) => {
    feedList.innerHTML = '';
    if (snap.empty) {
      feedList.innerHTML = '<div class="feed-empty">No runs yet. Be the first to descend.</div>';
      return;
    }
    const docs = [];
    snap.forEach((d) => docs.push(d.data()));
    docs.reverse();
    docs.forEach((data) => {
      feedList.appendChild(renderFeedEntry(data));
    });
  }, () => {
    feedList.innerHTML = '<div class="feed-empty">Feed unavailable.</div>';
  });
}

async function initUser(user) {
  uid = user.uid;
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const initialName = myName || randomName();
    myName = initialName;
    localStorage.setItem('dungeon-gamble-name', initialName);
    await setDoc(ref, {
      name: initialName,
      balance: STARTING_BALANCE,
      createdAt: serverTimestamp(),
    });
  } else {
    const data = snap.data();
    if (!myName) {
      myName = data.name || randomName();
      localStorage.setItem('dungeon-gamble-name', myName);
    }
  }

  nameInput.value = myName;

  onSnapshot(ref, (docSnap) => {
    if (!docSnap.exists()) return;
    const data = docSnap.data();
    myBalance = data.balance || 0;
    if (data.name && data.name !== nameInput.value && document.activeElement !== nameInput) {
      nameInput.value = data.name;
    }
    ready = true;
    refreshBetPanel();
  });

  listenFeed();
}

renderIdleDoors();
renderChips();
refreshBetPanel();

onAuthStateChanged(auth, (user) => {
  if (user) {
    initUser(user);
  } else {
    signInAnonymously(auth).catch(() => {
      betHint.textContent = 'Could not connect. Check your connection.';
    });
  }
});
