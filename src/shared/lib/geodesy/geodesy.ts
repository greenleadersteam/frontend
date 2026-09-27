// Геодезия модуля геопривязки. Чистая математика: ни DOM, ни карты, ни состояния приложения.
// Перенесено из прототипа ../geojson/js/geo.js без изменений логики и допусков.
//
// Эллипсоид WGS 84. Локальная плоскость — топоцентрическая ENU (восток, север, вверх) с началом
// в опорной точке: только в ней подобие остаётся подобием. Считать привязку в Меркаторе нельзя —
// там масштаб по северу и востоку различается; цену такой ошибки фиксирует проверка 9.

export type LatLon = { lat: number; lon: number };
// Геодезические координаты с высотой над эллипсоидом, м.
export type Geodetic = LatLon & { h: number };
export type Ecef = { x: number; y: number; z: number };
// Метры восток / север / вверх относительно опорной точки.
export type Enu = { e: number; n: number; u: number };
// Точка касательной плоскости: восток и север без высоты.
export type PlaneEnu = { e: number; n: number };
// Точка плоскости с осями x и y: местные метры файла, метры Меркатора.
export type LocalPoint = { x: number; y: number };

export type SimilarityParams = {
  originX: number;
  originY: number;
  rotationDeg: number;
  scale: number;
};

export type FitResult = {
  a: number;
  b: number;
  tx: number;
  ty: number;
  scale: number;
  rotationDeg: number;
  rms: number;
  maxResidual: number;
};

const A = 6_378_137; // большая полуось, м
const INV_F = 298.257223563; // обратное уплощение
const F = 1 / INV_F;
const B = A * (1 - F); // малая полуось, м
const E2 = F * (2 - F); // первый эксцентриситет в квадрате
const EP2 = E2 / (1 - E2); // второй эксцентриситет в квадрате

export const WGS84 = { A, B, F, INV_F, E2 } as const;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export const toRad = (degrees: number): number => degrees * DEG;
export const toDeg = (radians: number): number => radians * RAD;

export function geodeticToEcef({ lat, lon, h = 0 }: LatLon & { h?: number }): Ecef {
  const phi = toRad(lat);
  const lambda = toRad(lon);
  const sinLat = Math.sin(phi);
  const cosLat = Math.cos(phi);
  const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  return {
    x: (n + h) * cosLat * Math.cos(lambda),
    y: (n + h) * cosLat * Math.sin(lambda),
    z: (n * (1 - E2) + h) * sinLat,
  };
}

// Обратное преобразование по Боурингу. Само по себе оно даёт доли миллиметра погрешности,
// поэтому следом идут две итерации уточнения широты и высоты — после них round-trip сходится
// до 1e−9 м.
export function ecefToGeodetic({ x, y, z }: Ecef): Geodetic {
  const p = Math.sqrt(x * x + y * y);
  const lon = Math.atan2(y, x);

  // На оси вращения долгота не определена: берём ноль.
  if (p < 1e-9) {
    const sign = z < 0 ? -1 : 1;
    return { lat: sign * 90, lon: 0, h: Math.abs(z) - B };
  }

  const theta = Math.atan2(z * A, p * B);
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  let lat = Math.atan2(z + EP2 * B * sinT * sinT * sinT, p - E2 * A * cosT * cosT * cosT);

  let sinLat: number;
  let n: number;
  let h = 0;
  for (let i = 0; i < 2; i += 1) {
    sinLat = Math.sin(lat);
    n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
    h = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + h)));
  }

  sinLat = Math.sin(lat);
  n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  h = p / Math.cos(lat) - n;

  return { lat: toDeg(lat), lon: toDeg(lon), h };
}

type AnchorFrame = {
  sinLat: number;
  cosLat: number;
  sinLon: number;
  cosLon: number;
  ecef: Ecef;
};

function anchorFrame(anchor: LatLon & { h?: number }): AnchorFrame {
  const lat0 = toRad(anchor.lat);
  const lon0 = toRad(anchor.lon);
  return {
    sinLat: Math.sin(lat0),
    cosLat: Math.cos(lat0),
    sinLon: Math.sin(lon0),
    cosLon: Math.cos(lon0),
    ecef: geodeticToEcef({ lat: anchor.lat, lon: anchor.lon, h: anchor.h ?? 0 }),
  };
}

