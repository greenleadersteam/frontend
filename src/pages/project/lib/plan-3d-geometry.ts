import type { PlantType, Species } from '@/entities/project';

// Посадки плана с правками: точка WGS84, тип и порода, если сервис её выбрал.
export type ScenePlanting = {
  features: readonly {
    geometry: { coordinates: readonly number[] };
    properties: { plant_type: PlantType; species_id?: string | null };
  }[];
};

// Условные размеры, когда породы нет или в справочнике нет её размеров: схема, а не обмер.
const CONVENTIONAL = {
  tree: { trunkDiameter: 0.4, trunkHeight: 2.5, crownDiameter: 5, height: 8 },
  shrub: { diameter: 1.2, height: 1.2 },
} as const;

// 8, а не 12: на 1179 посадках «Старого Гая» переключения при CPU ×4 не укладывались в 200 мс.
const VERTICES = 8;
const METERS_PER_DEGREE_LAT = 110_540;
const METERS_PER_DEGREE_LON = 111_320;
// Ствол дерева породы — та же доля высоты, что у условного дерева.
const TRUNK_SHARE = CONVENTIONAL.tree.trunkHeight / CONVENTIONAL.tree.height;

type Part = 'trunk' | 'crown' | 'shrub';
type ExtrusionProperties = { part: Part; base: number; top: number };
type Extrusions = GeoJSON.FeatureCollection<GeoJSON.Polygon, ExtrusionProperties>;

// Круг радиуса в метрах вокруг точки WGS84: долгота сжата косинусом широты.
export function circle(
  [lon, lat]: [number, number],
  diameter: number,
  vertices: number = VERTICES,
): GeoJSON.Polygon {
  const radius = diameter / 2;
  const dLon = radius / (METERS_PER_DEGREE_LON * Math.cos((lat * Math.PI) / 180));
  const dLat = radius / METERS_PER_DEGREE_LAT;
  const ring = Array.from({ length: vertices }, (_, index) => {
    const angle = (2 * Math.PI * index) / vertices;
    return [lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)];
  });
  const first = ring[0] ?? [lon, lat];
  return { type: 'Polygon', coordinates: [[...ring, first]] };
}

type Size = { trunkDiameter: number; trunkHeight: number; crownDiameter: number; height: number };

// Размер дерева — по справочнику пород, если там есть и высота, и крона; иначе условный.
function treeSize(species: Species | undefined): { size: Size; conventional: boolean } {
  if (species?.crown_diameter_m == null) return { size: CONVENTIONAL.tree, conventional: true };
  return {
    size: {
      trunkDiameter: CONVENTIONAL.tree.trunkDiameter,
      trunkHeight: species.height_m * TRUNK_SHARE,
      crownDiameter: species.crown_diameter_m,
      height: species.height_m,
    },
    conventional: false,
  };
}

function shrubSize(species: Species | undefined) {
  if (species?.crown_diameter_m == null) return { size: CONVENTIONAL.shrub, conventional: true };
  return {
    size: { diameter: species.crown_diameter_m, height: species.height_m },
    conventional: false,
  };
}

const extrusion = (
  geometry: GeoJSON.Polygon,
  properties: ExtrusionProperties,
): GeoJSON.Feature<GeoJSON.Polygon, ExtrusionProperties> => ({
  type: 'Feature',
  geometry,
  properties,
});

type Scene = { extrusions: Extrusions; conventional: boolean };

// Сцена из плана посадок: у дерева ствол и крона над ним, у кустарника — один цилиндр.
// conventional — хотя бы одна посадка нарисована условными размерами.
export function plantingScene(
  planting: ScenePlanting,
  species: ReadonlyMap<string, Species>,
  vertices: number = VERTICES,
): Scene {
  let conventional = false;
  const features = planting.features.flatMap(({ geometry, properties }) => {
    const [lon = 0, lat = 0] = geometry.coordinates;
    const point: [number, number] = [lon, lat];
    const found = properties.species_id == null ? undefined : species.get(properties.species_id);
    const type: PlantType = properties.plant_type;
    if (type === 'shrub') {
      const { size, conventional: guessed } = shrubSize(found);
      conventional ||= guessed;
      return [
        extrusion(circle(point, size.diameter, vertices), {
          part: 'shrub',
          base: 0,
          top: size.height,
        }),
      ];
    }
    const { size, conventional: guessed } = treeSize(found);
    conventional ||= guessed;
    return [
      extrusion(circle(point, size.trunkDiameter, vertices), {
        part: 'trunk',
        base: 0,
        top: size.trunkHeight,
      }),
      extrusion(circle(point, size.crownDiameter, vertices), {
        part: 'crown',
        base: size.trunkHeight,
        top: size.height,
      }),
    ];
  });
  return { extrusions: { type: 'FeatureCollection', features }, conventional };
}
