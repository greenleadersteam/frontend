import { http, HttpResponse, type JsonBodyType } from 'msw';

import { placementTransform } from '@/shared/lib/georeference';

import { MAX_ARCHIVE_BYTES } from '../archive-limit';
import type { components as Proposed } from '../generated/proposed';
import {
  createProject,
  defaultRunParams,
  deleteProject,
  failedOnGeoreference,
  findProject,
  listProjects,
  type MockProject,
  type MockVersion,
  type MockVersionFeature,
  placementOfProject,
  slotsAvailable,
  startRun,
  statusAt,
  toProjectResponse,
  updateProject,
} from './db';
import { NORMS } from './fixtures/norms';
import { processingDefaults } from './fixtures/processing-defaults';
import type { MockArchive } from './fixtures/projects';
import { siteDxf } from './fixtures/result-dxf';
import { buildSiteResult, type RunParams } from './fixtures/site';
import { SPECIES } from './fixtures/species';

type ManualGeoreference = Proposed['schemas']['ManualGeoreference'];

// Совпадает с apiBaseUrl в public/config.json: мок подменяет тот же адрес, что и прокси Vite.
const API = '/api';

type ProjectParams = { projectId: string };
type ValidationIssue = { type: string; loc: (string | number)[]; msg: string; input: unknown };

// Тела ошибок — как у FastAPI: строка detail для HTTPException, массив для 422.
const detail = (status: number, text: string) => HttpResponse.json({ detail: text }, { status });
const projectNotFound = () => detail(404, 'Project not found');
const validationError = (issues: ValidationIssue[]) =>
  HttpResponse.json({ detail: issues }, { status: 422 });
const tooManyJobs = () => detail(429, 'Too many concurrent processing jobs, try again later');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

const jsonInvalid = (): ValidationIssue => ({
  type: 'json_invalid',
  loc: ['body'],
  msg: 'JSON decode error',
  input: null,
});

const notAnObject = (input: unknown): ValidationIssue => ({
  type: 'model_attributes_type',
  loc: ['body'],
  msg: 'Input should be a valid dictionary or object to extract fields from',
  input,
});

function optionalString(body: Record<string, unknown>, field: string): ValidationIssue[] {
  const value = body[field];
  if (value === undefined || value === null || typeof value === 'string') return [];
  return [
    {
      type: 'string_type',
      loc: ['body', field],
      msg: 'Input should be a valid string',
      input: value,
    },
  ];
}

const bboxOf = (value: unknown): MockProject['bbox'] | undefined => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [minLon, minLat, maxLon, maxLat] = value.filter(isFiniteNumber);
  if (
    minLon === undefined ||
    minLat === undefined ||
    maxLon === undefined ||
    maxLat === undefined
  ) {
    return undefined;
  }
  return [minLon, minLat, maxLon, maxLat];
};

type ProjectFields = Pick<MockProject, 'name' | 'description' | 'bbox'>;

function parseProjectFields(
  body: Record<string, unknown>,
): { ok: true; fields: ProjectFields } | { ok: false; issues: ValidationIssue[] } {
  const { name, description } = body;
  const bbox = bboxOf(body.bbox_user);
  const issues = optionalString(body, 'description');
  if (name === undefined) {
    issues.push({ type: 'missing', loc: ['body', 'name'], msg: 'Field required', input: body });
  } else {
    issues.push(...optionalString(body, 'name'));
  }
  if (bbox === undefined) {
    issues.push({
      type: 'tuple_type',
      loc: ['body', 'bbox_user'],
      msg: 'Input should be a valid tuple of 4 numbers',
      input: body.bbox_user,
    });
  }
  if (issues.length > 0 || typeof name !== 'string' || bbox === undefined) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    fields: { name, description: typeof description === 'string' ? description : null, bbox },
  };
}

function rangeIssue(
  loc: (string | number)[],
  value: unknown,
  range: { min: number; max: number },
): ValidationIssue[] {
  if (!isFiniteNumber(value)) {
    return [{ type: 'float_type', loc, msg: 'Input should be a valid number', input: value }];
  }
  if (value < range.min) {
    return [
      {
        type: 'greater_than_equal',
        loc,
        msg: `Input should be greater than or equal to ${String(range.min)}`,
        input: value,
      },
    ];
  }
  if (value > range.max) {
    return [
      {
        type: 'less_than_equal',
        loc,
        msg: `Input should be less than or equal to ${String(range.max)}`,
        input: value,
      },
    ];
  }
  return [];
}

