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
  // Тот же код — когда пунктов мало или они вне области участка (../backend/greenplan/georeference/
  // transform.py:98-101), подгонка вырождена (:191-194) или невязка выше порога (:237); сводит
  // их ../backend/greenplan/api/jobs.py:213-214. Область участка после создания не меняется
  // (../backend/greenplan/api/schemas.py:21-23): при неверной области поможет только новый проект.
  insufficient_geodetic_points:
    'Не удалось привязать чертёж к координатам: геодезических пунктов опознано мало, они вне области участка или привязка не прошла проверку точности. Исправьте пункты на подоснове и загрузите архив снова; если область участка при создании задана неверно, создайте проект заново.',
  // Сервер ходит в каталог geobridge.ru (../backend/greenplan/georeference/geobridge.py:59):
  // без доступа к нему сбой постоянный, и повтор не поможет.
  georeference_service_error:
    'Каталог геодезических пунктов недоступен. Загрузите архив снова позже. Если ошибка повторяется, сообщите администратору: серверу может быть недоступен каталог.',
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
  school_kindergarten: 'Здание школы или детского сада',
  retaining_wall: 'Подпорная стенка',
  slope: 'Откос, терраса',
  // Категории улиц и напряжение ЛЭП — в нормах сервиса есть, распознавание их пока не выдаёт.
  arterial_citywide: 'Магистральная улица общегородского значения',
  arterial_district: 'Магистральная улица районного значения',
  local: 'Улица местного значения',
  driveway: 'Проезд',
  axis: 'Ось трамвайных путей',
  bed_edge: 'Край трамвайного полотна',
  lt_1kv: 'Воздушная линия до 1\u00A0кВ',
  kv_1_20: 'Воздушная линия 1–20\u00A0кВ',
  kv_35: 'Воздушная линия 35\u00A0кВ',
  kv_110: 'Воздушная линия 110\u00A0кВ',
  kv_150_220: 'Воздушная линия 150, 220\u00A0кВ',
  kv_300_500: 'Воздушная линия 300, 500\u00A0кВ',
  kv_750: 'Воздушная линия 750\u00A0кВ',
  kv_1150: 'Воздушная линия 1150\u00A0кВ',
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
  ditch_edge: 'Бровка канавы',
  tram_tracks: 'Трамвайные пути',
  overhead_power_lines: 'Воздушная линия электропередачи',
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
// По двум точкам привязка определяется без избытка и не проверяется
// (../backend/greenplan/georeference/transform.py:197-206); по трём и более невязки сверены
// с порогом 1 м (../backend/greenplan/api/config.py:33), а при четырёх и более сервер может
// исключить одну точку — её нет в matched_labels (transform.py:220-235). Неизвестное значение
// подписи не получает.
export const GEOREFERENCE_CONFIDENCE_LABELS: Record<string, string> = {
  validated: 'проверена по опорным точкам',
  unvalidated: 'без проверки',
  // Привязка из модуля геопривязки (PUT /georeference): значение мока, контракт его не задаёт.
  manual: 'вручную',
};
