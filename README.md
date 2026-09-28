# Озеленение — веб-клиент

Веб-клиент сервиса автоматического проектирования озеленения: загрузка подосновы, просмотр и проверка плана посадок с нормативными обоснованиями, правки, выгрузки и геопривязка чертежа. Документация — в [docs/](docs/README.md).

## Требования

- Node.js 24.11 или новее и npm 11.20 или новее. Версия Node закреплена в `.nvmrc`.
- Либо Docker — для сборки в образе.
- Браузер на базе Chromium или Firefox ESR с включённым WebGL.

## Запуск для проверки без сервера

```sh
npm ci
npm run dev
```

1. Откройте <http://localhost:5173>.
2. Переключите «Сервер» на «Демо» в шапке. Все функции работают на демонстрационных данных прямо в браузере; сервер не нужен.
3. Для сценария проверки подойдут:
   - «Сквер на Покровке» — план на карте, проверки, правки, ведомость, отчёт;
   - «Улица Шаболовка, 37» — проект без геопривязки и «Привязать к карте»;
   - «Улица Бахрушина, 11» — проект, упавший на геопривязке, и «Привязать вручную».

Сразу в режиме «Демо» открывается `npm run dev:mock` или адрес с параметром `?data=demo`.

Подложка карты в разработке берётся из файла `.data/basemap/moscow.pmtiles` (см. «Подложка без интернета»). Без него карта работает без подложки.

## Запуск против сервера

### Dev-сервер

```sh
cp .env.example .env
# в .env: API_PROXY_TARGET=https://адрес-сервера
npm run dev
```

Dev-сервер проксирует `/api/*` на `API_PROXY_TARGET`, срезая префикс `/api`. По умолчанию это `https://backend.greenleaders.online`. Переменная в сборку не попадает.

`/config.json` в разработке отдаётся из `config.dev.json`: в нём включены «Демо» и космоснимок.

### Docker

`Dockerfile` собирает приложение в образе Node 24 (`npm ci`, `npm run build`). Финальный образ при запуске очищает каталог `/out` (`rm -rf /out/*`), копирует туда содержимое `dist` и завершается. Поэтому в `/out` монтируется отдельный том только для сборки: всё остальное в нём будет удалено. Пример вручную (имя образа и тома — произвольные):

```sh
docker build -t greenplan-frontend .
docker run --rm -v frontend_data:/out greenplan-frontend
```

Своего веб-сервера в образе нет. На стенде том `frontend_data` раздаёт Caddy: он отдаёт статику, `/config.json` и подложку `/basemap/`, а `/api/*` проксирует на сервер расчёта. Конфигурация Caddy, `docker-compose.yml` и порядок выкладки — в репозитории `ci` (`docker-compose.yml`, `DEPLOY.md`). Выкладка на стенд — workflow `.github/workflows/deploy.yml`: проверки, затем `docker compose up -d --build frontend` на виртуальной машине.

Для раздачи нужно:

- **Один origin.** Приложение и `/api` должны быть на одном origin.
- **SPA-маршруты.** Для путей приложения (`/projects/…`, `/georeference`) отдаётся `index.html`.
- **Подложка** `/basemap/*.pmtiles`:
  - отдаётся с поддержкой Range (ответ 206);
  - `Content-Type: application/vnd.pmtiles`;
  - без сжатия.
- **Кэширование.**
  - Ассеты с хешем в имени — `Cache-Control: public, max-age=31536000, immutable`.
  - `index.html` и `config.json` — `no-cache`.
- **Заголовки безопасности.**
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://server.arcgisonline.com; font-src 'self'; connect-src 'self' https://server.arcgisonline.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. Адрес `server.arcgisonline.com` нужен только для космоснимка.
  - `X-Content-Type-Options: nosniff`.
  - `Referrer-Policy: strict-origin-when-cross-origin`.
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
  - `Cross-Origin-Opener-Policy: same-origin`.
  - HSTS — на TLS-терминаторе.

## config.json

Настройки контура — файл `/config.json`, который приложение читает при запуске. Один образ разворачивается в любом контуре: меняется только этот файл. Сборка кладёт в `dist` вариант из `public/config.json`.

Конфиг проверяется при старте. Если он не прошёл проверку — опечатка в имени поля, адрес не на своём origin, неверный шаблон тайлов, — приложение показывает экран ошибки с причиной.