type ParsedRun =
  | { ok: true; params: RunParams; rootDxf: string | null }
  | { ok: false; issues: ValidationIssue[] };

// Проверки RunRequest — по описанию в contracts/openapi.proposed.yaml.
function parseRunRequest(body: unknown, archive: MockArchive): ParsedRun {
  if (!isRecord(body)) return { ok: false, issues: [notAnObject(body)] };
  const issues: ValidationIssue[] = [];
  const params = defaultRunParams();

  const rootDxf = body.root_dxf;
  if (rootDxf !== undefined) {
    const candidates =
      archive.defect?.code === 'ambiguous_root_dxf' ? archive.defect.candidates : null;
    if (typeof rootDxf !== 'string' || (candidates !== null && !candidates.includes(rootDxf))) {
      issues.push({
        type: 'value_error',
        loc: ['body', 'root_dxf'],
        msg: 'Value error, root_dxf is not a DXF file from the uploaded archive',
        input: rootDxf,
      });
    }
  }

  const plantTypes = body.plant_types;
  if (plantTypes !== undefined) {
    const valid =
      Array.isArray(plantTypes) &&
      plantTypes.length > 0 &&
      new Set(plantTypes).size === plantTypes.length &&
      plantTypes.every((value) => value === 'tree' || value === 'shrub');
    if (valid) {
      params.plantTypes = processingDefaults.plant_types.filter((type) =>
        plantTypes.includes(type),
      );
    } else {
      issues.push({
        type: 'value_error',
        loc: ['body', 'plant_types'],
        msg: "Value error, plant_types must be a non-empty list of unique 'tree' | 'shrub'",
        input: plantTypes,
      });
    }
  }

  const overrides = body.planting_rules;
  if (overrides !== undefined && !isRecord(overrides)) {
    issues.push({
      type: 'dict_type',
      loc: ['body', 'planting_rules'],
      msg: 'Input should be a valid dictionary',
      input: overrides,
    });
  }
  for (const [ruleId, override] of Object.entries(isRecord(overrides) ? overrides : {})) {
    const loc = ['body', 'planting_rules', ruleId];
    const defaults = processingDefaults.planting_rules[ruleId];
    const resolved = params.rules[ruleId];
    if (defaults === undefined || resolved === undefined) {
      issues.push({ type: 'value_error', loc, msg: 'Value error, unknown rule_id', input: ruleId });
      continue;
    }
    if (!isRecord(override)) {
      issues.push({ type: 'model_type', loc, msg: 'Input should be an object', input: override });
      continue;
    }
    const spacingIssues =
      override.spacing_m === undefined
        ? []
        : rangeIssue([...loc, 'spacing_m'], override.spacing_m, defaults.spacing_m);
    const offsetIssues =
      override.offset_m === undefined
        ? []
        : defaults.offset_m === null
          ? [
              {
                type: 'extra_forbidden',
                loc: [...loc, 'offset_m'],
                msg: 'Extra inputs are not permitted',
                input: override.offset_m,
              },
            ]
          : rangeIssue([...loc, 'offset_m'], override.offset_m, defaults.offset_m);
    issues.push(...spacingIssues, ...offsetIssues);
    if (spacingIssues.length === 0 && isFiniteNumber(override.spacing_m)) {
      resolved.spacing = override.spacing_m;
    }
    if (offsetIssues.length === 0 && isFiniteNumber(override.offset_m)) {
      resolved.offset = override.offset_m;
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, params, rootDxf: typeof rootDxf === 'string' ? rootDxf : null };
}

const decodeFilename = (header: string | null): string => {
  if (header === null) return '';
  try {
    return decodeURIComponent(header);
  } catch {
    return header;
  }
};

// Имя для filename* по RFC 5987: encodeURIComponent оставляет ' ( ) *, а в attr-char их нет.
const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

type ReadyResult = {
  project: MockProject;
  run: NonNullable<MockProject['run']>;
  result: ReturnType<typeof buildSiteResult>;
};

// Как _require_ready_dir: ../backend/greenplan/api/app.py:48-54.
function readyResult(projectId: string): ReadyResult | Response {
  const project = findProject(projectId);
  if (project === undefined) return projectNotFound();
  const status = statusAt(project, Date.now());
  if (status !== 'ready' || project.run === null) {
    return detail(404, `Project data not available yet (status: ${status})`);
  }
  return {
    project,
    run: project.run,
    result: buildSiteResult(project.run.params, placementOfProject(project)),
  };
}

const geoJson = (body: JsonBodyType) =>
  HttpResponse.json(body, { headers: { 'Content-Type': 'application/geo+json' } });

const isPlantType = (value: unknown): value is 'tree' | 'shrub' =>
  value === 'tree' || value === 'shrub';

type VersionParams = ProjectParams & { version: string };

// Как у сервера: ../backend/greenplan/api/plantings.py.
const FIRST_VERSION_NAME = 'Автоматическая посадка';
const MANUAL_ID_PREFIX = 'manual-';
const BBOX_MARGIN_DEG = 0.01;
const MOVE_THRESHOLD_M = 0.01;
const NOTE_MOVED = 'Перемещено вручную; соответствие правилу размещения не гарантируется';
const NOTE_RETYPED =
  'Тип растения изменён вручную; соответствие правилу размещения не гарантируется';
const NOTE_MANUAL = 'Добавлено вручную; проверка по зонам на сервере не выполнялась';

// Сборка DXF и объяснений правленой версии: сервер делает её в фоне (run_version_export_job),
// мок — за несколько секунд, чтобы в «Демо» был виден путь 202 → готово.
const EXPORT_DURATION_MS = 4000;
const EXPORT_RETRY_AFTER_S = 2;

const countsOf = (features: readonly MockVersionFeature[]) => {
  const tree = features.filter(({ properties }) => properties.plant_type === 'tree').length;
  return { tree, shrub: features.length - tree, total: features.length };
};

// Версия 1 — расстановка обработки в формате версии; за ней — версии, созданные правками.
function versionsOf({ project, result }: ReadyResult): MockVersion[] {
  const features: MockVersionFeature[] = result.planting.features.map((feature) => ({
    ...feature,
    properties: { ...feature.properties, kind: 'auto' },
  }));
  const service: MockVersion = {
    meta: {
      id: 1,
      name: FIRST_VERSION_NAME,
      kind: 'auto',
      created_at:
        toProjectResponse(project, Date.now()).job.finished_at ?? new Date().toISOString(),
      based_on: null,
      counts: countsOf(features),
      export_status: 'ready',
      export_error: null,
    },
    features,
    exportReadyAt: 0,
  };
  const now = Date.now();
  return [
    service,
    ...project.versions.map((version) => {
      const status: MockVersion['meta']['export_status'] =
        now < version.exportReadyAt ? 'pending' : 'ready';
      return { ...version, meta: { ...version.meta, export_status: status } };
    }),
  ];
}

// Пока версия собирается — 202 с Retry-After, как _version_file сервера.
const exportPending = (version: MockVersion): Response | null =>
  version.meta.export_status === 'pending'
    ? HttpResponse.json(
        { version: version.meta.id, export_status: 'pending' },
        { status: 202, headers: { 'Retry-After': String(EXPORT_RETRY_AFTER_S) } },
      )
    : null;

const findVersion = (ready: ReadyResult, version: string): MockVersion | undefined =>
  versionsOf(ready).find(({ meta }) => meta.id === Number(version));

// Точка плана в метрах чертежа — как у сервера, обратным преобразованием привязки обработки
// (../backend/greenplan/api/jobs.py, run_version_export_job). Без привязки план — в метрах
// чертежа.
function drawingPointOf(project: MockProject): (point: readonly number[]) => [number, number] {
  const placement = placementOfProject(project);
  if (placement === null) return ([x = 0, y = 0]) => [x, y];
  const { toLocal } = placementTransform(placement);
  return ([lon = 0, lat = 0]) => {
    const { x, y } = toLocal({ lat, lon });
    return [x, y];
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

// Объяснения версии — как build_explanations сервера: у посадки сервиса — правило и отметки
// правки, у добавленной вручную — версия, где её добавили, и примечание.
function explanationOf(ready: ReadyResult, version: MockVersion): JsonBodyType {
  if (version.meta.id === 1) return ready.result.explanation;
  const service = new Map(ready.result.explanation.map((entry) => [entry.id, entry]));
  const original = new Map(
    ready.result.planting.features.map((feature) => [feature.properties.id, feature]),
  );
  const toDrawing = drawingPointOf(ready.project);
  return version.features.map(({ geometry, properties }) => {
    const [x, y] = toDrawing(geometry.coordinates);
    if (properties.kind === 'manual') {
      return {
        id: properties.id,
        plant_type: properties.plant_type,
        kind: 'manual',
        rule_id: null,
        rule_name_ru: null,
        x: round2(x),
        y: round2(y),
        added_in_version: properties.added_in_version ?? null,
        zone_check: 'not_checked',
        note: NOTE_MANUAL,
      };
    }
    const entry = service.get(properties.id);
    const before = original.get(properties.id);
    const [bx, by] = before === undefined ? [x, y] : toDrawing(before.geometry.coordinates);
    const displacement = Math.hypot(x - bx, y - by);
    const moved = displacement >= MOVE_THRESHOLD_M;
    const retyped = before !== undefined && before.properties.plant_type !== properties.plant_type;
    return {
      ...entry,
      id: properties.id,
      plant_type: properties.plant_type,
      kind: 'auto',
      x: round2(x),
      y: round2(y),
      moved,
      ...(moved && { displacement_m: round2(displacement) }),
      ...(retyped && { original_plant_type: before.properties.plant_type }),
      ...((moved || retyped) && {
        zone_check: 'not_checked',
        note: moved ? NOTE_MOVED : NOTE_RETYPED,
      }),
    };
  });
}

type EditAdd = { client_id: string; plant_type: 'tree' | 'shrub'; lon: number; lat: number };
type EditUpdate = { id: string; lon?: number; lat?: number; plant_type?: 'tree' | 'shrub' };
type MockEdit = { name: string | null; add: EditAdd[]; update: EditUpdate[]; delete: string[] };

// Правка версии — как _apply_edit сервера: все ошибки разом, типы ошибок — его коды.
function applyEdit(
  project: MockProject,
  base: readonly MockVersionFeature[],
  edit: MockEdit,
  newVersion: number,
): { features: MockVersionFeature[]; idMap: Record<string, string> } | ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (loc: (string | number)[], type: string, msg: string) => {
    issues.push({ type, loc: ['body', ...loc], msg, input: null });
  };
  const byId = new Map(base.map((feature) => [feature.properties.id, feature]));
  const placement = placementOfProject(project);
  const checkPoint = (loc: (string | number)[], lon: number, lat: number) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      issue(loc, 'coordinates_not_finite', 'coordinates must be finite numbers');
      return;
    }
    const bbox = project.bbox;
    if (placement === null || bbox === null) return;
    const [minX, minY, maxX, maxY] = bbox;
    const inside =
      lon >= minX - BBOX_MARGIN_DEG &&
      lon <= maxX + BBOX_MARGIN_DEG &&
      lat >= minY - BBOX_MARGIN_DEG &&
      lat <= maxY + BBOX_MARGIN_DEG;
    if (!inside) {
      issue(
        loc,
        'outside_project_bbox',
        `point (${String(lon)}, ${String(lat)}) is outside the project bbox`,
      );
    }
  };
  if (edit.add.length + edit.update.length + edit.delete.length === 0) {
    issue([], 'empty_edit', 'edit is empty: add, update and delete are all empty');
  }
  const clientIds = new Set<string>();
  for (const [index, item] of edit.add.entries()) {
    if (clientIds.has(item.client_id)) {
      issue(
        ['add', index, 'client_id'],
        'duplicate_client_id',
        `duplicate client_id '${item.client_id}'`,
      );
    }
    clientIds.add(item.client_id);
    checkPoint(['add', index], item.lon, item.lat);
  }
  const updated = new Set<string>();
  for (const [index, item] of edit.update.entries()) {
    if (updated.has(item.id))
      issue(['update', index, 'id'], 'duplicate_id', `duplicate id '${item.id}'`);
    updated.add(item.id);
    if (!byId.has(item.id)) {
      issue(['update', index, 'id'], 'unknown_id', `no point with id '${item.id}' in this version`);
    }
    if ((item.lon === undefined) !== (item.lat === undefined)) {
      issue(['update', index], 'lon_lat_pair', 'lon and lat must be given together');
    } else if (item.lon !== undefined && item.lat !== undefined) {
      checkPoint(['update', index], item.lon, item.lat);
    }
    if (item.lon === undefined && item.lat === undefined && item.plant_type === undefined) {
      issue(
        ['update', index],
        'nothing_to_update',
        'nothing to change: give lon/lat and/or plant_type',
      );
    }
  }
  for (const [index, id] of edit.delete.entries()) {
    if (!byId.has(id))
      issue(['delete', index], 'unknown_id', `no point with id '${id}' in this version`);
    if (updated.has(id)) {
      issue(['delete', index], 'update_delete_conflict', `id '${id}' is both updated and deleted`);
    }
  }
  if (issues.length > 0) return issues;

  const next = new Map(base.map((feature) => [feature.properties.id, structuredClone(feature)]));
  for (const item of edit.update) {
    const feature = next.get(item.id);
    if (feature === undefined) continue;
    if (item.lon !== undefined && item.lat !== undefined) {
      feature.geometry = { type: 'Point', coordinates: [item.lon, item.lat] };
    }
    if (item.plant_type !== undefined) feature.properties.plant_type = item.plant_type;
  }
  for (const id of edit.delete) next.delete(id);
  const idMap: Record<string, string> = {};
  for (const item of edit.add) {
    project.manualPlantings += 1;
    const id = `${MANUAL_ID_PREFIX}${String(project.manualPlantings).padStart(5, '0')}`;
    idMap[item.client_id] = id;
    next.set(id, {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [item.lon, item.lat] },
      properties: {
        id,
        plant_type: item.plant_type,
        kind: 'manual',
        rule_id: null,
        added_in_version: newVersion,
      },
    });
  }
  return { features: [...next.values()], idMap };
}

