# Roblox Milestone Leaderboard

Простой leaderboard для DataStore `Sekretochka` в Universe `10764295351`.

Он перебирает ключи `Data_<UserId>`, читает только:

- `Achievements.SurvivorsMilestones`
- `Achievements.KillersMilestones`

и показывает максимальный milestone по каждому персонажу. Если максимум одинаковый у нескольких игроков, показываются все.

## 1. Требования

- Node.js 20+
- Roblox Open Cloud API key
- Для DataStore `Sekretochka` у ключа должны быть права:
  - `universe-datastores.objects:list`
  - `universe-datastores.objects:read`

## 2. Настройка

Скопируй `.env.example` в `.env`:

```bash
cp .env.example .env
```

На Windows можно просто сделать копию файла вручную и переименовать её в `.env`.

В `.env` вставь ключ:

```env
ROBLOX_API_KEY=ТВОЙ_КЛЮЧ
UNIVERSE_ID=10764295351
DATASTORE_NAME=Sekretochka
PORT=3000
CACHE_TTL_MS=300000
ROBLOX_READ_CONCURRENCY=8
```

Не отправляй `.env` в GitHub и никому не показывай API key.

## 3. Запуск

```bash
npm install
npm start
```

Открой:

```text
http://localhost:3000
```

## Как работает кэш

Сервер пересчитывает таблицу примерно раз в 5 минут (`CACHE_TTL_MS=300000`). Браузер запрашивает готовую таблицу, а не сканирует DataStore самостоятельно.

## Если Roblox отвечает 401/403

Проверь API key и права на Universe/DataStore. Нужны list + read именно для `Sekretochka`.

## Если в таблице только нули

Проверь, что записи действительно имеют ключи вида `Data_<числовой UserId>` и внутри есть `Achievements.SurvivorsMilestones` / `Achievements.KillersMilestones`.