function enuFrom(f: AnchorFrame, point: LatLon & { h?: number }): Enu {
  const p = geodeticToEcef({ lat: point.lat, lon: point.lon, h: point.h ?? 0 });
  const dx = p.x - f.ecef.x;
  const dy = p.y - f.ecef.y;
  const dz = p.z - f.ecef.z;
  return {
    e: -f.sinLon * dx + f.cosLon * dy,
    n: -f.sinLat * f.cosLon * dx - f.sinLat * f.sinLon * dy + f.cosLat * dz,
    u: f.cosLat * f.cosLon * dx + f.cosLat * f.sinLon * dy + f.sinLat * dz,
  };
}

// Обратно. Высота u нужна редко: приложение кладёт вершины на касательную плоскость, то есть
// u = 0, и получает высоту h, которую потом отбрасывает. Цену этого шага меряет проверка 3.
function geodeticFrom(f: AnchorFrame, { e, n, u = 0 }: PlaneEnu & { u?: number }): Geodetic {
  const dx = -f.sinLon * e - f.sinLat * f.cosLon * n + f.cosLat * f.cosLon * u;
  const dy = f.cosLon * e - f.sinLat * f.sinLon * n + f.cosLat * f.sinLon * u;
  const dz = f.cosLat * n + f.sinLat * u;
  return ecefToGeodetic({ x: f.ecef.x + dx, y: f.ecef.y + dy, z: f.ecef.z + dz });
}

export type EnuFrame = {
  toEnu: (point: LatLon & { h?: number }) => Enu;
  toGeodetic: (point: PlaneEnu & { u?: number }) => Geodetic;
};

// Рамка опорной точки: синусы, косинусы и ECEF считаются один раз. Пересчёт сотен вершин на
// каждое движение мыши идёт через неё.
export function enuFrame(anchor: LatLon & { h?: number }): EnuFrame {
  const f = anchorFrame(anchor);
  return {
    toEnu: (point) => enuFrom(f, point),
    toGeodetic: (point) => geodeticFrom(f, point),
  };
}

// Длина градуса широты и долготы на эллипсоиде WGS 84 на широте φ — ряды для меридиана
// и параллели. Не часть модуля геопривязки: ими считает равнопромежуточная проекция плана
// проекта (entities/project/lib/local-frame.ts) и мок сервера, у которого та же проекция.
export function metersPerDegree(latitude: number): { lat: number; lon: number } {
  const phi = (latitude * Math.PI) / 180;
  return {
    lat: 111_132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lon: 111_412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi),
  };
}

// Метры восток / север / вверх относительно опорной точки.
export const geodeticToEnu = (
  point: LatLon & { h?: number },
  anchor: LatLon & { h?: number },
): Enu => enuFrom(anchorFrame(anchor), point);

export const enuToGeodetic = (
  point: PlaneEnu & { u?: number },
  anchor: LatLon & { h?: number },
): Geodetic => geodeticFrom(anchorFrame(anchor), point);

// Жёсткое подобие: вычесть центр, умножить на масштаб, повернуть против часовой стрелки.
// Ось e — восток, ось n — север.
export function similarity({ x, y }: LocalPoint, params: SimilarityParams): PlaneEnu {
  const th = toRad(params.rotationDeg);
  const dx = (x - params.originX) * params.scale;
  const dy = (y - params.originY) * params.scale;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return { e: dx * c - dy * s, n: dx * s + dy * c };
}

// Подгонка подобия в замкнутой форме, без итераций:
//   a = Σ(dx·dX + dy·dY) / Σ(dx² + dy²)
//   b = Σ(dx·dY − dy·dX) / Σ(dx² + dy²)
//   X = a·x − b·y + tx,  Y = b·x + a·y + ty
// Вырожденные входы: одна пара — чистый сдвиг; все точки совпали — знаменатель нулевой,
// возвращаем null, а не NaN.
export function fitSimilarity(
  src: readonly LocalPoint[],
  dst: readonly LocalPoint[],
): FitResult | null {
  const count = Math.min(src.length, dst.length);
  if (count < 1) return null;
  const pairs = src.slice(0, count).flatMap((from, i) => {
    const to = dst[i];
    return to === undefined ? [] : [{ from, to }];
  });

  let mx = 0;
  let my = 0;
  let mX = 0;
  let mY = 0;
  for (const { from, to } of pairs) {
    mx += from.x;
    my += from.y;
    mX += to.x;
    mY += to.y;
  }
  mx /= count;
  my /= count;
  mX /= count;
  mY /= count;

  let a: number;
  let b: number;
  if (count === 1) {
    // Одна опорная точка задаёт только сдвиг.
    a = 1;
    b = 0;
  } else {
    let num1 = 0;
    let num2 = 0;
    let den = 0;
    for (const { from, to } of pairs) {
      const dx = from.x - mx;
      const dy = from.y - my;
      const dX = to.x - mX;
      const dY = to.y - mY;
      num1 += dx * dX + dy * dY;
      num2 += dx * dY - dy * dX;
      den += dx * dx + dy * dy;
    }
    if (den === 0) return null; // все исходные точки совпали
    a = num1 / den;
    b = num2 / den;
    if (a === 0 && b === 0) return null;
  }

  const tx = mX - (a * mx - b * my);
  const ty = mY - (b * mx + a * my);

  let sum2 = 0;
  let maxResidual = 0;
  for (const { from, to } of pairs) {
    const rx = a * from.x - b * from.y + tx - to.x;
    const ry = b * from.x + a * from.y + ty - to.y;
    const r2 = rx * rx + ry * ry;
    sum2 += r2;
    if (r2 > maxResidual) maxResidual = r2;
  }

  return {
    a,
    b,
    tx,
    ty,
    scale: Math.sqrt(a * a + b * b),
    rotationDeg: toDeg(Math.atan2(b, a)),
    rms: Math.sqrt(sum2 / count),
    maxResidual: Math.sqrt(maxResidual),
  };
}