// Разбор тела POST /plantings/{version}/edit по схеме PlantingEdit сервера: лишние поля, как у
// pydantic, пропускаются.
function parseEdit(body: unknown): MockEdit | ValidationIssue {
  const invalid = (loc: (string | number)[], msg: string, input: unknown): ValidationIssue => ({
    type: 'value_error',
    loc: ['body', ...loc],
    msg,
    input,
  });
  if (!isRecord(body)) return notAnObject(body);
  const { name, add = [], update = [] } = body;
  const removed = body.delete ?? [];
  if (!(name === undefined || name === null || typeof name === 'string')) {
    return invalid(['name'], 'Input should be a valid string', name);
  }
  if (!Array.isArray(add) || !Array.isArray(update) || !Array.isArray(removed)) {
    return invalid([], 'Input should be a valid list', body);
  }
  const edit: MockEdit = { name: name ?? null, add: [], update: [], delete: [] };
  for (const [index, item] of add.entries()) {
    if (
      !isRecord(item) ||
      typeof item.client_id !== 'string' ||
      typeof item.lon !== 'number' ||
      typeof item.lat !== 'number' ||
      !isPlantType(item.plant_type)
    ) {
      return invalid(['add', index], 'client_id, plant_type, lon and lat expected', item);
    }
    edit.add.push({
      client_id: item.client_id,
      plant_type: item.plant_type,
      lon: item.lon,
      lat: item.lat,
    });
  }
  for (const [index, item] of update.entries()) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !(item.lon === undefined || item.lon === null || typeof item.lon === 'number') ||
      !(item.lat === undefined || item.lat === null || typeof item.lat === 'number') ||
      !(item.plant_type === undefined || item.plant_type === null || isPlantType(item.plant_type))
    ) {
      return invalid(['update', index], 'id expected; lon, lat and plant_type optional', item);
    }
    edit.update.push({
      id: item.id,
      ...(typeof item.lon === 'number' && { lon: item.lon }),
      ...(typeof item.lat === 'number' && { lat: item.lat }),
      ...(isPlantType(item.plant_type) && { plant_type: item.plant_type }),
    });
  }
  for (const [index, id] of removed.entries()) {
    if (typeof id !== 'string')
      return invalid(['delete', index], 'Input should be a valid string', id);
    edit.delete.push(id);
  }
  return edit;
}

