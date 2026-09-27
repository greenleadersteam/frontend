// Символы, недопустимые в именах файлов Windows и Linux, и управляющие (security.md, «Скачивание»).
// eslint-disable-next-line no-control-regex -- управляющие символы и ищем
const FORBIDDEN_CHARACTERS = /[/\\:*?"<>|\u0000-\u001F\u007F]/g;
// Кириллица в UTF-8 — два байта на символ: 100 символов названия и самый длинный хвост
// («— ведомость озеленения.csv», 48 байт) укладываются в 255 байт, предел имени файла в ext4 и NTFS.
const MAX_NAME_LENGTH = 100;

// Имя сохраняемого файла из недоверенного названия (проекта, контура): запрещённые символы
// заменены, длина ограничена, хвост («.dxf», « — привязка.json») добавляется как есть.
export function safeFileName(name: string, suffix: string, fallback: string): string {
  const cleaned = name.replace(/\s+/g, ' ').replace(FORBIDDEN_CHARACTERS, '_').trim();
  // Windows не сохраняет файл с точкой или пробелом в конце имени.
  const shortened = Array.from(cleaned)
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .replace(/[. ]+$/, '');
  return `${shortened === '' ? fallback : shortened}${suffix}`;
}
