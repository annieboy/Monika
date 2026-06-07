#!/bin/sh
# PostgreSQL backup script — dumps to a timestamped .sql.gz file.
# Optionally uploads to S3 if AWS_S3_BACKUP_BUCKET is set.
#
# Usage:
#   ./scripts/backup.sh
#   AWS_S3_BACKUP_BUCKET=my-bucket ./scripts/backup.sh
set -e

: "${DATABASE_URL:?DATABASE_URL is required}"

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILENAME="monika-backup-${TIMESTAMP}.sql.gz"
BACKUP_DIR="${BACKUP_DIR:-/tmp/backups}"

mkdir -p "$BACKUP_DIR"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

echo "[backup] Dumping database to ${FILEPATH}..."
pg_dump "$DATABASE_URL" | gzip > "$FILEPATH"
echo "[backup] Dump complete ($(du -sh "$FILEPATH" | cut -f1))"

if [ -n "${AWS_S3_BACKUP_BUCKET:-}" ]; then
  S3_KEY="${AWS_S3_BACKUP_PREFIX:-backups}/${FILENAME}"
  echo "[backup] Uploading to s3://${AWS_S3_BACKUP_BUCKET}/${S3_KEY}..."
  aws s3 cp "$FILEPATH" "s3://${AWS_S3_BACKUP_BUCKET}/${S3_KEY}" --storage-class STANDARD_IA
  echo "[backup] Upload complete"

  # Keep only last 7 local copies
  ls -t "${BACKUP_DIR}"/monika-backup-*.sql.gz | tail -n +8 | xargs -r rm --
fi

echo "[backup] Done: ${FILEPATH}"