// DXF версии — копия подосновы со слоем результата по точкам чертежа версии, как у сервера.
function versionDxf(ready: ReadyResult, version: MockVersion): Response {
  const service = new Map(ready.result.explanation.map((entry) => [entry.id, entry]));
  const original = new Map(
    ready.result.planting.features.map((feature) => [feature.properties.id, feature]),
  );
  const toDrawing = drawingPointOf(ready.project);
  const dxf = siteDxf(
    buildSiteResult(ready.run.params, null).obstacles.features,
    version.features.map(({ geometry, properties }) => {
      const unmoved =
        original.get(properties.id)?.geometry.coordinates.join() === geometry.coordinates.join();
      const entry = service.get(properties.id);
      const [x, y] =
        unmoved && entry !== undefined ? [entry.x, entry.y] : toDrawing(geometry.coordinates);
      return {
        x,
        y,
        plantType: properties.plant_type,
        ruleId: properties.rule_id,
        id: properties.id,
      };
    }),
  );
  const fileName = `${ready.project.name} — версия ${String(version.meta.id)}.dxf`;
  return new HttpResponse(dxf, {
    headers: {
      'Content-Type': 'image/vnd.dxf',
      'Content-Disposition': `attachment; filename="planting.dxf"; filename*=UTF-8''${encodeRfc5987(fileName)}`,
    },
  });
}

