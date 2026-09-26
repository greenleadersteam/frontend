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
