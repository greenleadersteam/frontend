import { http, HttpResponse, type JsonBodyType } from 'msw';

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

type PlantingEdit = Proposed['schemas']['PlantingEdit'];
type PlantingVersionFeature = Proposed['schemas']['PlantingVersionFeature'];
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

// Версия 1 — расстановка обработки в формате версии, точка чертежа — как в /explanation; за ней —
// версии, созданные правками.
function versionsOf({ project, result }: ReadyResult): MockVersion[] {
  const drawing = new Map(result.explanation.map(({ id, x, y }) => [id, { x, y }]));
  const service: MockVersion = {
    meta: {
      id: 1,
      name: null,
      kind: 'auto',
      created_at:
        toProjectResponse(project, Date.now()).job.finished_at ?? new Date().toISOString(),
      based_on: null,
      planting_count: result.planting.features.length,
    },
    features: result.planting.features.map((feature) => {
      const point = drawing.get(feature.properties.id);
      // Фикстура строит /explanation по тем же посадкам, что /planting.
      if (point === undefined) throw new Error(`Нет обоснования у ${feature.properties.id}`);
      return { ...feature, properties: { ...feature.properties, origin: 'auto', ...point } };
    }),
  };
  return [service, ...project.versions];
}

const findVersion = (ready: ReadyResult, version: string): MockVersion | undefined =>
  versionsOf(ready).find(({ meta }) => meta.id === Number(version));

const editIssue = (loc: (string | number)[], msg: string, input: unknown): ValidationIssue => ({
  type: 'value_error',
  loc: ['body', ...loc],
  msg,
  input,
});

// Правка версии по контракту: delete, update, add. Посадка сервиса, удалённая раньше, через
// update возвращается со своим id; в точке расстановки обработки она снова auto.
function applyEdit(
  project: MockProject,
  service: readonly PlantingVersionFeature[],
  base: readonly PlantingVersionFeature[],
  edit: PlantingEdit,
): { features: PlantingVersionFeature[]; addedIds: Record<string, string> } | ValidationIssue {
  if (edit.add.length + edit.update.length + edit.delete.length === 0) {
    return editIssue([], 'Edit is empty', edit);
  }
  const ids = [...edit.update.map(({ id }) => id), ...edit.delete];
  if (new Set(ids).size !== ids.length) return editIssue([], 'Planting id is repeated', ids);
  const current = new Map(base.map((feature) => [feature.properties.id, feature]));
  const original = new Map(service.map((feature) => [feature.properties.id, feature]));
  for (const [index, id] of edit.delete.entries()) {
    if (!current.delete(id)) return editIssue(['delete', index], 'Planting not found', id);
  }
  for (const [index, { id, lon, lat, x: drawingX, y: drawingY }] of edit.update.entries()) {
    const planting = current.get(id) ?? original.get(id);
    if (planting === undefined) return editIssue(['update', index], 'Planting not found', id);
    const [x, y] = original.get(id)?.geometry.coordinates ?? [];
    current.set(id, {
      ...planting,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        ...planting.properties,
        origin: x === lon && y === lat ? 'auto' : 'manual',
        // Точка чертежа — присланная клиентом: сервер её не пересчитывает.
        x: drawingX,
        y: drawingY,
      },
    });
  }
  const addedIds: Record<string, string> = {};
  for (const { client_id: clientId, lon, lat, x, y, plant_type: plantType } of edit.add) {
    project.manualPlantings += 1;
    const id = `MANUAL-${String(project.manualPlantings).padStart(5, '0')}`;
    addedIds[clientId] = id;
    current.set(id, {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        id,
        plant_type: plantType,
        rule_id: null,
        origin: 'manual',
        species_id: null,
        species_reason_ru: null,
        x,
        y,
      },
    });
  }
  return { features: [...current.values()], addedIds };
}