| Поле                 | Обязательно               | Значение                                                                                                                                                                                                                                                                                                                                 | Пример                      |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `apiBaseUrl`         | да                        | Путь к API на том же origin, начинается с `/`                                                                                                                                                                                                                                                                                            | `"/api"`                    |
| `basemapUrl`         | да                        | Путь к файлу подложки PMTiles на том же origin; `null` — без подложки                                                                                                                                                                                                                                                                    | `"/basemap/moscow.pmtiles"` |
| `imagery`            | нет, по умолчанию `null`  | Космоснимок для модуля геопривязки: `tilesUrl` и `labelsUrl` — `https://` с шаблоном `{z}/{y}/{x}`, `attribution` — подпись. `null` — снимка нет, приложение не обращается ни к одному внешнему адресу                                                                                                                                   | см. ниже                    |
| `demoMode`           | нет, по умолчанию `"off"` | `"available"` — переключатель «Сервер» / «Демо» в шапке; `"off"` — только сервер, код демо не загружается                                                                                                                                                                                                                                | `"available"`               |
| `serverCapabilities` | нет, по умолчанию `[]`    | Что сервер умеет сверх базового API. Допустимые значения: `obstacles`, `rejected`, `norms`, `explanationChecks`, `species`, `plantingEdits`, `editedDxf`, `runs`, `manualGeoreference`, `optionalBbox`. Неизвестные пропускаются с предупреждением в консоли. Что включает каждое — в [docs/scope.md](docs/scope.md#возможности-сервера) | `[]`                        |

Стенд для экспертов — с «Демо» и космоснимком:

```json
{
  "apiBaseUrl": "/api",
  "basemapUrl": "/basemap/moscow.pmtiles",
  "imagery": {
    "tilesUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "labelsUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    "attribution": "Powered by Esri; Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community; Labels: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community"
  },
  "demoMode": "available",
  "serverCapabilities": []
}
```

Закрытый контур без интернета — без «Демо» и без внешних адресов:

```json
{
  "apiBaseUrl": "/api",
  "basemapUrl": "/basemap/moscow.pmtiles",
  "imagery": null,
  "demoMode": "off",
  "serverCapabilities": []
}
```

Когда сервер реализует функции контракта-предложения, их имена добавляются в `serverCapabilities`. Пересобирать образ не нужно.

## Подложка без интернета

Подложка «Схема» — один файл PMTiles с векторными тайлами OpenStreetMap по схеме Protomaps, вырезанный по охвату Москвы. MapLibre читает его по Range-запросам с того же сервера, поэтому интернет не нужен.

Вырезать файл из сборки Protomaps можно утилитой `pmtiles` (<https://github.com/protomaps/go-pmtiles>). Охват — как у карты в приложении (`BASEMAP_BOUNDS`, `src/shared/config/basemap.ts`), масштабы — до 15-го: дальше карта растягивает тайлы 15-го масштаба (приближать её можно до 20-го, `MAP_MAX_ZOOM`):

```sh
pmtiles extract https://build.protomaps.com/<дата сборки>.pmtiles moscow.pmtiles \
  --bbox=36.6,54.95,38.2,56.2 --maxzoom=15
```

Список сборок — <https://docs.protomaps.com/basemaps/downloads>. Файл на стенде весит 139 316 456 байт (по заголовку `Content-Range` ответа стенда 28.09.2026). Вырезать можно на машине с интернетом и перенести в контур.

Куда положить:

- **Разработка** — `.data/basemap/moscow.pmtiles`: его отдаёт dev-сервер (`vite-plugins/serve-basemap.ts`).
- **Развёртывание** — туда, откуда Caddy отдаёт `/basemap/moscow.pmtiles`. Путь задаётся полем `basemapUrl`.

Без файла или с `"basemapUrl": null` карта работает без подложки: план, слои и проверки на месте, в углу карты — «Подложка не загружена». Шаг «Участок» мастера загрузки тогда предлагает ввести координаты углов вручную.

Данные OpenStreetMap — по лицензии Open Database License (ODbL 1.0), <https://www.openstreetmap.org/copyright>. Подпись «© участники OpenStreetMap, Protomaps» на карте обязательна.

## Проверки

```sh
npm run typecheck     # проверка типов TypeScript (tsc -b), строгий режим
npm run lint          # ESLint и steiger: правила кода, доступность, границы слоёв архитектуры
npm run format:check  # Prettier: форматирование
npm test              # Vitest: модульные тесты и тесты экранов в jsdom
npm run build         # сборка в dist
```

Все пять проверок выполняются в CI (`.github/workflows/deploy.yml`) на пуш в `main`, на запрос на слияние и по ручному запуску. После `npm run build` сборку можно посмотреть командой `npm run preview`: она отдаёт `dist` с целевой CSP из `vite.config.ts` — той, что указана выше.

## Контракт API

- **Контракт сервера** — OpenAPI сервера. Типы по нему лежат в `src/shared/api/generated/schema.d.ts` и обновляются командой `npm run api:generate`: она скачивает `https://backend.greenleaders.online/openapi.json`, поэтому нужен интернет. Сгенерированный файл коммитится: сборка в закрытом контуре в сеть не ходит.
- **Контракт-предложение** — `contracts/openapi.proposed.yaml`: запросы, которых на сервере ещё нет, но которые клиент уже умеет. Он передан разработчику сервера. Типы по нему — `src/shared/api/generated/proposed.d.ts`, команда `npm run api:generate:proposed`.
- **Нормы и породы** сверены с первоисточниками в `contracts/norms-verified.md` и `contracts/species-verified.md`.
