#!/bin/bash
# Daily SQLite backup to S3-compatible storage (Timeweb)
# Runs via cron at 3:00 AM

set -e

DB_PATH="/app/prisma/data.db"
BACKUP_DIR="/tmp/backups"
DATE=$(date +%Y-%m-%d_%H%M)
BACKUP_FILE="data_${DATE}.db"

mkdir -p "$BACKUP_DIR"

# Create consistent backup using SQLite .backup command
sqlite3 "$DB_PATH" ".backup '${BACKUP_DIR}/${BACKUP_FILE}'"

# Upload to S3 if credentials are set
if [ -n "$S3_BUCKET" ] && [ -n "$S3_ACCESS_KEY" ]; then
  # Install aws-cli if not present
  if ! command -v aws &> /dev/null; then
    pip install awscli 2>/dev/null
  fi

  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY"
  export AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY"

  aws s3 cp "${BACKUP_DIR}/${BACKUP_FILE}" \
    "s3://${S3_BUCKET}/backups/${BACKUP_FILE}" \
    --endpoint-url "${S3_ENDPOINT:-https://s3.timeweb.cloud}" \
    --region "${S3_REGION:-ru-1}"

  echo "[$(date)] Backup uploaded: ${BACKUP_FILE}"
else
  echo "[$(date)] S3 not configured, backup saved locally: ${BACKUP_DIR}/${BACKUP_FILE}"
fi

# Clean up local backups older than 7 days
find "$BACKUP_DIR" -name "data_*.db" -mtime +7 -delete 2>/dev/null || true
