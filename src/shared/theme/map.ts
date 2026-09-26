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
} as const;
