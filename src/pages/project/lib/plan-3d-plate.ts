import type { Map as MapLibreMap } from 'maplibre-gl';

import { plan3dColors } from '@/shared/theme';

// Плашка подписи: поля и строка в CSS-пикселях, на снимке умножаются на плотность пикселей.
const PAD = 12;
const LINE = 18;
const MARGIN = 16;
const FONT = '"Mulish Variable", sans-serif';

// Кадр карты с белой плашкой подписи внизу слева. Кадр копируется в обработчике render: буфер
// WebGL в этот момент ещё не очищен, и preserveDrawingBuffer (а с ним пересоздание карты) не
// нужен.
export function capturePlate(map: MapLibreMap, lines: readonly string[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    map.once('render', () => {
      const source = map.getCanvas();
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      const context = canvas.getContext('2d');
      if (context === null) {
        reject(new Error('Canvas 2D недоступен'));
        return;
      }
      context.drawImage(source, 0, 0);
      // Плотность пикселей — по devicePixelRatio карты, а не по clientWidth: скрытый контейнер
      // дал бы деление на ноль.
      drawPlate(
        context,
        lines.filter((line) => line !== ''),
        map.getPixelRatio(),
      );
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error('Снимок не собран'));
          return;
        }
        blob.arrayBuffer().then((buffer) => {
          resolve(new Uint8Array(buffer));
        }, reject);
      }, 'image/png');
    });
    map.triggerRepaint();
  });
}

function drawPlate(context: CanvasRenderingContext2D, lines: readonly string[], ratio: number) {
  context.save();
  context.scale(ratio, ratio);
  const height = context.canvas.height / ratio;
  const fonts = lines.map((_, index) => `${index === 0 ? '600' : '400'} 13px ${FONT}`);
  const width = Math.max(
    ...lines.map((line, index) => {
      context.font = fonts[index] ?? '';
      return context.measureText(line).width;
    }),
  );
  const boxHeight = PAD * 2 + LINE * lines.length;
  const top = height - MARGIN - boxHeight;
  context.fillStyle = plan3dColors.plate;
  context.beginPath();
  context.roundRect(MARGIN, top, width + PAD * 2, boxHeight, 8);
  context.fill();
  context.fillStyle = plan3dColors.plateText;
  context.textBaseline = 'middle';
  lines.forEach((line, index) => {
    context.font = fonts[index] ?? '';
    context.fillText(line, MARGIN + PAD, top + PAD + LINE * (index + 0.5));
  });
  context.restore();
}
