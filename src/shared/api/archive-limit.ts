// 100 МиБ (2^20 байт), как GREENPLAN_API_MAX_UPLOAD_MB=100 в docker-compose бэкенда:
// d11793e:docker-compose.yml:15 (с 7223e2e compose — в репозитории ci, значение не сверено), проверка — ../backend/greenplan/api/app.py:122.
export const MAX_ARCHIVE_BYTES = 104_857_600;