// Разбор тела PUT /georeference: числа там, где контракт их требует.
function parseGeoreference(body: unknown): ManualGeoreference | ValidationIssue {
  const invalid = (loc: string, input: unknown): ValidationIssue => ({
    type: 'value_error',
    loc: ['body', loc],
    msg: 'Invalid value',
    input,
  });
  if (!isRecord(body)) return notAnObject(body);
  const { anchor_wgs84: wgs84, anchor_drawing: drawing, rotation_deg, scale, method, rms_m } = body;
  if (!isRecord(wgs84) || !isFiniteNumber(wgs84.lat) || !isFiniteNumber(wgs84.lon)) {
    return invalid('anchor_wgs84', wgs84);
  }
  if (!isRecord(drawing) || !isFiniteNumber(drawing.x) || !isFiniteNumber(drawing.y)) {
    return invalid('anchor_drawing', drawing);
  }
  if (!isFiniteNumber(rotation_deg)) return invalid('rotation_deg', rotation_deg);
  if (!isFiniteNumber(scale) || scale <= 0) return invalid('scale', scale);
  if (method !== 'manual' && method !== 'control_points') return invalid('method', method);
  if (!(rms_m === null || isFiniteNumber(rms_m))) return invalid('rms_m', rms_m);
  if (!Array.isArray(body.control_points)) return invalid('control_points', body.control_points);
  const controlPoints: ManualGeoreference['control_points'] = [];
  for (const point of body.control_points) {
    if (
      !isRecord(point) ||
      !isRecord(point.drawing) ||
      !isFiniteNumber(point.drawing.x) ||
      !isFiniteNumber(point.drawing.y) ||
      !isRecord(point.wgs84) ||
      !isFiniteNumber(point.wgs84.lat) ||
      !isFiniteNumber(point.wgs84.lon) ||
      !isFiniteNumber(point.residual_m) ||
      typeof point.used !== 'boolean'
    ) {
      return invalid('control_points', point);
    }
    controlPoints.push({
      label: typeof point.label === 'string' ? point.label : null,
      drawing: { x: point.drawing.x, y: point.drawing.y },
      wgs84: { lat: point.wgs84.lat, lon: point.wgs84.lon },
      residual_m: point.residual_m,
      used: point.used,
    });
  }
  return {
    anchor_wgs84: { lat: wgs84.lat, lon: wgs84.lon },
    anchor_drawing: { x: drawing.x, y: drawing.y },
    rotation_deg,
    scale,
    method,
    rms_m,
    control_points: controlPoints,
  };
}

