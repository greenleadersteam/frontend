import type { ProposedApiComponents } from '@/shared/api';
import type { PlacementCore } from '@/shared/lib/georeference';

// Привязка чертежа, найденная в модуле геопривязки: тело PUT /georeference контракта-предложения.
// Без возможности manualGeoreference она в том же виде хранится в браузере.
export type ManualGeoreference = ProposedApiComponents['schemas']['ManualGeoreference'];

// Опорная точка чертежа — начало подобия: поворот и масштаб — вокруг неё.
export const placementOfGeoreference = (georeference: ManualGeoreference): PlacementCore => ({
  anchor: georeference.anchor_wgs84,
  source: { center: georeference.anchor_drawing },
  rotation: georeference.rotation_deg,
  scale: georeference.scale,
});
