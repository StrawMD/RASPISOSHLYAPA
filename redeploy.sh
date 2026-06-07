#!/usr/bin/env bash
# Быстрый редеплой на боевом сервере БЕЗ сборки.
# Образ уже собран в CI и лежит в GHCR — мы его просто тянем.
#
# Использование (на сервере, в /opt/raspisoshlyapa):
#   ./redeploy.sh                 # последний образ (:latest)
#   WEB_IMAGE=ghcr.io/strawmd/raspisoshlyapa:<sha> ./redeploy.sh   # откат на конкретный
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Бэкап БД"
if [ -f data/data.db ]; then
  cp data/data.db "data/data_backup_$(date +%F_%H%M).db"
fi

echo "==> Обновляем код (docker-compose.yml, скрипты)"
git pull --ff-only origin main || echo "  (git pull пропущен)"

echo "==> Тянем свежий образ из GHCR"
docker compose pull

echo "==> Перезапускаем контейнер (миграции применятся на старте)"
docker compose up -d

echo "==> Чистим старые образы"
docker image prune -f >/dev/null 2>&1 || true

echo "==> Готово. Логи:"
docker compose logs --tail=20 web
