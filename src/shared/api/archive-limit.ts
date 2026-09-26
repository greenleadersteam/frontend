// 100 МиБ (2^20 байт), как GREENPLAN_API_MAX_UPLOAD_MB=100 в docker-compose бэкенда:
// ../backend/docker-compose.yml:15, проверка — ../backend/greenplan/api/app.py:122.
export const MAX_ARCHIVE_BYTES = 104_857_600;
