import type { ManualGeoreference } from '@/entities/project';
import { formatMeters } from '@/shared/lib/format';
import { formatDecimal, formatDegrees, formatLatLon } from '@/shared/lib/georeference';

// Способ привязки одной фразой — в шапке проекта и в отчёте.
export const manualMethod = ({ method, rms_m: rms }: ManualGeoreference): string =>
  method === 'control_points' && rms !== null
    ? `по опорным точкам, RMS ${formatMeters(rms)}`
    : 'вручную';

// Ручная привязка, применённая сервером (PUT /georeference): параметров в ответе нет, есть только
// невязки опорных точек. По ним — «по опорным точкам, RMS …», без них — «вручную».
export function serverManualMethod(residuals: readonly number[]): string {
  if (residuals.length === 0) return 'вручную';
  const rms = Math.sqrt(
    residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length,
  );
  return `по опорным точкам, RMS ${formatMeters(rms)}`;
}

// Параметры привязки: опорная точка на местности и в чертеже, поворот, масштаб, точки и RMS.
// Знаков — как в модуле геопривязки и в его выгрузке.
export function manualParameters(georeference: ManualGeoreference): [string, string][] {
  const { anchor_wgs84: wgs84, anchor_drawing: drawing, control_points: points } = georeference;
  const used = points.filter((point) => point.used).length;
  const control = points.length - used;
  const rows: [string, string][] = [
    ['Опорная точка', formatLatLon(wgs84.lat, wgs84.lon)],
    ['Она же в чертеже', `${formatDecimal(drawing.x, 2)}; ${formatDecimal(drawing.y, 2)}`],
    ['Поворот против часовой', formatDegrees(georeference.rotation_deg, 4)],
    ['Масштаб', formatDecimal(georeference.scale, 6)],
  ];
  if (used > 0) rows.push(['Опорных точек', formatDecimal(used)]);
  if (control > 0) rows.push(['Контрольных точек', formatDecimal(control)]);
  if (georeference.rms_m !== null) rows.push(['RMS', formatMeters(georeference.rms_m)]);
  return rows;
}
