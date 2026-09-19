# Roblox Milestone Leaderboard — GitHub Pages

Эта версия предназначена именно для **GitHub Pages**. Отдельный Node.js сервер не нужен.

GitHub Actions периодически читает Roblox DataStore `Sekretochka`, строит `site/data/leaderboard.json`, после чего публикует папку `site` в GitHub Pages. Сам API-ключ в браузер не попадает.

## Что собирается

Universe: `10764295351`

DataStore: `Sekretochka`

Ключ игрока: `Data_<UserId>`

Поля:

- `Achievements.SurvivorsMilestones`
- `Achievements.KillersMilestones`

Для каждого персонажа показывается максимальный Milestone среди всех записей. При одинаковом максимуме показываются все игроки с этим результатом.

## 1. Загрузи проект в GitHub

Положи содержимое этой папки в корень репозитория и отправь в ветку `main` (поддерживается также `master`).

Важно: папка `.github` должна попасть в репозиторий — в ней находится workflow.

## 2. Добавь API key как Secret

В репозитории GitHub открой:

`Settings -> Secrets and variables -> Actions -> New repository secret`

Имя:

`ROBLOX_API_KEY`

Значение: твой Roblox Open Cloud API key.

**Не добавляй ключ в код, `.env` или `leaderboard.json`.**

Для ключа нужны только права DataStore:

- `universe-datastores.objects:list`
- `universe-datastores.objects:read`

на Universe `10764295351` / DataStore `Sekretochka`.

### Важно про IP restriction

Если у Roblox API key включено `Restrict IP addresses`, GitHub-hosted Actions могут не пройти проверку, потому что runner запускается с меняющихся адресов. Для этой схемы обычно нужно оставить IP restriction выключенным. При этом ключ всё равно должен иметь минимальные read/list permissions и храниться только в GitHub Secret.

## 3. Включи GitHub Pages

Открой:

`Settings -> Pages`

В `Build and deployment` выбери:

`Source: GitHub Actions`

## 4. Запусти первый сбор данных

Открой вкладку:

`Actions -> Deploy Milestone Leaderboard -> Run workflow`

После успешного выполнения GitHub покажет ссылку на Pages.

Workflow также запускается:

- при push в `main` или `master`;
- автоматически каждые 15 минут;
- вручную через `Run workflow`.

GitHub может запускать scheduled workflow с небольшой задержкой — это нормально.

## Где смотреть ошибки

`Actions -> Deploy Milestone Leaderboard -> нужный run -> build -> Generate leaderboard JSON`

Полезные строки:

```text
[leaderboard] Listed 350 total entries; 348 matched Data_<UserId>.
[leaderboard] Reading 348 player entries with concurrency 8...
[leaderboard] Scanned 347 players; 1 read failures.
```

Если `403`, проверь API key, разрешения и IP restriction.

Если entries есть, но `0 matched Data_<UserId>`, значит ключи DataStore отличаются от ожидаемого `Data_<числовой UserId>`.

## Локальная проверка генератора

Можно создать `.env`/переменные окружения и запустить:

```bash
npm run update
```

После этого результат будет в `site/data/leaderboard.json`.

Для локального просмотра лучше использовать любой статический HTTP server, а не открывать `index.html` через `file://`.
