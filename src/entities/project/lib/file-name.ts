// Символы, недопустимые в именах файлов Windows и Linux, и управляющие (security.md, «Скачивание»).
// eslint-disable-next-line no-control-regex -- управляющие символы и ищем
const FORBIDDEN_CHARACTERS = /[/\\:*?"<>|\u0000-\u001F\u007F]/g;
// Кириллица в UTF-8 — два байта на символ: 100 символов названия и самый длинный хвост
// («— ведомость озеленения.csv», 48 байт) укладываются в 255 байт, предел имени файла в ext4 и NTFS.
const MAX_NAME_LENGTH = 100;
const FALLBACK_NAME = 'план посадок';

// Имя файла проекта: DXF («Сквер.dxf»), ведомость («Сквер — ведомость посадок.csv»).
// Content-Disposition бэкенда сейчас всегда «planting.dxf» (задача P2-2), поэтому имя
// строится из названия проекта.
export function projectFileName(projectName: string, suffix: string): string {
  const cleaned = projectName.replace(/\s+/g, ' ').replace(FORBIDDEN_CHARACTERS, '_').trim();
  // Windows не сохраняет файл с точкой или пробелом в конце имени.
  const name = Array.from(cleaned)
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .replace(/[. ]+$/, '');
  return `${name === '' ? FALLBACK_NAME : name}${suffix}`;
}
