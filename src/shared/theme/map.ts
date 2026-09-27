import { clay, sage, stone, WHITE } from './palette';

// Подложка — design.md, раздел «Карта». MapLibre не читает CSS-переменные, поэтому цвета
// карты — значениями; других литералов карты в проекте нет.
export const basemapColors = {
  earth: '#EFEAE2',
  blocks: '#E4DCD0',
  buildings: '#D9CFC1',
  buildingsOutline: '#CBBFAF',
  parks: '#DCE3D2',
  water: '#D5DEDF',
  roads: '#FBF9F6',
  roadsCasing: '#DDD4C8',
  // Туннели — цвета дорог с насыщенностью втрое ниже: на уровне улицы их почти не видно.
  tunnels: '#FAF9F8',
  tunnelsCasing: '#D8D5D0',
  streetLabel: '#8C847C',
  streetLabelHalo: '#EFEAE2',
} as const;

// Слои результата — те же оттенки палитры, что в превью (draw-plan.ts).
export const resultLayerColors = {
  tree: sage[7],
  treeHighlight: sage[6],
  treeShadow: stone[9],
  shrub: sage[4],
  prohibitedZone: clay[3],
  selectionOuter: WHITE,
  selectionInner: stone[9],
  zoneOutline: clay[6],
  // Отклонённое место — пунктирный круг с крестом.
  rejected: clay[6],
  // Правки: кольцо статуса, ромб добавленной вручную, линия перемещения.
  statusRing: clay[6],
  manualMark: WHITE,
  manualMarkOutline: stone[9],
  movedLine: stone[6],
  // Газон — где вообще зелень; «можно» — где разрешено сажать выбранный тип посадки. Граница
  // участка — линия чертежа, не ошибки.
  lawn: sage[1],
  allowed: sage[3],
  siteBoundary: stone[8],
  // Размерные линии: «запас» до зоны и «охранная зона» до препятствия (design.md, «Карта»).
  dimensionMargin: sage[7],
  dimensionSetback: clay[6],
  dimensionLabel: stone[9],
  dimensionLabelHalo: WHITE,
  // Исходные объекты: наши здания светлее подложечных, но с обводкой темнее, чтобы не сливаться.
  building: stone[3],
  buildingOutline: stone[5],
  edge: stone[6],
  obstacleLabel: stone[8],
  obstacleLabelHalo: WHITE,
} as const;

export type UtilityDash = 'solid' | 'dashed' | 'dashDot';

// Подземные сети — спокойные оттенки вне шалфея и глины: зелёный отдан посадкам, красный —
// запретам. Контраст к «Земле» подложки не ниже 3:1 (contrast.test.ts). Цветом сеть не
// узнаётся: у напорных сетей линия сплошная, у самотёчных — пунктир, у кабелей — штрих-пунктир.
export const utilityStyles = {
  gas: { color: '#8A6A2A', dash: 'solid' },
  water: { color: '#3D6B8C', dash: 'solid' },
  heat: { color: '#8A4B78', dash: 'solid' },
  sewer: { color: '#7A5A3C', dash: 'dashed' },
  drainage: { color: '#3E7F86', dash: 'dashed' },
  other_utility: { color: stone[7], dash: 'dashed' },
  power_cable: { color: '#9C3F5A', dash: 'dashDot' },
  comm_cable: { color: '#5A5A9A', dash: 'dashDot' },
} as const satisfies Record<string, { color: string; dash: UtilityDash }>;

export type UtilitySubtype = keyof typeof utilityStyles;

// Подписи на карте рисуются в браузере шрифтом интерфейса: MapLibre растеризует глифы локально
// и берёт вес 600 из имени первого шрифта (design.md, «Карта»).
export const MAP_LABEL_FONT = ['Mulish Variable SemiBold', 'Mulish Variable'];
