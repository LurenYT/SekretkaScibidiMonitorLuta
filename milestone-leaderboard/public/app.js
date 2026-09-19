const rowsEl = document.querySelector('#rows');
const statusEl = document.querySelector('#status');
const metaEl = document.querySelector('#meta');
const emptyEl = document.querySelector('#empty');
const tabs = [...document.querySelectorAll('.tab')];

let data = null;
let activeTab = 'survivors';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function playerHtml(player) {
  const username = escapeHtml(player.username || `User ${player.userId}`);
  const userId = encodeURIComponent(player.userId);
  return `<a class="player" href="https://www.roblox.com/users/${userId}/profile" target="_blank" rel="noreferrer">${username}</a>`;
}

function render() {
  if (!data) return;
  const rows = data[activeTab] || [];

  rowsEl.innerHTML = rows.map((row, index) => {
    const players = row.players?.length
      ? `<div class="players">${row.players.map(playerHtml).join('')}</div>`
      : '<span class="no-player">—</span>';

    return `
      <tr>
        <td>${index + 1}</td>
        <td class="character">${escapeHtml(row.character)}</td>
        <td><span class="level ${row.level === 0 ? 'zero' : ''}">${escapeHtml(row.level)}</span></td>
        <td>${players}</td>
      </tr>
    `;
  }).join('');

  emptyEl.classList.toggle('hidden', rows.length > 0);
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    for (const item of tabs) item.classList.toggle('active', item === tab);
    render();
  });
}

async function load() {
  statusEl.textContent = 'Загрузка…';
  statusEl.classList.remove('error');

  try {
    const response = await fetch('/api/leaderboard', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.details || body.error || `HTTP ${response.status}`);

    data = body;
    render();

    const time = new Date(body.generatedAt).toLocaleString('ru-RU');
    statusEl.textContent = body.stale ? 'Показан кэш' : 'Актуально';
    if (body.stale) statusEl.classList.add('error');
    metaEl.textContent = `Игроков проверено: ${body.scannedPlayers} · обновлено: ${time}${body.failedEntries ? ` · ошибок чтения: ${body.failedEntries}` : ''}`;
  } catch (error) {
    statusEl.textContent = 'Ошибка загрузки';
    statusEl.classList.add('error');
    rowsEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    emptyEl.textContent = error.message;
    metaEl.textContent = '';
  }
}

load();
setInterval(load, 60_000);
