// Delve client. Renders whatever state the server sends; the server owns all the rules.
(() => {
  const { CARDS, TARGET_GOLD, START_HEALTH, MIN_PLAYERS } = window.DELVE;
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const connEl = document.getElementById('conn');

  let ws = null;
  let state = null;
  let session = load();
  let retry = 0;
  let lastFlipSig = '';
  let screen = '';

  // ---- Storage (wrapped: private windows can throw) ----
  function load() {
    try { return JSON.parse(localStorage.getItem('delve-session')) || {}; } catch { return {}; }
  }
  function save() {
    try { localStorage.setItem('delve-session', JSON.stringify(session)); } catch {}
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- Connection ----
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => {
      retry = 0;
      connEl.classList.add('hidden');
      if (session.code && session.token && session.name) {
        sendMsg({ type: 'join', code: session.code, name: session.name, token: session.token });
      }
    };
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'joined') {
        session = { ...session, code: msg.code, token: msg.token };
        save();
        if (location.pathname !== '/' + msg.code) history.replaceState(null, '', '/' + msg.code);
      } else if (msg.type === 'state') {
        state = msg;
        render();
      } else if (msg.type === 'error') {
        toast(msg.error);
        // A saved room that no longer exists: forget it and show the home screen.
        if (!state && /doesn't exist|already started/.test(msg.error)) {
          session = { name: session.name };
          save();
          render();
        }
      }
    };
    ws.onclose = () => {
      if (state) connEl.classList.remove('hidden');
      setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
    };
  }

  function sendMsg(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    else toast('Still connecting, try again in a second.');
  }

  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3200);
  }

  // ---- Shared pieces ----
  function rulesHTML(open) {
    const byType = t => Object.values(CARDS).filter(c => c.type === t).map(c => `
      <div class="card-mini t-${c.type}"><span class="ic">${c.icon}</span><span><b>${esc(c.name)} ×${c.count}</b>${esc(c.text)}</span></div>`).join('');
    return `
    <details class="rules" ${open ? 'open' : ''}>
      <summary>How to play</summary>
      <p><b>Goal:</b> be the first to bank <b>${TARGET_GOLD} gold</b>.</p>
      <ul>
        <li>On your turn you have <b>${START_HEALTH} health</b>. Tap <b>Delve</b> to flip a card from the dungeon.</li>
        <li><b>Treasure</b> goes into your haul. <b>Monsters</b> hurt you.</li>
        <li>Tap <b>Escape</b> any time after your first flip to bank your haul. Banked gold is safe.</li>
        <li>If your damage reaches ${START_HEALTH}, you <b>bust</b> and lose the whole haul.</li>
        <li>When someone banks ${TARGET_GOLD}, the round finishes so everyone gets the same number of turns. Most gold wins.</li>
      </ul>
      <p class="muted">Treasure</p><div class="card-grid">${byType('treasure')}</div>
      <p class="muted">Monsters</p><div class="card-grid">${byType('monster')}</div>
      <p class="muted">Specials</p><div class="card-grid">${byType('special')}</div>
    </details>`;
  }

  function cardHTML(c, opts = {}) {
    const def = CARDS[c.key];
    return `<div class="card t-${def.type} ${opts.big ? 'big' : ''} ${opts.isNew ? 'new' : ''}">
      <div class="ic">${def.icon}</div><div class="nm">${esc(def.name)}</div>
      <div class="nt">${esc(c.note || def.text)}</div></div>`;
  }

  function hearts(damage) {
    const left = Math.max(0, START_HEALTH - damage);
    return '❤️'.repeat(left) + '🖤'.repeat(START_HEALTH - left);
  }

  // ---- Screens ----
  function render() {
    if (!state) return renderHome();
    if (state.phase === 'lobby') return renderLobby();
    if (state.phase === 'over') return renderResults();
    renderGame();
  }

  function renderHome() {
    if (screen === 'home') return; // keep what the player is typing
    screen = 'home';
    const fromUrl = location.pathname.slice(1).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    app.innerHTML = `
      <div class="logo">DELVE</div>
      <div class="tagline">Dig for gold. Get out before the dungeon gets you.<br>2 to 6 players, one phone each.</div>
      <div class="panel stack">
        <div><label for="name">Your name</label><input id="name" maxlength="16" autocomplete="nickname" placeholder="e.g. Chris" value="${esc(session.name || '')}"></div>
        <div><label for="code">Room code</label><input id="code" class="code" maxlength="4" autocomplete="off" placeholder="ABCD" value="${esc(fromUrl)}"></div>
        <button id="join">Join room</button>
        <div class="divider">or</div>
        <button id="create" class="secondary">Create a new room</button>
      </div>
      <div style="margin-top:14px">${rulesHTML(false)}</div>`;
    const nameEl = document.getElementById('name');
    const codeEl = document.getElementById('code');
    const go = type => {
      const name = nameEl.value.trim();
      if (!name) { toast('Enter your name first.'); nameEl.focus(); return; }
      session = { name };
      save();
      const msg = { type, name };
      if (type === 'join') {
        msg.code = codeEl.value.trim().toUpperCase();
        if (msg.code.length !== 4) { toast('Room codes are 4 letters.'); codeEl.focus(); return; }
      }
      sendMsg(msg);
    };
    document.getElementById('join').onclick = () => go('join');
    document.getElementById('create').onclick = () => go('create');
    codeEl.onkeydown = e => { if (e.key === 'Enter') go('join'); };
    if (fromUrl) nameEl.focus();
  }

  function renderLobby() {
    screen = 'lobby';
    const isHost = state.you === state.hostId;
    const link = `${location.origin}/${state.code}`;
    const enough = state.seats.length >= MIN_PLAYERS;
    app.innerHTML = `
      <div class="logo" style="font-size:34px;margin-top:8px">DELVE</div>
      <div class="panel center">
        <label>Room code</label>
        <div class="roomcode">${esc(state.code)}</div>
        <div class="muted" style="font-size:14px;margin-bottom:10px">Friends open <b>${esc(location.host)}</b> and enter this code.</div>
        <button id="share" class="secondary small">Copy invite link</button>
      </div>
      <div class="panel" style="margin-top:12px">
        <label>Players (${state.seats.length}/6)</label>
        <ul class="player-list">
          ${state.seats.map(s => `<li><span>${s.id === state.hostId ? '👑 ' : ''}${esc(s.name)}</span>
            <span>${s.id === state.you ? '<span class="tag you">you</span>' : ''}</span></li>`).join('')}
        </ul>
      </div>
      <div style="margin-top:12px">
        ${isHost
          ? `<button id="start" ${enough ? '' : 'disabled'}>${enough ? 'Start the delve' : `Waiting for ${MIN_PLAYERS - state.seats.length} more player…`}</button>`
          : `<div class="note">Waiting for the host to start…</div>`}
      </div>
      <div style="margin-top:12px">${rulesHTML(true)}</div>
      <div class="center" style="margin-top:14px"><button id="leave" class="secondary small">Leave room</button></div>`;
    document.getElementById('share').onclick = async () => {
      try {
        if (navigator.share) await navigator.share({ title: 'Join my Delve game', text: `Room code ${state.code}`, url: link });
        else { await navigator.clipboard.writeText(link); toast('Invite link copied!'); }
      } catch {}
    };
    const start = document.getElementById('start');
    if (start) start.onclick = () => sendMsg({ type: 'start' });
    document.getElementById('leave').onclick = leaveRoom;
  }

  function leaveRoom() {
    session = { name: session.name };
    save();
    state = null;
    screen = '';
    history.replaceState(null, '', '/');
    try { ws.close(); } catch {}
    render();
  }

  function renderGame() {
    screen = 'game';
    const g = state.game;
    const t = g.turn;
    const seatsById = Object.fromEntries(state.seats.map(s => [s.id, s]));
    const cur = g.players.find(p => p.id === g.turnPlayerId);
    const mine = cur && cur.id === state.you;
    const curConnected = cur && seatsById[cur.id]?.connected;

    const sig = `${g.turnPlayerId}:${g.round}:${t ? t.flipped.length : 0}`;
    const newFlip = sig !== lastFlipSig && t && t.flipped.length > 0;
    lastFlipSig = sig;
    if (newFlip && mine && navigator.vibrate) {
      const last = t.flipped[t.flipped.length - 1];
      if (CARDS[last.key].type === 'monster' || last.key === 'mimic') navigator.vibrate(80);
    }

    const leaderGold = Math.max(...g.players.map(p => p.banked));
    const scores = g.players.map(p => {
      const s = seatsById[p.id];
      const flags = [
        p.banked > 0 && p.banked === leaderGold ? '👑' : '',
        p.skipNext ? '⏭️' : '',
        s && !s.connected ? '📵' : '',
      ].join('');
      return `<div class="score ${p.id === g.turnPlayerId ? 'active' : ''}">
        <div class="flags">${flags}</div>
        <div class="nm">${esc(p.name)}${p.id === state.you ? ' <span class="muted">(you)</span>' : ''}</div>
        <div class="gold">${p.banked} <small>/ ${TARGET_GOLD}</small></div>
        <div class="bar"><div style="width:${Math.min(100, p.banked / TARGET_GOLD * 100)}%"></div></div>
      </div>`;
    }).join('');

    let banner = '';
    const lt = g.lastTurn;
    if (lt && t && t.flipped.length === 0) {
      const who = lt.playerId === state.you ? 'You' : esc(lt.name);
      if (lt.result === 'bust') {
        const killer = lt.flipped[lt.flipped.length - 1];
        banner = `<div class="banner bust">💥 ${who} got overwhelmed by ${CARDS[killer.key].icon} ${esc(CARDS[killer.key].name)} and lost ${lt.haul} gold</div>`;
      } else if (lt.result === 'escape') {
        banner = `<div class="banner escape">🏃 ${who} escaped with ${lt.haul} gold</div>`;
      } else if (lt.result === 'cavein') {
        banner = `<div class="banner bust">🪨 The cave collapsed on ${who}! All their gold is gone</div>`;
      } else if (lt.result === 'skipped') {
        banner = `<div class="banner skipped">${who} disconnected, so their turn was skipped</div>`;
      }
    }

    const flipped = t ? t.flipped : [];
    const table = flipped.length
      ? flipped.slice().reverse().map((c, i) => cardHTML(c, { big: i === 0, isNew: newFlip && i === 0 })).join('')
      : `<div class="card big empty">${mine ? 'Tap Delve to flip your first card' : 'No cards yet'}</div>`;

    let controls = '';
    if (mine) {
      controls = `<div class="actions">
        <button class="delve" id="delve">⚔️ Delve</button>
        <button id="escape" ${flipped.length ? '' : 'disabled'}>🏃 Escape${t.haul ? ` (+${t.haul})` : ''}</button>
      </div>`;
      if (t.peek) {
        const d = CARDS[t.peek.key];
        controls += `<div class="peek"><span class="ic">${d.icon}</span><span>Your torch shows the next card: <b>${esc(d.name)}</b> (${esc(d.text)})</span></div>`;
      }
    } else if (cur && !curConnected) {
      controls = `<div class="note">📵 Waiting for ${esc(cur.name)} to reconnect…</div>
        <div style="margin-top:8px"><button id="skip" class="secondary">Skip their turn</button></div>`;
    } else if (cur) {
      const doing = t.choice ? `${CARDS[t.choice.kind].icon} ${esc(cur.name)} is ${t.choice.kind === 'toll' && !t.choice.roll ? 'rolling the die' : 'choosing a player'}…`
        : t.peeking ? `🔦 ${esc(cur.name)} is peeking at the next card…` : `Watching ${esc(cur.name)} delve…`;
      controls = `<div class="note">${doing}</div>`;
    }

    const turnTitle = mine ? 'Your turn!' : `${esc(cur ? cur.name : '')}'s turn`;

    app.innerHTML = `
      <div class="topbar"><span>Room ${esc(state.code)} · Round ${g.round}</span><span>🂠 ${g.deckCount} cards left</span></div>
      ${g.finalRound ? `<div class="final">⚠️ Final round! Most gold when it ends wins.</div>` : ''}
      <div class="scores">${scores}</div>
      ${banner}
      <div class="stage">
        <h2>${turnTitle}</h2>
        <div class="stats">
          <div class="stat"><div class="hearts">${hearts(t.damage)}</div><div class="l">Health ${Math.max(0, START_HEALTH - t.damage)}/${START_HEALTH}${t.shield ? ' · 🛡️' : ''}${t.cursed ? ` · 🕯️ cursed (${t.cursed})` : ''}</div></div>
          <div class="stat"><div class="v haul">${t.haul}</div><div class="l">Haul</div></div>
        </div>
        <div class="table" id="table">${table}</div>
        ${controls}
      </div>
      <div class="log">${g.log.slice().reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div>
      <div style="margin-top:14px">${rulesHTML(false)}</div>
      ${mine && t.choice ? choiceModal(g, t.choice) : ''}`;

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    on('delve', () => sendMsg({ type: 'delve' }));
    on('escape', () => sendMsg({ type: 'escape' }));
    on('skip', () => sendMsg({ type: 'skip' }));
    on('roll', () => sendMsg({ type: 'roll' }));
    document.querySelectorAll('[data-target]').forEach(b => {
      b.onclick = () => sendMsg({ type: 'choose', target: b.dataset.target });
    });
  }

  const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  function choiceModal(g, c) {
    const me = g.players.find(p => p.id === state.you);
    let title;
    if (c.kind === 'ambush') title = '🏹 Ambush! Who skips their next turn?';
    else if (c.kind === 'plunder') title = '🏴‍☠️ Plunder! Whose gold do you take half of?';
    else if (!c.roll) {
      return `<div class="modal-bg"><div class="modal">
        <h3>🎲 Toll! Roll to see how much gold you pay</h3>
        <button id="roll">🎲 Roll the die</button>
      </div></div>`;
    } else {
      const owed = Math.min(c.roll, g.turn.haul + me.banked);
      title = `<div class="die">${DIE[c.roll]}</div>You rolled a ${c.roll}. Who gets your ${owed} gold?`;
    }
    const targets = g.players.filter(p => c.targets.includes(p.id));
    return `<div class="modal-bg"><div class="modal">
      <h3>${title}</h3>
      ${targets.map(p => `<button class="secondary" data-target="${esc(p.id)}">${esc(p.name)} · ${p.banked} gold</button>`).join('')}
    </div></div>`;
  }

  function renderResults() {
    screen = 'over';
    const g = state.game;
    const sorted = g.players.slice().sort((a, b) => b.banked - a.banked);
    const winnerNames = sorted.filter(p => g.winners.includes(p.id)).map(p => esc(p.name));
    const iWon = g.winners.includes(state.you);
    const best = Math.max(...g.players.map(p => p.bestEscape));
    app.innerHTML = `
      <div class="results">
        <div class="trophy">${iWon ? '🏆' : '⚰️'}</div>
        <h2 class="center">${winnerNames.length > 1 ? `${winnerNames.join(' & ')} share the win!` : `${winnerNames[0]} wins!`}</h2>
        <div class="panel" style="margin-top:14px">
          <table>
            <tr><th>Player</th><th class="n">Gold</th><th class="n">Best escape</th></tr>
            ${sorted.map(p => `<tr><td>${g.winners.includes(p.id) ? '👑 ' : ''}${esc(p.name)}</td>
              <td class="n" style="color:var(--gold)">${p.banked}</td>
              <td class="n">${p.bestEscape}${p.bestEscape === best && best > 0 ? ' ⭐' : ''}</td></tr>`).join('')}
          </table>
          <div class="muted" style="font-size:13px">Best escape is the biggest haul banked in a single turn.</div>
        </div>
        <div style="margin-top:14px"><button id="again">Play again</button></div>
        <div class="center" style="margin-top:10px"><button id="leave" class="secondary small">Leave room</button></div>
        <div class="log">${g.log.slice().reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div>
      </div>`;
    document.getElementById('again').onclick = () => sendMsg({ type: 'again' });
    document.getElementById('leave').onclick = leaveRoom;
  }

  render();
  connect();
})();
