# Деплой в продакшн

Боевой сервер — VPS на Timeweb (Ubuntu 24.04), приложение крутится в Docker
Compose.

**Образ собирается в CI (GitHub Actions) и публикуется в GHCR. Сервер НЕ
собирает — он только тянет готовый образ.** Это убирает 10–13-минутную сборку
на слабом сервере (раньше она падала по памяти/диску).

Деплой = `git push` (CI соберёт образ) → на сервере `./redeploy.sh`
(тянет образ и перезапускает за ~15 секунд).

## Координаты сервера

| Параметр | Значение |
|----------|----------|
| Публичный IP | `72.56.35.166` |
| SSH | `ssh root@72.56.35.166` |
| Root-пароль | в панели Timeweb (в git НЕ хранится) |
| Каталог проекта | `/opt/raspisoshlyapa` |
| Сайт | http://72.56.35.166 (порт 80 → контейнер 3000) |
| БД | SQLite-файл `data/data.db` (том, монтируется в `/app/data`) |

Характеристики маленькие: **1 ГБ RAM + 2 ГБ swap, диск 14 ГБ**. Это влияет на
сборку (см. «Подводные камни»).

## Как это устроено

- Образ — один контейнер: Next.js + Python-солвер (OR-Tools), порт `80:3000`.
- **CI** (`.github/workflows/deploy.yml`) на каждый push в `main` собирает образ
  и пушит в GHCR двумя тегами: `:latest` и `:<sha>` (для отката).
- `docker-compose.yml` на сервере использует `image:` из GHCR (`docker compose
  pull`), а `build:` оставлен как локальный фолбэк.
- **Миграции БД применяются автоматически** при старте контейнера:
  команда контейнера выполняет `npx prisma migrate deploy` перед `npm start`.
- `prisma` лежит в обычных `dependencies`, поэтому переживает `npm prune` и
  доступен в проде.

## Разовая настройка CI (делается ОДИН раз через веб-GitHub)

1. **Actions включены.** Репозиторий → Settings → Actions → General →
   «Allow all actions». Обычно уже включено.
2. **Первый прогон.** После первого push в `main` workflow «Build & push image»
   соберёт образ и создаст GHCR-пакет `raspisoshlyapa`.
3. **Сделать пакет публичным** (чтобы сервер тянул без логина):
   GitHub → профиль → Packages → `raspisoshlyapa` → Package settings →
   Change visibility → Public.
   (Альтернатива — оставить приватным и один раз залогинить сервер:
   `echo <GHCR_PAT> | docker login ghcr.io -u StrawMD --password-stdin`.)

## Обычный цикл деплоя

### 1. Локально

```bash
cd web && npx next build      # убедиться, что прод-сборка проходит
git add -A && git commit -m "..." && git push origin main
```

Push запускает CI. Дождись зелёного прогона во вкладке **Actions**
(сборка ~2–4 мин на раннере GitHub).

### 2. На сервере — один скрипт

```bash
ssh root@72.56.35.166
cd /opt/raspisoshlyapa
./redeploy.sh        # бэкап БД + pull образа + рестарт + чистка + логи
```

`redeploy.sh` делает: бэкап `data.db`, `git pull`, `docker compose pull`,
`docker compose up -d` (миграции применятся на старте), `docker image prune`.

### 3. Проверка

```bash
docker compose logs --tail=30 web    # "migration(s) applied" / "up to date" + "✓ Ready"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/login        # → 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/health   # → 200
```

## Если нужно собрать ПРЯМО на сервере (фолбэк без CI)

Слабый сервер (1 ГБ RAM, 14 ГБ диск) еле тянет `next build`, поэтому:

```bash
docker builder prune -af && docker image prune -f   # иначе "no space left on device"
nohup docker compose up -d --build > /tmp/deploy.log 2>&1 &   # устойчиво к обрыву SSH
tail -f /tmp/deploy.log
```

SSH может отвалиться во время такой сборки — это её НЕ прерывает
(процесс `docker compose` живёт дальше), просто переподключись и проверь
`docker ps`.

## Откат

Образы тегируются по коммиту, поэтому откат — без пересборки:

```bash
cd /opt/raspisoshlyapa
WEB_IMAGE=ghcr.io/strawmd/raspisoshlyapa:<предыдущий_sha> docker compose up -d
```

Если миграция испортила данные — вернуть БД из бэкапа:

```bash
docker compose down
cp data/data_backup_ГГГГ-ММ-ДД_ЧЧММ.db data/data.db
docker compose up -d
```

## Бэкапы БД (Timeweb S3, ежедневно)

Боевая БД ежедневно бэкапится в Timeweb S3 (бакет `cb8c8af2-...336635`,
endpoint `https://s3.twcstorage.ru`, регион `ru-1`).

- **Инструмент:** `rclone` (S3-remote `tws3`, конфиг `/root/.config/rclone/rclone.conf`,
  права 600 — там ключи доступа, в git НЕ хранятся).
- **Скрипт:** `/opt/raspisoshlyapa/backup-to-s3.sh` — консистентный снимок
  `sqlite3 .backup` внутри контейнера → gzip → заливка как
  `backups/data_<дата>.db.gz` → удаление в S3 копий старше 30 дней.
- **Расписание:** cron `0 3 * * *` (03:00 UTC = 06:00 МСК),
  лог `/var/log/db-backup.log`.
- **Размер:** ~24 КБ на бэкап (gzip). За год ежедневных — порядка 9 МБ.

Скрипт `backup-to-s3.sh` (если нужно воссоздать):

```bash
#!/usr/bin/env bash
set -euo pipefail
PROJECT=/opt/raspisoshlyapa
CONTAINER=raspisoshlyapa-web-1
REMOTE="tws3:cb8c8af2-e69f-45d2-af21-f096fe336635/backups"
RETENTION="30d"
cd "$PROJECT"; TS=$(date +%F_%H%M); SNAP="_snapshot_${TS}.db"
docker exec "$CONTAINER" sqlite3 /app/data/data.db ".backup /app/data/${SNAP}"
gzip -f "data/${SNAP}"
rclone copyto "data/${SNAP}.gz" "${REMOTE}/data_${TS}.db.gz" --s3-no-check-bucket
rm -f "data/${SNAP}.gz"
rclone delete --min-age "$RETENTION" "$REMOTE" 2>/dev/null || true
echo "[$(date)] backup uploaded: data_${TS}.db.gz"
```

rclone-конфиг `/root/.config/rclone/rclone.conf` (ключи — из панели Timeweb S3):

```ini
[tws3]
type = s3
provider = Other
access_key_id = <S3 Access Key>
secret_access_key = <S3 Secret Key>
endpoint = https://s3.twcstorage.ru
region = ru-1
acl = private
```

Запустить бэкап вручную: `/opt/raspisoshlyapa/backup-to-s3.sh`.

### Восстановление из S3

```bash
cd /opt/raspisoshlyapa
rclone lsf tws3:cb8c8af2-e69f-45d2-af21-f096fe336635/backups/        # список бэкапов
rclone copyto tws3:cb8c8af2-e69f-45d2-af21-f096fe336635/backups/data_<дата>.db.gz data/_restore.db.gz
gunzip -f data/_restore.db.gz
docker exec raspisoshlyapa-web-1 sqlite3 /app/data/_restore.db "PRAGMA integrity_check;"
docker compose down
cp data/_restore.db data/data.db && rm -f data/_restore.db
docker compose up -d
```
