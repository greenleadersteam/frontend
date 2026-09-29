import type { PlacementCore } from '@/shared/lib/georeference';

import type { components as Proposed } from '../generated/proposed';
import type { components as Real } from '../generated/schema';
import { processingDefaults } from './fixtures/processing-defaults';
import { type MockArchive, projectSeeds } from './fixtures/projects';
import { DEFAULT_PLACEMENT, placementOf, type RunParams } from './fixtures/site';

type ProjectResponse = Real['schemas']['ProjectResponse'];
type JobStatus = Real['schemas']['JobStatus'];
type JobError = Real['schemas']['JobError'];
type UploadErrorCode = Real['schemas']['UploadErrorCode'];
type ManualGeoreference = Proposed['schemas']['ManualGeoreference'];
type PlantingVersion = Proposed['schemas']['PlantingVersion'];
type PlantingVersionFeature = Proposed['schemas']['PlantingVersionFeature'];

// Версия плана посадок, созданная правкой. Версия 1 — расстановка обработки, она строится
// из результата и здесь не хранится.
export type MockVersion = { meta: PlantingVersion; features: PlantingVersionFeature[] };
type BBox = [number, number, number, number];

type MockRun = {
  queuedAt: number;
  params: RunParams;
  // Главный чертёж последнего /runs: PUT /georeference переобрабатывает с ним же.
  rootDxf: string | null;
  failure: JobError | null;
  // Сценарные проекты из фикстур не занимают слоты, иначе после запуска мока загрузки
  // отвечали бы 429, пока их обработки не закончатся.
  occupiesSlot: boolean;
};

export type MockProject = {
  id: string;
  name: string;
  description: string | null;
  bbox: BBox | null;
  createdAt: number;
  updatedAt: number;
  archive: MockArchive | null;
  run: MockRun | null;
  // Привязка, присланная через PUT /georeference; важнее bbox.
  georeference: ManualGeoreference | null;
  // Версии плана посадок после первой; новая обработка начинает историю заново.
  versions: MockVersion[];
  // Счётчик id посадок, добавленных вручную: id не повторяются между версиями.
  manualPlantings: number;
};

// Как проект привязан к местности: присланная привязка, иначе bbox демо-проекта, иначе —
// без геопривязки, в метрах чертежа.
export function placementOfProject(project: MockProject): PlacementCore | null {
  if (project.georeference !== null) return placementOf(project.georeference);
  return project.bbox === null ? null : DEFAULT_PLACEMENT;
}

// Как GREENPLAN_API_MAX_CONCURRENT_JOBS в d11793e:docker-compose.yml:14 (с 7223e2e compose —
// в репозитории ci, значение не сверено).
const MAX_ACTIVE_RUNS = 2;

// Весь прогон — около 20 с. Проценты — как у бэкенда: ../backend/greenplan/api/jobs.py:54-63.
const STAGES = [
  { stage: 'queued', durationMs: 1000, progress: 0 },
  { stage: 'extracting', durationMs: 2000, progress: 5 },
  { stage: 'parsing', durationMs: 5000, progress: 10 },
  { stage: 'georeferencing', durationMs: 4000, progress: 40 },
  { stage: 'zoning_layout', durationMs: 5000, progress: 70 },
  { stage: 'exporting', durationMs: 3000, progress: 90 },
] as const;

type Stage = (typeof STAGES)[number]['stage'];

// На каком этапе бэкенд обнаруживает ошибку: ../backend/greenplan/api/jobs.py:276-355.
const FAILURE_STAGE: Record<UploadErrorCode, Stage> = {
  bad_archive: 'extracting',
  no_dxf_found: 'parsing',
  ambiguous_root_dxf: 'parsing',
  insufficient_geodetic_points: 'georeferencing',
  georeference_service_error: 'georeferencing',
  other: 'zoning_layout',
};

// Тексты — как их формирует бэкенд; пользователю они не показываются.
const FAILURE_MESSAGES: Record<UploadErrorCode, string> = {
  bad_archive: 'File is not a zip file',
  no_dxf_found: 'No .dxf files found in the archive',
  ambiguous_root_dxf: 'Pass --root <file> to pick the main drawing explicitly.',
  insufficient_geodetic_points: 'Only 1 geodetic point(s) matched, at least 2 are required',
  georeference_service_error: 'timed out',
  other: 'Interrupted by server restart',
};

const toIso = (ms: number): string => new Date(ms).toISOString();

const projects = new Map<string, MockProject>();

export const defaultRunParams = (): RunParams => ({
  plantTypes: processingDefaults.plant_types,
  rules: Object.fromEntries(
    Object.entries(processingDefaults.planting_rules).map(([ruleId, rule]) => [
      ruleId,
      { spacing: rule.spacing_m.default, offset: rule.offset_m?.default ?? null },
    ]),
  ),
});

// Присланная привязка заменяет запрос к geobridge: сбои этапа геопривязки ей не грозят.
function failureOf(
  archive: MockArchive,
  rootDxf: string | null,
  manualGeoreference: boolean,
): JobError | null {
  const { defect } = archive;
  if (defect === null) return null;
  if (manualGeoreference && FAILURE_STAGE[defect.code] === 'georeferencing') return null;
  if (defect.code === 'ambiguous_root_dxf') {
    if (rootDxf !== null && defect.candidates.includes(rootDxf)) return null;
    return {
      code: defect.code,
      message: FAILURE_MESSAGES[defect.code],
      candidates: defect.candidates,
    };
  }
  return { code: defect.code, message: FAILURE_MESSAGES[defect.code] };
}

