export { downloadProjectDxf } from './api/download-dxf';
export {
  useCreateProjectMutation,
  useDeleteProjectMutation,
  useLazyGetProjectQuery,
  useRunProjectMutation,
} from './api/project-api';
export type {
  ExplanationEntry,
  Norm,
  ObstaclesFeatureCollection,
  PlantingFeatureCollection,
  ZonesFeatureCollection,
} from './api/project-result-api';
export {
  useGetExplanationQuery,
  useGetNormsQuery,
  useGetObstaclesQuery,
  useGetPlantingQuery,
  useGetZonesQuery,
} from './api/project-result-api';
export {
  GEOREFERENCE_CONFIDENCE_LABELS,
  JOB_ERROR_LABELS,
  obstacleLabel,
  PLANT_TYPE_LABELS,
  RESULT_COUNT_FORMS,
  STAGE_LABELS,
} from './config/labels';
export { dimensionLines } from './lib/dimension-lines';
export { projectFileName } from './lib/file-name';
export { createLocalFrame, type LocalFrame } from './lib/local-frame';
export { toMapData, toMapObstacles } from './lib/map-data';
export type { PreparedObstacle, PreparedObstacles } from './lib/obstacle-checks';
export { checksAgainstObstacles, prepareObstacles } from './lib/obstacle-checks';
export { CROWN_RADIUS_M, isGeographic, pixelsPerMeterAtZoom } from './lib/plan-projection';
export type { PlantingCheck, PreparedZones, ProhibitedZone } from './lib/planting-checks';
export {
  allowedArea,
  checksForPlanting,
  lawnArea,
  prepareZones,
  prohibitedArea,
  TOLERANCE_M,
  zoneArea,
} from './lib/planting-checks';
export type { ResultData, ResultLayerGroup } from './lib/result-layers';
export {
  dimensionLabelsMinZoom,
  HATCH_IMAGE,
  hatchPattern,
  OBSTACLE_LAYERS,
  obstacleGroup,
  plantTypeFilters,
  RESULT_LAYER,
  RESULT_LAYER_GROUPS,
  RESULT_SOURCE,
  resultCounts,
  resultExtent,
  resultLayers,
  resultSources,
  SELECTABLE_LAYERS,
  utilityStyleOf,
} from './lib/result-layers';
export { useProjectsWithPolling, useProjectWithPolling } from './model/polling';
export type { PlantType, Project, ProjectState } from './model/project';
export { archiveAction, getProcessingDurationMs, isProcessing, isProjectId } from './model/project';
export { PlanCanvas } from './ui/plan-canvas';
export { PollingStalledAlert, ProcessingStages } from './ui/processing-stages';
export { ProjectPreview } from './ui/project-preview';
export { ProjectStatusBadge } from './ui/project-status-badge';