// Разбор тела POST /plantings/{version}/edit по контракту PlantingEdit: мок проверяет то,
// от чего зависит новая версия, — списки, id, точки и тип посадки.
function parseEdit(body: unknown): PlantingEdit | ValidationIssue {
  const invalid = (loc: (string | number)[], msg: string, input: unknown): ValidationIssue => ({
    type: 'value_error',
    loc: ['body', ...loc],
    msg,
    input,
  });
  if (!isRecord(body)) return notAnObject(body);
  const { name, add, update } = body;
  const removed = body.delete;
  if (!(name === undefined || name === null || typeof name === 'string')) {
    return invalid(['name'], 'Input should be a valid string', name);
  }
  if (!Array.isArray(add) || !Array.isArray(update) || !Array.isArray(removed)) {
    return invalid([], 'Fields add, update and delete are required', body);
  }
  const edit: PlantingEdit = { name: name ?? null, add: [], update: [], delete: [] };
  for (const [index, item] of add.entries()) {
    if (
      !isRecord(item) ||
      typeof item.client_id !== 'string' ||
      !isFiniteNumber(item.lon) ||
      !isFiniteNumber(item.lat) ||
      !isFiniteNumber(item.x) ||
      !isFiniteNumber(item.y) ||
      !isPlantType(item.plant_type)
    ) {
      return invalid(['add', index], 'client_id, lon, lat, x, y and plant_type expected', item);
    }
    edit.add.push({
      client_id: item.client_id,
      lon: item.lon,
      lat: item.lat,
      x: item.x,
      y: item.y,
      plant_type: item.plant_type,
    });
  }
  for (const [index, item] of update.entries()) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !isFiniteNumber(item.lon) ||
      !isFiniteNumber(item.lat) ||
      !isFiniteNumber(item.x) ||
      !isFiniteNumber(item.y)
    ) {
      return invalid(['update', index], 'id, lon, lat, x and y expected', item);
    }
    edit.update.push({ id: item.id, lon: item.lon, lat: item.lat, x: item.x, y: item.y });
  }
  for (const [index, id] of removed.entries()) {
    if (typeof id !== 'string') return invalid(['delete', index], 'Id expected', id);
    edit.delete.push(id);
  }
  return edit;
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

  http.get<ProjectParams>(`${API}/projects/:projectId/explanation`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    return HttpResponse.json(ready.result.explanation);
  }),

  http.get<ProjectParams>(`${API}/projects/:projectId/zones`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    return HttpResponse.json(ready.result.zones, {
      headers: { 'Content-Type': 'application/geo+json' },
    });
  }),

  // Последняя версия плана посадок в формате /planting: без origin.
  http.get<ProjectParams>(`${API}/projects/:projectId/planting`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    const latest = versionsOf(ready).at(-1)?.features ?? [];
    return geoJson({
      ...ready.result.planting,
      features: latest.map(({ type, geometry, properties }) => ({
        type,
        geometry,
        properties: {
          id: properties.id,
          plant_type: properties.plant_type,
          rule_id: properties.rule_id,
          species_id: properties.species_id,
          species_reason_ru: properties.species_reason_ru,
        },
      })),
    });
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
      metadata: { crs: ready.result.planting.metadata.crs, version: version.meta.id },
      features: version.features,
    });
  }),

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
      const applied = applyEdit(ready.project, versions[0]?.features ?? [], base.features, edit);
      if (isIssue(applied)) return validationError([applied]);

      const name = edit.name?.trim() ?? '';
      const created: MockVersion = {
        meta: {
          id: (versions.at(-1)?.meta.id ?? 0) + 1,
          name: name === '' ? null : name,
          kind: 'manual',
          created_at: new Date().toISOString(),
          based_on: base.meta.id,
          planting_count: applied.features.length,
        },
        features: applied.features,
      };
      ready.project.versions.push(created);
      return HttpResponse.json({ ...created.meta, added_ids: applied.addedIds }, { status: 201 });
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

  http.get<ProjectParams>(`${API}/projects/:projectId/dxf`, ({ params, request }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    const requested = new URL(request.url).searchParams.get('version');
    const version = requested === null ? versionsOf(ready).at(-1) : findVersion(ready, requested);
    if (version === undefined) return detail(404, 'Planting version not found');
    // Копия подосновы со слоем результата по точкам чертежа версии, как у сервера.
    const dxf = siteDxf(
      buildSiteResult(ready.run.params, null).obstacles.features,
      version.features.map(({ properties }) => ({
        x: properties.x,
        y: properties.y,
        plantType: properties.plant_type,
        ruleId: properties.rule_id,
        id: properties.id,
      })),
    );
    return new HttpResponse(dxf, {
      headers: {
        'Content-Type': 'application/dxf',
        'Content-Disposition': `attachment; filename="planting.dxf"; filename*=UTF-8''${encodeRfc5987(ready.project.name)}.dxf`,
      },
    });
  }),
];

// В браузере — последний обработчик: запрос к /api без своего обработчика обрывается сетевой
// ошибкой. print.error() в onUnhandledRequest только печатает (msw 2.15,
// core/experimental/on-unhandled-frame.mjs), и запрос ушёл бы через прокси на настоящий бэкенд.
export const rejectUnhandledApi = http.all(`${API}/*`, () => HttpResponse.error());
