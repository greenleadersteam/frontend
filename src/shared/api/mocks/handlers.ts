import { http, HttpResponse } from 'msw';

import { MAX_ARCHIVE_BYTES } from '../archive-limit';
import {
  createProject,
  defaultRunParams,
  deleteProject,
  findProject,
  listProjects,
  type MockProject,
  slotsAvailable,
  startRun,
  statusAt,
  toProjectResponse,
  updateProject,
} from './db';
import { processingDefaults } from './fixtures/processing-defaults';
import type { MockArchive } from './fixtures/projects';
import { RESULT_DXF } from './fixtures/result-dxf';
import { buildSiteResult, type RunParams } from './fixtures/site';

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

type ReadyResult = { project: MockProject; result: ReturnType<typeof buildSiteResult> };

// Как _require_ready_dir: ../backend/greenplan/api/app.py:48-54.
function readyResult(projectId: string): ReadyResult | Response {
  const project = findProject(projectId);
  if (project === undefined) return projectNotFound();
  const status = statusAt(project, Date.now());
  if (status !== 'ready' || project.run === null) {
    return detail(404, `Project data not available yet (status: ${status})`);
  }
  return { project, result: buildSiteResult(project.run.params, project.bbox !== null) };
}

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

  http.get<ProjectParams>(`${API}/projects/:projectId/planting`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    return HttpResponse.json(ready.result.planting, {
      headers: { 'Content-Type': 'application/geo+json' },
    });
  }),

  http.get<ProjectParams>(`${API}/projects/:projectId/dxf`, ({ params }) => {
    const ready = readyResult(params.projectId);
    if (ready instanceof Response) return ready;
    return new HttpResponse(RESULT_DXF, {
      headers: {
        'Content-Type': 'application/dxf',
        'Content-Disposition': `attachment; filename="planting.dxf"; filename*=UTF-8''${encodeRfc5987(ready.project.name)}.dxf`,
      },
    });
  }),

  http.get(`${API}/processing-defaults`, () => HttpResponse.json(processingDefaults)),
];
