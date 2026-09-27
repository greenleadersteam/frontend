import type { PlantType, ProcessingStage, ProjectState, UploadErrorCode } from '../model/project';

export const STAGE_LABELS = {
  queued: 'В очереди',
  extracting: 'Распаковка архива',
  parsing: 'Разбор подосновы',
  georeferencing: 'Геопривязка',
  zoning_layout: 'Расчёт зон и посадок',
  exporting: 'Сборка результата',
} satisfies Record<ProcessingStage, string>;

export const STATE_LABELS = {
  draft: 'Архив не загружен',
  ready: 'Готово',
  failed: 'Ошибка обработки',
  unknown: 'Обрабатывается',
} satisfies Record<Exclude<ProjectState['kind'], 'processing'>, string>;

export const JOB_ERROR_LABELS = {
  bad_archive: 'Архив повреждён или это не ZIP. Проверьте файл и загрузите архив снова.',
  no_dxf_found:
    'В архиве нет файлов DXF. Добавьте подоснову в формате DXF и загрузите архив снова.',
  // Выбор — в мастере загрузки и на экране проекта (POST /runs с root_dxf из контракта-предложения).
  ambiguous_root_dxf: 'В архиве несколько главных чертежей. Выберите нужный.',
  insufficient_geodetic_points:
    'Не удалось привязать чертёж к координатам: мало опознанных геодезических пунктов. Проверьте пункты на подоснове и загрузите архив снова.',
  georeference_service_error:
    'Сервис геопривязки не ответил. Загрузите архив снова через несколько минут.',
  other:
    'Обработка прервалась. Повторите загрузку. Если ошибка повторяется, сообщите администратору.',
} satisfies Record<UploadErrorCode, string>;

export const PLANT_TYPE_LABELS = {
  tree: 'Дерево',
  shrub: 'Кустарник',
} satisfies Record<PlantType, string>;

// Формы для счётчиков на карте и в её подписи: «24 дерева, 12 кустарников, 5 зон запрета».
export const RESULT_COUNT_FORMS = {
  trees: { one: 'дерево', few: 'дерева', many: 'деревьев' },
  shrubs: { one: 'кустарник', few: 'кустарника', many: 'кустарников' },
  zones: { one: 'зона запрета', few: 'зоны запрета', many: 'зон запрета' },
};

// Препятствия по ключам бэкенда: подтипы — из норм (../backend/greenplan/norms/default.yaml),
// категории — из правил распознавания (../backend/greenplan/rules/default.yaml). Подтип
// точнее категории; без подписи показывается исходный ключ — выдумывать название нельзя.
const OBSTACLE_SUBTYPE_LABELS: Record<string, string> = {
  gas: 'Газопровод',
  heat: 'Тепловая сеть',
  water: 'Водопровод',
  drainage: 'Дренаж',
  sewer: 'Канализация, водосток',
  power_cable: 'Силовой кабель',
  comm_cable: 'Кабель связи',
  other_utility: 'Неопознанная подземная сеть',
  existing_tree: 'Существующее дерево',
  tree_strip: 'Полоса деревьев',
  shrub_existing: 'Существующий кустарник',
  lawn: 'Газон',
};

const OBSTACLE_CATEGORY_LABELS: Record<string, string> = {
  underground_utilities: 'Подземная сеть',
  buildings: 'Здания и сооружения',
  road_edge: 'Бортовой камень',
  footpath_edge: 'Край дорожек и тротуаров',
  green_existing: 'Существующие насаждения',
  poles_masts: 'Опоры и мачты',
  retaining_walls_slopes: 'Подпорные стенки и откосы',
  wells_hatches: 'Колодцы и люки',
  red_lines: 'Красные линии',
  contours: 'Горизонтали рельефа',
  geodetic_points: 'Геодезические пункты',
  site_boundary: 'Граница участка',
};

export function obstacleLabel(category: string, subtype: string | null): string {
  const bySubtype = subtype === null ? undefined : OBSTACLE_SUBTYPE_LABELS[subtype];
  return (
    bySubtype ??
    OBSTACLE_CATEGORY_LABELS[category] ??
    (subtype === null ? category : `${category}/${subtype}`)
  );
}

// confidence бэкенда — строка «validated» или «unvalidated» (../backend/greenplan/api/jobs.py:84).
// По двум точкам привязка определяется без избытка и не проверяется (тест
// ../backend/tests/api/test_routes.py:206); по трём и более невязки сверены с порогом 1 м
// (../backend/greenplan/api/config.py:33). Неизвестное значение подписи не получает.
export const GEOREFERENCE_CONFIDENCE_LABELS: Record<string, string> = {
  validated: 'проверена по опорным точкам',
  unvalidated: 'без проверки',
};
