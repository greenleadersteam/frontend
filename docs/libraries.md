# Методы и библиотеки

## Методы

| Задача                                                      | Метод                                                                                    | Где описан                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Расстояние от посадки до объекта                            | Ближайшая точка на отрезке и в многоугольнике; сеточный индекс отрезков                  | [interpretability.md](interpretability.md#как-считается-фактическое-расстояние) |
| Расстояние до объекта по зоне запрета                       | Запас до границы буфера плюс его ширина; срез буфера краем участка распознаётся отдельно | [interpretability.md](interpretability.md#если-объектов-нет)                    |
| Точка чертежа для правленой посадки при геопривязке сервера | Поперечная проекция Меркатора (Snyder, 1987) и подобие МНК по неизменённым посадкам      | [editing-and-export.md](editing-and-export.md#слой-dxf-в-координатах-чертежа)   |
| Геопривязка вручную и по опорным точкам                     | WGS 84 ↔ ECEF ↔ ENU, формула Боуринга, подобие МНК в ENU, задачи Винсенти                | [georeference.md](georeference.md#геодезия)                                     |
| Упрощение плана под контуром                                | Алгоритм Дугласа — Пекера, допуск 0,1 м                                                  | [georeference.md](georeference.md#привязка-проекта)                             |
| Охват посадок                                               | Выпуклая оболочка (монотонная цепочка Эндрю)                                             | [georeference.md](georeference.md#привязка-проекта)                             |
| Чтение архива без распаковки                                | Центральный каталог ZIP по срезу хвоста файла; имена в UTF-8 или CP866                   | `shared/lib/zip`                                                                |

## Зависимости

В сборку входят зависимости из раздела `dependencies` файла `package.json`. Версии закреплены точно, установка — только `npm ci` по `package-lock.json`.

| Пакет                                                                                             | Версия | Назначение                                                               | Лицензия     | Ссылка                                       |
| ------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ | ------------ | -------------------------------------------- |
| `react`, `react-dom`                                                                              | 19.3.0 | Интерфейс                                                                | MIT          | <https://github.com/facebook/react>          |
| `react-router`                                                                                    | 8.4.0  | Маршруты, ленивая загрузка экранов                                       | MIT          | <https://github.com/remix-run/react-router>  |
| `@reduxjs/toolkit`                                                                                | 2.12.0 | Состояние приложения и RTK Query — запросы к серверу, кэш, опрос         | MIT          | <https://github.com/reduxjs/redux-toolkit>   |
| `react-redux`                                                                                     | 9.3.0  | Связка React и Redux                                                     | MIT          | <https://github.com/reduxjs/react-redux>     |
| `@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/notifications`, `@mantine/dropzone` | 9.6.2  | Компоненты интерфейса, формы, уведомления, зона загрузки файлов          | MIT          | <https://github.com/mantinedev/mantine>      |
| `maplibre-gl`                                                                                     | 6.11.2 | Карта на WebGL: подложка, слои результата                                | BSD-3-Clause | <https://github.com/maplibre/maplibre-gl-js> |
| `pmtiles`                                                                                         | 4.5.0  | Чтение подложки из одного файла PMTiles по Range-запросам                | BSD-3-Clause | <https://github.com/protomaps/PMTiles>       |
| `@protomaps/basemaps`                                                                             | 5.7.2  | Слои стиля подложки по схеме Protomaps, перекрашенные в палитру продукта | BSD-3-Clause | <https://github.com/protomaps/basemaps>      |
| `zod`                                                                                             | 4.6.5  | Проверка `config.json`, форм и данных из браузерного хранилища           | MIT          | <https://github.com/colinhacks/zod>          |
| `fflate`                                                                                          | 0.8.3  | Упаковка отдельных DXF в ZIP в браузере, без сжатия                      | MIT          | <https://github.com/101arrowz/fflate>        |
| `@fontsource-variable/mulish`                                                                     | 5.3.0  | Шрифт Mulish, локально, с кириллицей                                     | OFL-1.1      | <https://github.com/fontsource/font-files>   |
| `@tabler/icons-react`                                                                             | 3.48.0 | Иконки                                                                   | MIT          | <https://github.com/tabler/tabler-icons>     |

Один пакет из `devDependencies` тоже попадает в сборку. Это `msw` 2.15.0 (MIT, <https://github.com/mswjs/msw>) — демонстрационные данные режима «Демо». Он собирается в отдельный чанк, который загружается только при выборе «Демо», и служебный скрипт `mockServiceWorker.js` в корне сборки.

Остальные `devDependencies` — инструменты сборки, проверки и тестов (Vite, TypeScript, ESLint, steiger, Prettier, Vitest, Testing Library, jsdom). В сборку они не попадают.

Типы контракта сервера генерирует `openapi-typescript` 7.13.0. Он запускается через `npx` скриптами `api:generate` и `api:generate:proposed` и в зависимости не входит.

Все лицензии — из списка допустимых для проекта: MIT, BSD, OFL для шрифтов.

## Данные

### Карта: OpenStreetMap и Protomaps

Подложка «Схема» — файл PMTiles с векторными тайлами по схеме Protomaps, вырезанный по охвату Москвы. Данные — OpenStreetMap, лицензия Open Database License (ODbL 1.0): <https://www.openstreetmap.org/copyright>. ODbL требует указывать источник, поэтому на карте и под планом в отчёте стоит подпись «© участники OpenStreetMap, Protomaps».

Сборки Protomaps: <https://docs.protomaps.com/basemaps/downloads>. Стиль собран из пакета `@protomaps/basemaps` и перекрашен в палитру продукта.

### Космоснимок: Esri World Imagery

Подложка «Снимок» модуля геопривязки — Esri World Imagery с подписями Esri World Boundaries and Places. Она включается только полем `imagery` в `config.json`. В контуре заказчика её нет, потому что это внешний сервис.

- **Условия.** Использование — по условиям Esri: <https://www.esri.com/en-us/legal/terms/full-master-agreement>, атрибуция обязательна. Подключена для показа, без коммерческого использования. Подключать её в другом контуре — решение владельца контура, с проверкой условий.
- **Атрибуция** задаётся в конфиге вместе с адресами и показывается на карте: «Powered by Esri; Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community; …».

### Нормативные акты

Нормы отступов, их пункты и значения сверены с первоисточниками в `contracts/norms-verified.md` (27.09.2026):

- ПП Москвы от 10.09.2002 № 743-ПП, приложение 1, п. 3.6.3, табл. 3.6.1 и п. 3.6.4, табл. 3.6.2 — <https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/>;
- СП 42.13330.2016, п. 9.6, табл. 9.1 — те же значения, что в табл. 3.6.1 743-ПП;
- ПП Москвы № 623-ПП (МГСН 1.02-02), п. 4.2.4 — отсылка к МГСН 1.01-99, своих чисел нет.

Породы для режима «Демо» сверены в `contracts/species-verified.md`. Пород, которых там нет, демо не показывает.
