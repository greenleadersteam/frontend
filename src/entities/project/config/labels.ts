import type { ProcessingStage, ProjectState, UploadErrorCode } from '../model/project';

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
  ambiguous_root_dxf:
    'Не удалось определить главный DXF: подходят несколько файлов. Оставьте в архиве один генплан и загрузите архив снова.',
  insufficient_geodetic_points:
    'Не удалось привязать чертёж к координатам: мало опознанных геодезических пунктов. Проверьте пункты на подоснове и загрузите архив снова.',
  georeference_service_error:
    'Сервис геопривязки не ответил. Загрузите архив снова через несколько минут.',
  other:
    'Обработка прервалась. Повторите загрузку. Если ошибка повторяется, сообщите администратору.',
} satisfies Record<UploadErrorCode, string>;
