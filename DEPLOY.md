# Деплой в продакшн

Боевой сервер — VPS на Timeweb (Ubuntu 24.04), приложение крутится в Docker
Compose. Деплой = «обновить код из GitHub и пересобрать контейнер на сервере».

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

- `docker-compose.yml` собирает образ из `web/Dockerfile` и публикует порт `80:3000`.
- Образ — один контейнер: Next.js + Python-солвер (OR-Tools).
- **Миграции БД применяются автоматически** при старте контейнера:
  команда контейнера выполняет `npx prisma migrate deploy` перед `npm start`.
  Отдельно мигрировать руками не нужно — достаточно пересобрать/перезапустить.
- `prisma` лежит в обычных `dependencies`, поэтому переживает `npm prune` и
  доступен в проде.

## Полный цикл деплоя

### 1. Локально: закоммитить и запушить

```bash
# из корня репозитория
git add -A
git commit -m "описание изменений"
git push origin main
```

Перед пушем убедись, что прод-сборка проходит локально:

```bash
cd web && npx next build
```

### 2. На сервере: бэкап БД, обновление кода, пересборка

```bash
ssh root@72.56.35.166
cd /opt/raspisoshlyapa

# 1) ВСЕГДА бэкапим боевую БД перед миграциями
cp data/data.db "data/data_backup_$(date +%F_%H%M).db"

# 2) на этом маленьком сервере ОБЯЗАТЕЛЬНО чистим build cache,
#    иначе сборка падает с "no space left on device"
docker builder prune -af
docker image prune -f

# 3) подтягиваем код
git pull --ff-only origin main

# 4) пересобираем и перезапускаем (миграция применится сама на старте)
docker compose up -d --build
```

### 3. Проверка

```bash
# логи: должно быть "migration(s) have been applied" и "✓ Ready"
docker logs raspisoshlyapa-web-1 2>&1 | tail -30

# состояние миграций
docker exec raspisoshlyapa-web-1 npx prisma migrate status

# HTTP
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/login   # → 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/health
```

## Подводные камни этого сервера

- **Мало диска (14 ГБ).** Build cache + старый образ + новый образ не
  помещаются вместе. Перед `docker compose up --build` всегда выполняй
  `docker builder prune -af`. Симптом проблемы:
  `failed to extract layer ... no space left on device`.
- **Мало RAM (1 ГБ).** `next build` использует heap до 1.5 ГБ и активно
  свопит — сборка идёт ~10–13 минут и сильно грузит машину.
- **SSH может отвалиться во время сборки** («Connection closed by remote
  host») из-за нагрузки. Это НЕ прерывает сборку: процесс
  `docker compose up -d --build` продолжается на сервере. Просто переподключись
  и проверь статус:

  ```bash
  docker ps                  # контейнер должен стать "Up X minutes" на новом образе
  ps aux | grep "compose up" # если ещё идёт — сборка не закончилась, подожди
  ```

  Чтобы заранее обезопаситься от обрыва, можно запускать сборку устойчиво к
  разрыву сессии:

  ```bash
  nohup docker compose up -d --build > /tmp/deploy.log 2>&1 &
  tail -f /tmp/deploy.log
  ```

## Откат

1. Остановить контейнер: `docker compose down`.
2. Вернуть БД из бэкапа (если миграция испортила данные):
   `cp data/data_backup_ГГГГ-ММ-ДД_ЧЧММ.db data/data.db`.
3. Откатить код: `git reset --hard <предыдущий_коммит>` и снова
   `docker compose up -d --build`.

## Бэкапы БД

- Ручной: команда `cp data/data.db ...` из раздела выше.
- Автоматический: `web/scripts/backup.sh` (cron, 03:00) — `.backup` SQLite и
  загрузка в S3 Timeweb, если заданы переменные `S3_*`.
- Чистка старых ручных бэкапов: `find data -name 'data_backup_*.db' -mtime +14 -delete`.
