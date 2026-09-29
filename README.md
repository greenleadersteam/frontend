# Московские посадки — веб-клиент

Веб-клиент сервиса автоматического проектирования озеленения города с учётом подземных коммуникаций. Команда Green Leaders, ЛЦТ-2026.

Эксперт загружает подоснову в DXF, получает план посадок деревьев и кустарников с нормативными отступами и проверяет каждую посадку: какая норма, какой пункт акта, какое фактическое расстояние. Дальше он правит расстановку и выгружает результат — DXF с отдельным слоем, ведомость, отчёт для согласования.

- **Стенд:** <https://app.greenleaders.online>
- **Сервер расчёта** (бэкенд, алгоритм, CLI): <https://github.com/greenleadersteam/backend>, Swagger — <https://backend.greenleaders.online/docs>
- **Развёртывание** (Docker Compose, Caddy): <https://github.com/greenleadersteam/ci>
- **Документация, руководство пользователя, презентация:** <https://greenleaders.online>
- **Документация репозитория:** [docs/](docs/README.md)

## Что умеет

| Возможность          | Что видит пользователь                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Загрузка             | Мастер: название → участок на карте (поиск по адресу или координатам) → архив ZIP или DXF. Проверка архива в браузере до отправки, этапы обработки на сервере                                               |
| План на карте        | Посадки, зоны «можно» и «нельзя» отдельно для деревьев и кустарников, газон, граница участка, исходные сети и здания. Подложки: «Схема», «Светлая», «Снимок», «Снимок с подписями»                          |
| Обоснование посадки  | Карточка посадки: правило расстановки; проверки до каждого объекта сети с фактическим расстоянием, нормой, актом и пунктом («ПП Москвы № 743-ПП, прил. 1, п. 3.6.3, табл. 3.6.1»); размерные линии на плане |
| Честность норм       | «Значение сервиса» отделено от нормы акта: если в акте прочерк, сервис держит консервативный отступ и прямо об этом пишет. Объекты без нормы перечислены в блоке «Не проверялось»                           |
| Независимая проверка | Браузер сам пересчитывает расстояния от посадки до сетей по геометрии сервера, с допуском 2 см                                                                                                              |
| Правка               | Перетаскивание, добавление и удаление посадок с проверкой норм на лету. Сохранение правок новой версией плана на сервере, выбор версии, DXF версии                                                          |
| Выгрузки             | DXF сервера со слоем `GREENING_PROPOSED`, ведомость (Excel, CSV), отчёт для согласования (печать в PDF), полная таблица проверок (Excel)                                                                    |
| Проверка DXF         | Сравнение исходного и выходного чертежа в браузере: «исходные слои не изменены», добавлен слой результата. Протокол в JSON                                                                                  |
| 3D                   | Схематичная 3D-визуализация участка по плану: «До / После», три ракурса, «Скачать визуализации» (ZIP из PNG)                                                                                                |
| Геопривязка          | Отдельный модуль: совмещение контура чертежа с картой, опорные точки, RMS и «светофор», выгрузка параметров привязки                                                                                        |
| Режимы               | «Сервер» — реальные проекты. «Демо» — демонстрационные данные в браузере и функции, которых сервер пока не поддерживает (отклонённые места, породы, выбор главного чертежа, ручная привязка проекта)        |

Интерфейс рассчитан на рабочую станцию (от 1280 px) и работает на экранах от 360 px.

## Стек

React 19 и React Compiler, TypeScript 6 в строгом режиме, Vite 8, Mantine 9, Redux Toolkit и RTK Query, React Router 8, MapLibre GL 6 и PMTiles, zod 4, fflate (ZIP и Excel в браузере), MSW 2 (режим «Демо»), Vitest 4, ESLint 9, steiger.

Архитектура — Feature-Sliced Design: `app` → `pages` → `widgets` → `features` → `entities` → `shared`. Границы слоёв проверяет `steiger`.

```text
src/
  app/        маршруты, store, провайдеры, загрузка config.json
  pages/      projects, project-new, project (план, ведомость, отчёт, 3D, проверка DXF), georeference
  widgets/    шапка приложения
  features/   правка расстановки, проверка DXF, поиск места, удаление проекта, выбор главного чертежа
  entities/   project (API, проверки норм, сборка DXF), georeference
  shared/     карта, тема, геодезия, геометрия, xlsx, zip, API и моки «Демо», конфиг
```

## Быстрый старт без сервера — режим «Демо»

Нужны Node.js 24.11+ и npm 11.20+ (версия закреплена в `.nvmrc`).

```sh
git clone https://github.com/greenleadersteam/frontend.git
cd frontend
npm ci
npm run dev:mock
```

