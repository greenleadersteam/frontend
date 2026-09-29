import { formatMeters } from '@/shared/lib/format';

// Ручная привязка, применённая сервером (PUT /georeference): параметров в ответе нет, есть только
// невязки опорных точек. По ним — «по опорным точкам, RMS …», без них — «вручную».
export function serverManualMethod(residuals: readonly number[]): string {
  if (residuals.length === 0) return 'вручную';
  const rms = Math.sqrt(
    residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length,
  );
  return `по опорным точкам, RMS ${formatMeters(rms)}`;
}