export function resetMockDb(now = Date.now()): void {
  projects.clear();
  for (const seed of projectSeeds) {
    const createdAt = now - seed.createdDaysAgo * 86_400_000;
    const { archive, run } = seed;
    const transient = run?.transientFailure ?? null;
    projects.set(seed.id, {
      id: seed.id,
      name: seed.name,
      description: seed.description,
      bbox: seed.bbox,
      createdAt,
      updatedAt: createdAt,
      archive,
      georeference: null,
      versions: [],
      manualPlantings: 0,
      run:
        run === null || archive === null
          ? null
          : {
              queuedAt: now - run.queuedSecondsAgo * 1000,
              params: defaultRunParams(),
              rootDxf: null,
              failure:
                transient === null
                  ? failureOf(archive, null, false)
                  : { code: transient, message: FAILURE_MESSAGES[transient] },
              occupiesSlot: false,
            },
    });
  }
}

function jobAt(project: MockProject, now: number): JobStatus {
  const { run } = project;
  if (run === null) return { stage: 'draft', progress_pct: 0 };

  // Без bbox бэкенд пропускает геопривязку: ../backend/greenplan/api/jobs.py:296.
  const georeferenced = placementOfProject(project) !== null;
  const stages = STAGES.filter(({ stage }) => stage !== 'georeferencing' || georeferenced);
  // Воркер перезаписывает started_at при старте, поэтому время в очереди в длительность не входит.
  const workerStartedAt = run.queuedAt + STAGES[0].durationMs;
  let stageStart = run.queuedAt;

  for (const { stage, durationMs, progress } of stages) {
    const stageEnd = stageStart + durationMs;
    if (now < stageEnd) {
      return {
        stage,
        progress_pct: progress,
        started_at: toIso(stage === 'queued' ? run.queuedAt : workerStartedAt),
        finished_at: null,
      };
    }
    if (run.failure !== null && FAILURE_STAGE[run.failure.code] === stage) {
      return {
        stage: 'failed',
        progress_pct: 100,
        error: run.failure,
        started_at: toIso(workerStartedAt),
        finished_at: toIso(stageEnd),
      };
    }
    stageStart = stageEnd;
  }

  return {
    stage: 'ready',
    progress_pct: 100,
    georeference: georeferenceInfo(project),
    started_at: toIso(workerStartedAt),
    finished_at: toIso(stageStart),
  };
}

// Как GeoreferenceInfo бэкенда (../backend/greenplan/api/jobs.py:83-86). Присланная привязка
// отмечается confidence «manual»: невязки — по её опорным точкам, если они были.
function georeferenceInfo(project: MockProject): JobStatus['georeference'] {
  const manual = project.georeference;
  if (manual !== null) {
    const points = manual.control_points.filter(({ used }) => used);
    return {
      confidence: 'manual',
      matched_labels: points.map(({ label }, index) => label ?? String(index + 1)),
      residuals_m: Object.fromEntries(
        points.map(({ label, residual_m }, index) => [label ?? String(index + 1), residual_m]),
      ),
    };
  }
  if (project.bbox === null) return null;
  return {
    confidence: 'validated',
    matched_labels: ['1204', '1207', '1311'],
    residuals_m: { '1204': 0.12, '1207': 0.08, '1311': 0.21 },
  };
}

export const statusAt = (project: MockProject, now: number): string => jobAt(project, now).stage;

// Обработка упала на этапе геопривязки: подоснова уже разобрана, и её объекты есть — в метрах
// чертежа (контракт-предложение, /obstacles).
export function failedOnGeoreference(project: MockProject, now: number): boolean {
  const code = jobAt(project, now).error?.code;
  return code !== undefined && FAILURE_STAGE[code] === 'georeferencing';
}

export function toProjectResponse(project: MockProject, now: number): ProjectResponse {
  const job = jobAt(project, now);
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    created_at: toIso(project.createdAt),
    updated_at: toIso(project.updatedAt),
    status: job.stage,
    job,
  };
}

export const findProject = (id: string): MockProject | undefined => projects.get(id);

export const listProjects = (): MockProject[] =>
  [...projects.values()].sort((a, b) => a.createdAt - b.createdAt);

export function createProject(
  fields: Pick<MockProject, 'name' | 'description' | 'bbox'>,
  now: number,
): MockProject {
  const project: MockProject = {
    ...fields,
    id: crypto.randomUUID().replaceAll('-', ''),
    createdAt: now,
    updatedAt: now,
    archive: null,
    run: null,
    georeference: null,
    versions: [],
    manualPlantings: 0,
  };
  projects.set(project.id, project);
  return project;
}

export function updateProject(
  project: MockProject,
  fields: { name: string | null; description: string | null },
  now: number,
): void {
  project.name = fields.name ?? project.name;
  project.description = fields.description ?? project.description;
  project.updatedAt = now;
}

export const deleteProject = (id: string): boolean => projects.delete(id);

export const slotsAvailable = (now: number): boolean =>
  [...projects.values()].filter(
    (project) =>
      project.run?.occupiesSlot === true && !['ready', 'failed'].includes(statusAt(project, now)),
  ).length < MAX_ACTIVE_RUNS;

export function startRun(
  project: MockProject,
  archive: MockArchive,
  params: RunParams,
  rootDxf: string | null,
  now: number,
): void {
  project.archive = archive;
  project.versions = [];
  project.manualPlantings = 0;
  project.run = {
    queuedAt: now,
    params,
    rootDxf,
    failure: failureOf(archive, rootDxf, project.georeference !== null),
    occupiesSlot: true,
  };
}