const isIssue = (value: object): value is ValidationIssue => 'msg' in value && 'loc' in value;

export const handlers = [
  http.get(`${API}/projects`, () =>
    HttpResponse.json(listProjects().map((project) => toProjectResponse(project, Date.now()))),
  ),

  http.post(`${API}/projects`, async ({ request }) => {
    const parsed = await readJson(request);
    if (!parsed.ok) return validationError([jsonInvalid()]);
    const { body } = parsed;
    if (!isRecord(body)) return validationError([notAnObject(body)]);
    const parsedFields = parseProjectFields(body);
    if (!parsedFields.ok) return validationError(parsedFields.issues);

    const now = Date.now();
    const project = createProject(parsedFields.fields, now);
    return HttpResponse.json(toProjectResponse(project, now), { status: 201 });
  }),

  http.get<ProjectParams>(`${API}/projects/:projectId`, ({ params }) => {
    const project = findProject(params.projectId);
    if (project === undefined) return projectNotFound();
    return HttpResponse.json(toProjectResponse(project, Date.now()));
  }),

  http.patch<ProjectParams>(`${API}/projects/:projectId`, async ({ params, request }) => {
    const project = findProject(params.projectId);
    if (project === undefined) return projectNotFound();
    const parsed = await readJson(request);
    if (!parsed.ok) return validationError([jsonInvalid()]);
    const { body } = parsed;
    if (!isRecord(body)) return validationError([notAnObject(body)]);
    const issues = [...optionalString(body, 'name'), ...optionalString(body, 'description')];
    if (issues.length > 0) return validationError(issues);

    const now = Date.now();
    updateProject(
      project,
      {
        name: typeof body.name === 'string' ? body.name : null,
        description: typeof body.description === 'string' ? body.description : null,
      },
      now,
    );
    return HttpResponse.json(toProjectResponse(project, now));
  }),

  http.delete<ProjectParams>(`${API}/projects/:projectId`, ({ params }) =>
    deleteProject(params.projectId) ? new HttpResponse(null, { status: 204 }) : projectNotFound(),
  ),

  // Порядок проверок — как в ../backend/greenplan/api/app.py:97-135: 404, 409, 429, затем тело.
  http.post<ProjectParams>(`${API}/projects/:projectId/upload`, async ({ params, request }) => {
    const project = findProject(params.projectId);
    if (project === undefined) return projectNotFound();
    const now = Date.now();
    const status = statusAt(project, now);
    if (status !== 'draft' && status !== 'failed') {
      return detail(409, `Project is not uploadable in status '${status}'`);
    }

    // Сценарии для демо и ручных проверок задаются именем файла.
    const filename = decodeFilename(request.headers.get('X-Upload-Filename'));
    if (filename.includes('busy') || !slotsAvailable(now)) return tooManyJobs();

    const size = (await request.arrayBuffer()).byteLength;
    if (size > MAX_ARCHIVE_BYTES) return detail(413, 'Upload exceeds the maximum allowed size');
    if (size === 0) return detail(400, 'No file body provided');

    const archive: MockArchive = {
      filename,
      defect: filename.includes('ambiguous')
        ? {
            code: 'ambiguous_root_dxf',
            candidates: ['Генплан.dxf', 'Генплан_корр.dxf'],
          }
        : filename.includes('nodxf')
          ? { code: 'no_dxf_found' }
          : null,
    };
    startRun(project, archive, defaultRunParams(), null, now);
    return HttpResponse.json(toProjectResponse(project, now), { status: 202 });
  }),

  http.post<ProjectParams>(`${API}/projects/:projectId/runs`, async ({ params, request }) => {
    const project = findProject(params.projectId);
    if (project === undefined) return projectNotFound();
    const now = Date.now();
    const status = statusAt(project, now);
    const { archive } = project;
    if (archive === null) return detail(409, 'No archive uploaded for this project');
    if (status !== 'ready' && status !== 'failed') {
      return detail(409, `Project is not runnable in status '${status}'`);
    }

    const parsed = await readJson(request);
    if (!parsed.ok) return validationError([jsonInvalid()]);
    const run = parseRunRequest(parsed.body, archive);
    if (!run.ok) return validationError(run.issues);
    if (!slotsAvailable(now)) return tooManyJobs();

    startRun(project, archive, run.params, run.rootDxf, now);
    return HttpResponse.json(toProjectResponse(project, now), { status: 202 });
  }),

  // Объяснения последней версии, как у сервера: get_explanation.
  http.get<ProjectParams>(`${API}/projects/:projectId/explanation`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    const latest = versionsOf(ready).at(-1);
    if (latest === undefined) return HttpResponse.json(ready.result.explanation);
    return exportPending(latest) ?? HttpResponse.json(explanationOf(ready, latest));
  }),

  http.get<ProjectParams>(`${API}/projects/:projectId/zones`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    return HttpResponse.json(ready.result.zones, {
      headers: { 'Content-Type': 'application/geo+json' },
    });
  }),

  // Последняя версия плана посадок, как у сервера: get_planting.
  http.get<ProjectParams>(`${API}/projects/:projectId/planting`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    const latest = versionsOf(ready).at(-1)?.features ?? [];
    return geoJson({ ...ready.result.planting, features: latest });
  }),

  http.get<ProjectParams>(`${API}/projects/:projectId/obstacles`, ({ params }) => {
    const project = findProject(params.projectId);
    // Упавший на геопривязке проект: объекты разобранной подосновы — в метрах чертежа, по ним
    // модуль геопривязки берёт границу участка.
    if (project?.run != null && failedOnGeoreference(project, Date.now())) {
      return geoJson(buildSiteResult(project.run.params, null).obstacles);
    }
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    return geoJson(ready.result.obstacles);
  }),

  http.get<ProjectParams>(`${API}/projects/:projectId/rejected`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    return geoJson(ready.result.rejected);
  }),

  http.get(`${API}/norms`, () => HttpResponse.json(NORMS)),

  http.get(`${API}/species`, () => HttpResponse.json(SPECIES)),

  http.get<ProjectParams>(`${API}/projects/:projectId/plantings`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    return HttpResponse.json(versionsOf(ready).map(({ meta }) => meta));
  }),

  http.get<VersionParams>(`${API}/projects/:projectId/plantings/:version`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    const version = findVersion(ready, params.version);
    if (version === undefined) return detail(404, 'Planting version not found');
    return geoJson({
      type: 'FeatureCollection',
      metadata: { crs: ready.result.planting.metadata.crs },
      features: version.features,
    });
  }),

  http.get<VersionParams>(`${API}/projects/:projectId/plantings/:version/dxf`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    const version = findVersion(ready, params.version);
    if (version === undefined) return detail(404, 'Planting version not found');
    return exportPending(version) ?? versionDxf(ready, version);
  }),

  http.get<VersionParams>(
    `${API}/projects/:projectId/plantings/:version/explanation`,
    ({ params }) => {
      const ready = readyResult(params.projectId);
      if (ready instanceof Response) return ready;
      const version = findVersion(ready, params.version);
      if (version === undefined) return detail(404, 'Planting version not found');
      return exportPending(version) ?? HttpResponse.json(explanationOf(ready, version));
    },
  ),

  http.post<VersionParams>(
    `${API}/projects/:projectId/plantings/:version/edit`,
    async ({ params, request }) => {
      const ready = readyResult(params.projectId);
      if (ready instanceof Response) return ready;
      const versions = versionsOf(ready);
      const base = findVersion(ready, params.version);
      if (base === undefined) return detail(404, 'Planting version not found');
      const parsed = await readJson(request);
      if (!parsed.ok) return validationError([jsonInvalid()]);
      const edit = parseEdit(parsed.body);
      if (isIssue(edit)) return validationError([edit]);
      const id = (versions.at(-1)?.meta.id ?? 0) + 1;
      const applied = applyEdit(ready.project, base.features, edit, id);
      if (Array.isArray(applied)) return validationError(applied);

      // Сборка DXF и объяснений начинается сразу, как у сервера при свободном слоте.
      const created: MockVersion = {
        meta: {
          id,
          name: edit.name === null || edit.name === '' ? `Версия ${String(id)}` : edit.name,
          kind: 'manual',
          created_at: new Date().toISOString(),
          based_on: base.meta.id,
          counts: countsOf(applied.features),
          export_status: 'pending',
          export_error: null,
        },
        features: applied.features,
        exportReadyAt: Date.now() + EXPORT_DURATION_MS,
      };
      ready.project.versions.push(created);
      return HttpResponse.json({ version: created.meta, id_map: applied.idMap }, { status: 201 });
    },
  ),

  http.put<ProjectParams>(
    `${API}/projects/:projectId/georeference`,
    async ({ params, request }) => {
      const project = findProject(params.projectId);
      if (project === undefined) return projectNotFound();
      const now = Date.now();
      const status = statusAt(project, now);
      const { archive } = project;
      if (archive === null) return detail(409, 'No archive uploaded for this project');
      if (status !== 'ready' && status !== 'failed') {
        return detail(409, `Project is not runnable in status '${status}'`);
      }
      const parsed = await readJson(request);
      if (!parsed.ok) return validationError([jsonInvalid()]);
      const georeference = parseGeoreference(parsed.body);
      if (isIssue(georeference)) return validationError([georeference]);
      if (!slotsAvailable(now)) return tooManyJobs();

      project.georeference = georeference;
      startRun(
        project,
        archive,
        project.run?.params ?? defaultRunParams(),
        project.run?.rootDxf ?? null,
        now,
      );
      return HttpResponse.json(toProjectResponse(project, now), { status: 202 });
    },
  ),

  // DXF последней версии, как у сервера: get_dxf.
  http.get<ProjectParams>(`${API}/projects/:projectId/dxf`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    const latest = versionsOf(ready).at(-1);
    if (latest === undefined) return detail(404, 'Planting version not found');
    return exportPending(latest) ?? versionDxf(ready, latest);
  }),
];

// В браузере — последний обработчик: запрос к /api без своего обработчика обрывается сетевой
// ошибкой. print.error() в onUnhandledRequest только печатает (msw 2.15,
// core/experimental/on-unhandled-frame.mjs), и запрос ушёл бы через прокси на настоящий бэкенд.
export const rejectUnhandledApi = http.all(`${API}/*`, () => HttpResponse.error());
