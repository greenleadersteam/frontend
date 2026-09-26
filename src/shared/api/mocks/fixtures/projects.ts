import type { components } from '../../generated/schema';

type UploadErrorCode = components['schemas']['UploadErrorCode'];
type BBox = [number, number, number, number];

// Дефект архива повторяется при каждой обработке; разовые сбои (сервис геопривязки,
// перезапуск сервера) задаются у обработки и при повторе не возникают.
export type ArchiveDefect =
  | { code: 'bad_archive' | 'no_dxf_found' | 'insufficient_geodetic_points' }
  | { code: 'ambiguous_root_dxf'; candidates: string[] };

export type MockArchive = { filename: string; defect: ArchiveDefect | null };

export type ProjectSeed = {
  id: string;
  name: string;
  description: string | null;
  createdDaysAgo: number;
  bbox: BBox | null;
  archive: MockArchive | null;
  // queuedSecondsAgo отсчитывается от запуска мока; обработка длится 16–20 с,
  // поэтому больше 20 — уже завершённая.
  run: { queuedSecondsAgo: number; transientFailure: UploadErrorCode | null } | null;
};

const POKROVKA: BBox = [37.644, 55.758, 37.647, 55.76];
const DAY_SECONDS = 86_400;

// Id постоянные, чтобы ссылки на проекты мока переживали перезагрузку страницы.
export const projectSeeds: ProjectSeed[] = [
  {
    id: '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3',
    name: 'Сквер на Покровке',
    description: 'Благоустройство сквера, этап 1',
    createdDaysAgo: 12,
    bbox: POKROVKA,
    archive: { filename: 'pokrovka_skver.zip', defect: null },
    run: { queuedSecondsAgo: 3 * DAY_SECONDS, transientFailure: null },
  },
  {
    id: '0e8d2b6a4c1f47e9a3b5d7c9e1f2a4b6',
    name: 'Улица Шаболовка, 37',
    description: null,
    createdDaysAgo: 9,
    bbox: null,
    archive: { filename: 'shabolovka_37.zip', defect: null },
    run: { queuedSecondsAgo: 2 * DAY_SECONDS, transientFailure: null },
  },
  {
    id: '9a1c3e5b7d2f4a6c8e0b2d4f6a8c1e3b',
    name: 'Улица Маросейка, 7–9',
    description: 'Озеленение тротуара',
    createdDaysAgo: 1,
    bbox: [37.635, 55.757, 37.638, 55.759],
    archive: null,
    run: null,
  },
  {
    id: '3f7b1d9c5e2a4b8d6f0c3e5a7b9d1f2c',
    name: 'Чистопрудный бульвар, участок 2',
    description: null,
    createdDaysAgo: 0,
    bbox: [37.642, 55.761, 37.646, 55.764],
    archive: { filename: 'chistye_prudy_2.zip', defect: null },
    run: { queuedSecondsAgo: 6, transientFailure: null },
  },
  {
    id: '7d2f4b6e8a0c4d1f3b5e7a9c2d4f6b8e',
    name: 'Сквер у Рогожской заставы',
    description: 'Реконструкция сквера',
    createdDaysAgo: 0,
    bbox: [37.676, 55.745, 37.68, 55.748],
    archive: { filename: 'rogozhskaya.zip', defect: null },
    run: { queuedSecondsAgo: 14, transientFailure: null },
  },
  {
    id: 'b4e6a8c0d2f44b7e9a1c3e5b7d9f0a2c',
    name: 'Улица Большая Ордынка, 21',
    description: null,
    createdDaysAgo: 5,
    bbox: [37.624, 55.738, 37.627, 55.74],
    archive: { filename: 'ordynka_21.zip', defect: { code: 'bad_archive' } },
    run: { queuedSecondsAgo: 5 * DAY_SECONDS, transientFailure: null },
  },
  {
    id: 'c8a0e2b4d6f84c1a3e5b7d9f1b3d5e7a',
    name: 'Лефортовский парк, центральная аллея',
    description: 'Подосновы нет в архиве',
    createdDaysAgo: 4,
    bbox: [37.699, 55.762, 37.705, 55.766],
    archive: { filename: 'lefortovo_alleya.zip', defect: { code: 'no_dxf_found' } },
    run: { queuedSecondsAgo: 4 * DAY_SECONDS, transientFailure: null },
  },
  {
    id: 'd1f3b5d7e9a14e2c4b6d8f0a2c4e6b8d',
    name: 'Сквер на Новослободской',
    description: null,
    createdDaysAgo: 3,
    bbox: [37.598, 55.779, 37.601, 55.781],
    archive: {
      filename: 'novoslobodskaya.zip',
      defect: {
        code: 'ambiguous_root_dxf',
        candidates: ['ГП/Генплан.dxf', 'ГП/Генплан_изм2.dxf', 'Сети/Сводный_план.dxf'],
      },
    },
    run: { queuedSecondsAgo: 3 * DAY_SECONDS, transientFailure: null },
  },
  {
    id: 'e5b7d9f1a3c54f6e8a0c2e4b6d8f1a3c',
    name: 'Улица Бахрушина, 11',
    description: null,
    createdDaysAgo: 2,
    bbox: [37.636, 55.733, 37.639, 55.735],
    archive: { filename: 'bakhrushina_11.zip', defect: { code: 'insufficient_geodetic_points' } },
    run: { queuedSecondsAgo: 2 * DAY_SECONDS, transientFailure: null },
  },
  {
    id: 'f2c4e6a8b0d24a5c7e9b1d3f5a7c9e1b',
    name: 'Сквер на Трубной площади',
    description: null,
    createdDaysAgo: 2,
    bbox: [37.621, 55.767, 37.624, 55.769],
    archive: { filename: 'trubnaya.zip', defect: null },
    run: { queuedSecondsAgo: DAY_SECONDS, transientFailure: 'georeference_service_error' },
  },
  {
    id: 'a6c8e0b2d4f64a7c9e1b3d5f7a9c1e3d',
    name: 'Кутузовский проспект, 24',
    description: 'Разделительная полоса',
    createdDaysAgo: 1,
    bbox: [37.548, 55.745, 37.552, 55.748],
    archive: { filename: 'kutuzovsky_24.zip', defect: null },
    run: { queuedSecondsAgo: DAY_SECONDS / 2, transientFailure: 'other' },
  },
];
