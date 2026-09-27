export type {
  Contour,
  ContourVertex,
  DetectedResult,
  ParseError,
  ParseResult,
  ReadResult,
  Reference,
  ReferenceResult,
} from './contour';
export {
  buildContour,
  buildReference,
  detectResult,
  PARSE_ERROR_TEXT,
  parseContour,
  readGeoJson,
  REFERENCE_ERROR_TEXT,
} from './contour';
export type { MillimetreHint, Unit, Warning } from './diagnostics';
export { diagnose, millimetreHint, UNITS } from './diagnostics';
// Пример для кнопки «Открыть пример»: участок А из примеров прототипа входит в сборку текстом
// и проходит тот же разбор, что файл пользователя. Не ?url: файл меньше 4 КБ Vite встроил бы
// data:-адресом, а его fetch запрещает connect-src.
export { default as EXAMPLE_CONTOUR_TEXT } from './__fixtures__/участок-А-простой.geojson?raw';
export const EXAMPLE_CONTOUR_NAME = 'участок-А-простой.geojson';