Откройте <http://localhost:5173>. Все функции работают на демонстрационных данных прямо в браузере, сервер не нужен. Для проверки подойдут:

- «Сквер на Покровке» — план на карте, проверки, правки и версии, ведомость, отчёт, 3D;
- «Улица Шаболовка, 37» — проект без геопривязки и «Привязать к карте»;
- «Улица Бахрушина, 11» — проект, упавший на геопривязке, и «Привязать вручную».

Переключатель «Сервер / Демо» есть и в шапке. При переключении со страницы проекта открывается список проектов выбранного режима.

Подложка карты в разработке берётся из файла `.data/basemap/moscow.pmtiles` (см. «Подложка без интернета»). Без него карта работает без подложки.

## Запуск против сервера

### Dev-сервер

```sh
cp .env.example .env
# в .env: API_PROXY_TARGET=https://адрес-сервера (по умолчанию https://backend.greenleaders.online)
npm run dev
```

Dev-сервер проксирует `/api/*` на `API_PROXY_TARGET`, срезая префикс `/api`. Переменная в сборку не попадает. `/config.json` в разработке отдаётся из `config.dev.json`: в нём включены «Демо», космоснимок и поиск по адресу.

Сервер расчёта можно поднять локально по инструкции из [backend](https://github.com/greenleadersteam/backend): `docker build -t greenplan-backend . && docker run -p 8000:8000 -v greenplan_data:/data greenplan-backend`. Затем укажите `API_PROXY_TARGET=http://localhost:8000`.

### Docker

`Dockerfile` собирает приложение в образе Node 24 (`npm ci`, `npm run build`). Финальный образ при запуске очищает каталог `/out` (`rm -rf /out/*`), копирует туда содержимое `dist` и завершается. Поэтому в `/out` монтируется отдельный том только для сборки: всё остальное в нём будет удалено.

```sh
docker build -t greenplan-frontend .
docker run --rm -v frontend_data:/out greenplan-frontend
```

Своего веб-сервера в образе нет. На стенде том `frontend_data` раздаёт Caddy: он отдаёт статику, `/config.json` и подложку `/basemap/`, а `/api/*` проксирует на сервер расчёта. Конфигурация Caddy и `docker-compose.yml` — в репозитории [ci](https://github.com/greenleadersteam/ci). Выкладка на стенд — workflow `.github/workflows/deploy.yml`: пять проверок, затем `docker compose up -d --build frontend` на виртуальной машине.

Требования к раздаче:

- **Один origin.** Приложение и `/api` должны быть на одном origin.
- **SPA-маршруты.** Для путей приложения (`/projects/…`, `/georeference`) отдаётся `index.html`.
- **Подложка** `/basemap/*.pmtiles`: отдаётся с поддержкой Range (ответ 206), с `Content-Type: application/vnd.pmtiles`, без сжатия.
- **Кэширование.** Ассеты с хешем в имени — `Cache-Control: public, max-age=31536000, immutable`. `index.html` — `no-cache`, `config.json` — `no-store`.
- **Заголовки безопасности.**
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://server.arcgisonline.com; font-src 'self'; connect-src 'self' https://server.arcgisonline.com https://nominatim.openstreetmap.org; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. Внешние адреса нужны только для космоснимка и поиска по адресу. В закрытом контуре их можно убрать вместе с `imagery` и `geocoder` в конфиге.
  - `X-Content-Type-Options: nosniff`.
  - `Referrer-Policy: strict-origin-when-cross-origin`.
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
  - `Cross-Origin-Opener-Policy: same-origin`.
  - HSTS — на TLS-терминаторе.

## config.json

Настройки контура — файл `/config.json`, который приложение читает при запуске. Один образ разворачивается в любом контуре: меняется только этот файл. Сборка кладёт в `dist` вариант из `public/config.json`.

Конфиг проверяется при старте. Если он не прошёл проверку (опечатка в имени поля, адрес не на своём origin, неверный шаблон тайлов), приложение показывает экран ошибки с причиной.

| Поле                 | Обязательно               | Значение                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiBaseUrl`         | да                        | Путь к API на том же origin, начинается с `/`, например `"/api"`                                                                                                                                                                                                                    |
| `basemapUrl`         | да                        | Путь к файлу подложки PMTiles на том же origin; `null` — без подложки                                                                                                                                                                                                               |
| `imagery`            | нет, по умолчанию `null`  | Космоснимок: `tilesUrl` и `labelsUrl` — `https://` с шаблоном `{z}/{y}/{x}`, `attribution` — подпись. `null` — к внешним адресам приложение не обращается                                                                                                                           |
| `geocoder`           | нет, по умолчанию `null`  | Поиск по адресу на шаге «Участок» и в «Геопривязке»: `url` — адрес `/search` сервиса с API Nominatim, `attribution` — подпись. `null` — поле поиска понимает только координаты                                                                                                      |
| `demoMode`           | нет, по умолчанию `"off"` | `"available"` — переключатель «Сервер / Демо» в шапке; `"off"` — только сервер, код «Демо» не загружается                                                                                                                                                                           |
| `serverCapabilities` | нет, по умолчанию `[]`    | Что сервер умеет сверх базового API: `obstacles`, `rejected`, `norms`, `explanationChecks`, `species`, `plantingEdits`, `editedDxf`, `runs`, `manualGeoreference`, `optionalBbox`. Неизвестные значения пропускаются с предупреждением. Подробно — в [docs/scope.md](docs/scope.md) |

Стенд для экспертов:

```json
{
  "apiBaseUrl": "/api",
  "basemapUrl": "/basemap/moscow.pmtiles",
  "imagery": {
    "tilesUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "labelsUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    "attribution": "Powered by Esri; Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"
  },
  "geocoder": {
    "url": "https://nominatim.openstreetmap.org/search",
    "attribution": "Поиск по адресу: Nominatim, данные © участники OpenStreetMap"
  },
  "demoMode": "available",
  "serverCapabilities": ["obstacles", "norms", "plantingEdits", "editedDxf"]
}
```

Закрытый контур без интернета — без «Демо» и без внешних адресов:

```json
{
  "apiBaseUrl": "/api",
  "basemapUrl": "/basemap/moscow.pmtiles",
  "imagery": null,
  "geocoder": null,
  "demoMode": "off",
  "serverCapabilities": ["obstacles", "norms", "plantingEdits", "editedDxf"]
}
```

Когда сервер реализует новые функции контракта-предложения, их имена добавляются в `serverCapabilities`. Пересобирать образ не нужно.

## Подложка без интернета

Подложка «Схема» — один файл PMTiles с векторными тайлами OpenStreetMap по схеме Protomaps, вырезанный по охвату Москвы. MapLibre читает его по Range-запросам с того же сервера, поэтому интернет не нужен.

```sh
pmtiles extract https://build.protomaps.com/<дата сборки>.pmtiles moscow.pmtiles \
  --bbox=36.6,54.95,38.2,56.2 --maxzoom=15
```

Утилита — <https://github.com/protomaps/go-pmtiles>, список сборок — <https://docs.protomaps.com/basemaps/downloads>. Файл на стенде весит около 139 МБ. Вырезать его можно на машине с интернетом и перенести в контур:

- **разработка** — `.data/basemap/moscow.pmtiles` (его отдаёт dev-сервер, `vite-plugins/serve-basemap.ts`);
- **развёртывание** — туда, откуда Caddy отдаёт путь из `basemapUrl`.

Без файла карта работает без подложки: план, слои и проверки на месте. Шаг «Участок» тогда предлагает ввести координаты углов вручную.

Данные OpenStreetMap — по лицензии ODbL 1.0, <https://www.openstreetmap.org/copyright>. Подпись «© участники OpenStreetMap, Protomaps» на карте обязательна.

## Проверки и качество

```sh
npm run typecheck     # TypeScript (tsc -b), строгий режим
npm run lint          # ESLint и steiger: правила кода, доступность, границы слоёв
npm run format:check  # Prettier
npm test              # Vitest: 1234 теста (модульные и тесты экранов в jsdom)
npm run build         # сборка в dist
npm run preview       # сборка с целевой CSP
```

Все пять проверок выполняются в CI на каждый пуш в `main`. Выкладка на стенд идёт только после зелёных проверок. Один нестабильный на CI тест пропускается там с пометкой `TODO` и проходит локально.

## Контракт API

- **Контракт сервера** — OpenAPI сервера. Типы лежат в `src/shared/api/generated/schema.d.ts` и обновляются командой `npm run api:generate`: она скачивает `https://backend.greenleaders.online/openapi.json`. Сгенерированный файл коммитится, поэтому сборка в закрытом контуре в сеть не ходит.
- **Контракт-предложение** — `contracts/openapi.proposed.yaml`: запросы, которые клиент уже умеет, а сервер пока нет. Типы — `src/shared/api/generated/proposed.d.ts`, команда `npm run api:generate:proposed`.
- **Нормы и породы** сверены с первоисточниками: `contracts/norms-verified.md` и `contracts/species-verified.md`.

## Команда

Green Leaders: Павел Семин (капитан, бэкенд), Юлия Родикова (продакт-менеджер), Ольга Силичева (фронтенд), Аделина Захарченко (GIS-аналитик).
