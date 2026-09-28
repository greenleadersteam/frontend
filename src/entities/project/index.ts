export type { DxfVariant } from './api/download-dxf';
export { downloadProjectDxf } from './api/download-dxf';
export {
  useCreateProjectMutation,
  useDeleteProjectMutation,
  useLazyGetProjectQuery,
  usePutGeoreferenceMutation,
  useRunProjectMutation,
} from './api/project-api';
export type {
  CheckedPlantingsFeatureCollection,
  ExplanationEntry,
  Norm,
  ObstaclesFeatureCollection,
  PlantingFeatureCollection,
  RejectedSitesFeatureCollection,
  Species,
  ZonesFeatureCollection,
} from './api/project-result-api';
export {
  useGetExplanationQuery,
  useGetNormsQuery,
  useGetObstaclesQuery,
  useGetPlantingQuery,
  useGetPlantingsQuery,
  useGetRejectedQuery,
  useGetSpeciesQuery,
  useGetZonesQuery,
  usePutPlantingsMutation,
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
export { DRAWING_FIT_LIMIT_M, drawingTransform } from './lib/drawing-transform';
export { projectFileName } from './lib/file-name';
export { createLocalFrame, type LocalFrame } from './lib/local-frame';
export type { ManualGeoreference } from './lib/manual-georeference';
export { placementOfGeoreference } from './lib/manual-georeference';
export {
  toMapData,
  toMapObstacles,
  toMapPlanting,
  toMapRejected,
  toMapZones,
} from './lib/map-data';
export type { NormBasis } from './lib/norm-basis';
export { checkBasis, normBasis, NOTE_1_CROWN_LIMIT_M } from './lib/norm-basis';
export type { PreparedObstacle, PreparedObstacles } from './lib/obstacle-checks';
export { checksAgainstObstacles, checksFromServer, prepareObstacles } from './lib/obstacle-checks';
export { CROWN_RADIUS_M, isGeographic, pixelsPerMeterAtZoom } from './lib/plan-projection';
export type {
  LawnSummary,
  PlantingCheck,
  PreparedZones,
  ProhibitedZone,
} from './lib/planting-checks';
export {
  allowedArea,
  checksForPlanting,
  lawnArea,
  lawnSummary,
  prepareZones,
  prohibitedArea,
  TOLERANCE_M,
  zoneArea,
} from './lib/planting-checks';
export { plantingLayerDxf } from './lib/planting-dxf';
export type { PlantingStatus } from './lib/planting-status';
export { overlappingCrowns, plantingStatus } from './lib/planting-status';
export type { ResultData, ResultLayerGroup } from './lib/result-layers';
export {
  dimensionLabelsMinZoom,
  editedPlantingFeatures,
  HATCH_IMAGE,
  hatchPattern,
  HEDGE_RULE,
  MANUAL_IMAGE,
  manualDiamond,
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