// EPSG:3857: сфера радиуса A поверх эллипсоида WGS 84. Годится для подложки и только для неё.
export function toMercator({ lat, lon }: LatLon): LocalPoint {
  return {
    x: A * toRad(lon),
    y: A * Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2)),
  };
}

// Прямая задача: независимый эталон на эллипсоиде. Приложению не нужна, нужна проверкам, чтобы
// сверять с ней цепочку ENU.
export function vincentyDirect(start: LatLon, azimuthDeg: number, distance: number): LatLon {
  const phi1 = toRad(start.lat);
  const alpha1 = toRad(azimuthDeg);
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);

  const tanU1 = (1 - F) * Math.tan(phi1);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;

  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const aCoef = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bCoef = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

  let sigma = distance / (B * aCoef);
  let sinSigma = 0;
  let cosSigma = 0;
  let cos2SigmaM = 0;
  for (let i = 0; i < 100; i += 1) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const deltaSigma =
      bCoef *
      sinSigma *
      (cos2SigmaM +
        (bCoef / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (bCoef / 6) *
              cos2SigmaM *
              (-3 + 4 * sinSigma * sinSigma) *
              (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    const previous = sigma;
    sigma = distance / (B * aCoef) + deltaSigma;
    if (Math.abs(sigma - previous) < 1e-14) break;
  }

  cos2SigmaM = Math.cos(2 * sigma1 + sigma);
  sinSigma = Math.sin(sigma);
  cosSigma = Math.cos(sigma);

  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const phi2 = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
    (1 - F) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp),
  );
  const lambda = Math.atan2(sinSigma * sinAlpha1, cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1);
  const c = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
  const l =
    lambda -
    (1 - c) *
      F *
      sinAlpha *
      (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));

  return { lat: toDeg(phi2), lon: start.lon + toDeg(l) };
}

export type GeodesicLine = { distance: number; azimuth: number };

// Обратная задача: расстояние по геодезической линии и азимут. Нужна сравнению эталонов — сдвиг
// опорной точки меряется именно по эллипсоиду, а не по касательной плоскости.
export function vincentyInverse(from: LatLon, to: LatLon): GeodesicLine {
  const l = toRad(to.lon - from.lon);
  const u1 = Math.atan((1 - F) * Math.tan(toRad(from.lat)));
  const u2 = Math.atan((1 - F) * Math.tan(toRad(to.lat)));
  const sinU1 = Math.sin(u1);
  const cosU1 = Math.cos(u1);
  const sinU2 = Math.sin(u2);
  const cosU2 = Math.cos(u2);

  let lambda = l;
  let previous: number;
  let i = 0;
  let sinLambda: number;
  let cosLambda: number;
  let sinSigma: number;
  let cosSigma: number;
  let sigma: number;
  let sinAlpha: number;
  let cosSqAlpha: number;
  let cos2SigmaM: number;
  let c: number;

  do {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      cosU2 * sinLambda * (cosU2 * sinLambda) +
        (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda),
    );
    if (sinSigma === 0) return { distance: 0, azimuth: 0 }; // точки совпали
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    c = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
    previous = lambda;
    lambda =
      l +
      (1 - c) *
        F *
        sinAlpha *
        (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    i += 1;
  } while (Math.abs(lambda - previous) > 1e-12 && i < 200);

  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const aCoef = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bCoef = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    bCoef *
    sinSigma *
    (cos2SigmaM +
      (bCoef / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (bCoef / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));

  let azimuth = toDeg(Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda));
  if (azimuth < 0) azimuth += 360;

  return { distance: B * aCoef * (sigma - deltaSigma), azimuth };
}
