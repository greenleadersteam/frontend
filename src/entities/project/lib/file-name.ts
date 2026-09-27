import { safeFileName } from '@/shared/lib/save-file';

const FALLBACK_NAME = 'план посадок';

// Имя файла проекта: DXF («Сквер.dxf»), ведомость («Сквер — ведомость посадок.csv»).
// Content-Disposition бэкенда сейчас всегда «planting.dxf» (задача P2-2), поэтому имя
// строится из названия проекта.
export const projectFileName = (projectName: string, suffix: string): string =>
  safeFileName(projectName, suffix, FALLBACK_NAME);
