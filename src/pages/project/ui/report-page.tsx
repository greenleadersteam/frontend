import {
  Alert,
  Button,
  Group,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { type JSX, useDeferredValue, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import {
  allowedArea,
  GEOREFERENCE_CONFIDENCE_LABELS,
  isProjectId,
  lawnArea,
  obstacleLabel,
  PLANT_TYPE_LABELS,
  type PlantingVersion,
  prohibitedArea,
  type Project,
  projectFileName,
  RESULT_COUNT_FORMS,
  type Species,
  useProjectWithPolling,
} from '@/entities/project';
import {
  EditsLoadAlert,
  useEditsLoader,
  usePlantingEdits,
  usePlantingVersions,
  versionLabel,
} from '@/features/edit-plantings';
import { describeAppError, toAppError } from '@/shared/api';
import { currentDataSource, PRODUCT_NAME, projectPath } from '@/shared/config';
import {
  formatCount,
  formatDateTime,
  formatMeters,
  formatNumber,
  formatSquareMeters,
} from '@/shared/lib/format';
import { saveFile } from '@/shared/lib/save-file';
import { XLSX_MIME, xlsxWorkbook } from '@/shared/lib/xlsx';
import { NotFoundScreen, PageLoader } from '@/shared/ui';

import {
  type AppliedNorm,
  appliedNorms,
  defaultReportSelection,
  NORMS_NOT_RECOGNIZED,
  type ReportCheck,
  type ReportPlanting,
  reportPlantings,
} from '../model/report';
import {
  type EditedResult,
  editedResult,
  type LoadedResult,
  plantingChecks,
  resultBase,
  useResultData,
} from '../model/result';
import { CROWN_NOTE } from './check-item';
import { serverManualMethod } from './manual-georeference';
import { normReference } from './norm-reference';
import { editsLine } from './planting-register';
import { checksSheet, hasCrownNote, NO_CHECKS_TEXT, resultText, shortBasis } from './report-checks';
import classes from './report-page.module.css';
import { ReportPlan } from './report-plan';
import { sourceUrl } from './source-link';
import { speciesRows } from './species-register';
import { SpeciesTable } from './species-table';

// Отчёт для согласования: печатная страница, которую браузер сохраняет в PDF без сервера.
export function ProjectReportPage(): JSX.Element {
  const { projectId } = useParams();
  if (!isProjectId(projectId)) return <NotFoundScreen />;
  return <ReportScreen key={projectId} id={projectId} />;
}

type ReportScreenProps = { id: string };

function ReportScreen({ id }: ReportScreenProps): JSX.Element {
  const { data: project, error, notFound } = useProjectWithPolling(id);
  if (notFound) return <NotFoundScreen />;
  if (project === undefined) {
    return error === undefined ? (
      <PageLoader />
    ) : (
      <Text role="alert">{describeAppError(toAppError(error))}</Text>
    );
  }
  if (project.state.kind !== 'ready') {
    return (
      <Stack gap="md" align="flex-start">
        <title>{`Отчёт — ${project.name} — ${PRODUCT_NAME}`}</title>
        <Text>Отчёт доступен, когда обработка проекта завершена.</Text>
        <Button component={Link} to={projectPath(project.id)} variant="default">
          Назад к проекту
        </Button>
      </Stack>
    );
  }
  return <ReportData project={project} />;
}

type ReportDataProps = { project: Project };

function ReportData({ project }: ReportDataProps): JSX.Element {
  const state = useResultData(project);
  switch (state.kind) {
    case 'loading':
      return <ReportSkeleton />;
    case 'error':
      return (
        <Stack gap="md" align="flex-start">
          <Text role="alert">{describeAppError(state.error)}</Text>
          <Button variant="default" loading={state.retrying} onClick={state.retry}>
            Повторить
          </Button>
        </Stack>
      );
    case 'ready':
      return <Report project={project} result={state.result} />;
    default: {
      const unexpected: never = state;
      return unexpected;
    }
  }
}

type ReportProps = { project: Project; result: LoadedResult };

function Report({ project, result }: ReportProps): JSX.Element {
  useEditsLoader(project, result.data.planting);
  const edits = usePlantingEdits(project.id, result.data.planting);
  const versions = usePlantingVersions(project.id);
  const version = versions.list?.find(({ id }) => id === edits.version);
  // Первый кадр — скелет листа, расчёт проверок (у «Олимпийского» — секунды) — следующим
  // рендером: страница сразу показывает раскладку отчёта, а не пустоту.
  const started = useDeferredValue(true, false);
  // Отчёт считается один раз, по загруженным правкам: до них расстановка была бы без правок.
  // Если правки с сервера не загрузились — плашка с «Повторить», а не вечная загрузка.
  if (!edits.loaded || !started) {
    return (
      <>
        <EditsLoadAlert projectId={project.id} />
        <ReportSkeleton />
      </>
    );
  }
  return (
    <ReportComputed
      project={project}
      result={result}
      final={edits.final}
      counts={edits.counts}
      version={version ?? null}
    />
  );
}

type ReportComputedProps = ReportProps & {
  final: ReturnType<typeof usePlantingEdits>['final'];
  counts: ReturnType<typeof usePlantingEdits>['counts'];
  version: PlantingVersion | null;
};

// Проверки по всем посадкам (у «Олимпийского» 7 784) — один раз на результат и правки.
// Компонент без хуков и состояния: React Compiler кеширует расчёт по его входам, а переключатель
// «Все посадки» и готовность плана живут ниже и пересчёта не вызывают.
function ReportComputed({ project, result, final, counts, version }: ReportComputedProps) {
  const base = resultBase(result);
  if (base === null) {
    return <Text>В результате обработки нет посадок и зон запрета.</Text>;
  }
  const computed = editedResult(base, { final });
  const species = new Map(result.species.map((item) => [item.id, item]));
  const plantings = reportPlantings({
    planting: computed.edited.planting,
    statuses: computed.statuses,
    entries: computed.entries,
    species,
    checksOf: (feature) =>
      plantingChecks(feature, computed.entries.get(feature.properties.id), computed),
  });
  return (
    <ReportBody
      project={project}
      computed={computed}
      species={species}
      plantings={plantings}
      selection={defaultReportSelection(plantings)}
      counts={counts}
      version={version}
    />
  );
}

type ReportBodyProps = {
  project: Project;
  computed: EditedResult;
  species: ReadonlyMap<string, Species>;
  plantings: ReportPlanting[];
  selection: ReportPlanting[];
  counts: ReturnType<typeof usePlantingEdits>['counts'];
  version: PlantingVersion | null;
};

function ReportBody({
  project,
  computed,
  species,
  plantings,
  selection,
  counts,
  version,
}: ReportBodyProps): JSX.Element {
  const demo = currentDataSource() === 'demo';
  const [generatedAt] = useState(() => new Date().toISOString());
  // Снимок плана готов (или вместо карты — запасной план): печатать можно.
  const [planReady, setPlanReady] = useState(false);
  // Шапка приложения при печати отчёта не нужна: отчёт — документ. На других страницах
  // шапка с меткой «Демонстрационные данные» печатается (app-layout.module.css).
  useEffect(() => {
    document.documentElement.dataset.print = 'document';
    return () => {
      delete document.documentElement.dataset.print;
    };
  }, []);
  // Полная таблица проверок собирается только по кнопке: у «Олимпийского» это десятки тысяч
  // строк, в отчёте для согласования их не читают. Сборка — секунда и больше на медленной
  // машине, поэтому сначала кадр с кнопкой в загрузке, потом сама книга.
  const [exporting, setExporting] = useState(false);
  const downloadChecks = () => {
    setExporting(true);
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          saveFile(
            new Blob([xlsxWorkbook(checksSheet(plantings))], { type: XLSX_MIME }),
            projectFileName(project.name, ' — проверки по посадкам.xlsx'),
          );
        } finally {
          setExporting(false);
        }
      });
    });
  };

  return (
    <article className={classes.report}>
      <title>{`Отчёт — ${project.name} — ${PRODUCT_NAME}`}</title>
      <Group gap="sm" className={classes.actions}>
        <Button
          loading={!planReady}
          onClick={() => {
            window.print();
          }}
        >
          Печать или сохранение в PDF
        </Button>
        <Button component={Link} to={projectPath(project.id)} variant="default">
          Назад к проекту
        </Button>
      </Group>

      <header className={classes.section}>
        <Text c="dimmed">Отчёт для согласования</Text>
        <Title order={1}>{project.name}</Title>
        {project.description !== null && <Text>{project.description}</Text>}
        {demo && (
          // Отчёт из демо не должен выглядеть как отчёт по объекту.
          <Alert color="ochre" variant="light" className={classes.demo}>
            <Text className={classes.demoTitle}>Демонстрационные данные</Text>
            <Text>
              Отчёт построен на демонстрационных данных и не относится к реальному объекту.
            </Text>
          </Alert>
        )}
        <dl className={classes.facts}>
          <dt>Источник данных</dt>
          <dd>{demo ? 'Демонстрационные данные' : 'Сервер'}</dd>
          <dt>Отчёт сформирован</dt>
          <dd>{formatDateTime(generatedAt)}</dd>
          <dt>Обработка завершена</dt>
          <dd>
            {project.job.finished_at == null
              ? 'нет данных'
              : formatDateTime(project.job.finished_at)}
          </dd>
          {version !== null && (
            <>
              <dt>Версия плана посадок</dt>
              <dd>{versionLabel(version)}</dd>
            </>
          )}
        </dl>
      </header>

      <section className={classes.section} aria-labelledby="report-plan">
        <Title order={2} id="report-plan">
          План
        </Title>
        <ReportPlan
          result={computed}
          editMarks={counts.total > 0}
          onReady={() => {
            setPlanReady(true);
          }}
        />
      </section>

      <Summary result={computed} counts={counts} />

      <section className={classes.section} aria-labelledby="report-species">
        <Title order={2} id="report-species">
          Ведомость озеленения
        </Title>
        <SpeciesTable
          rows={speciesRows(computed.edited.planting, species, computed.entries)}
          className={classes.table}
        />
      </section>

      <section className={classes.section} aria-labelledby="report-norms">
        <Title order={2} id="report-norms">
          Применённые нормы
        </Title>
        <NormsTable norms={appliedNorms(plantings)} />
      </section>

      <section className={classes.section} aria-labelledby="report-checks">
        <Title order={2} id="report-checks">
          Проверки по посадкам
        </Title>
        <Text size="sm" c="dimmed">
          Посадки с правками, нарушениями и предупреждениями и по три посадки с наименьшим запасом
          до каждого вида сетей.
        </Text>
        <Text size="sm" c="dimmed">
          Акт, пункт и причина каждого основания — в разделе «Применённые нормы».
        </Text>
        <ChecksTable plantings={selection} />
        <Group gap="md">
          <Text size="sm" className={classes.numbers}>
            {`В таблице — ${formatCount(selection.length, PLANTING_FORMS)} из ${formatNumber(plantings.length)}. Полная таблица проверок — в Excel.`}
          </Text>
          <Button
            variant="default"
            loading={exporting}
            onClick={downloadChecks}
            className={classes.actions}
          >
            Скачать все проверки (.xlsx)
          </Button>
        </Group>
      </section>

      <NotChecked uncovered={computed.edited.zones.metadata.uncovered_categories} />
      <Georeference project={project} />
    </article>
  );
}

const PLANTING_FORMS = { one: 'посадка', few: 'посадки', many: 'посадок' };

type SummaryProps = {
  result: EditedResult;
  counts: ReturnType<typeof usePlantingEdits>['counts'];
};

function Summary({ result, counts }: SummaryProps): JSX.Element {
  const { edited, prepared, entries } = result;
  const byType = { tree: 0, shrub: 0 };
  const byRule = new Map<string, number>();
  for (const { properties } of edited.planting.features) {
    byType[properties.plant_type] += 1;
    const name =
      properties.origin === 'manual'
        ? 'Добавлены вручную'
        : (entries.get(properties.id)?.rule_name_ru ?? 'Правило не указано');
    byRule.set(name, (byRule.get(name) ?? 0) + 1);
  }
  const lawn = lawnArea(prepared);
  return (
    <section className={classes.section} aria-labelledby="report-summary">
      <Title order={2} id="report-summary">
        Сводка
      </Title>
      <ul className={classes.list}>
        <li>{`${formatCount(byType.tree, RESULT_COUNT_FORMS.trees)}, ${formatCount(byType.shrub, RESULT_COUNT_FORMS.shrubs)}`}</li>
        {[...byRule].map(([name, count]) => (
          <li key={name} className={classes.numbers}>{`${name}: ${formatNumber(count)}`}</li>
        ))}
        <li>{counts.total > 0 ? editsLine(counts) : 'Правок нет: расстановка сервиса'}</li>
        {lawn !== null && <li>{`Газон — ${formatSquareMeters(lawn)}`}</li>}
        {(['tree', 'shrub'] as const).map((plantType) => {
          const allowed = allowedArea(prepared, plantType);
          const label = plantType === 'tree' ? 'деревьев' : 'кустарников';
          return (
            <li key={plantType} className={classes.numbers}>
              {[
                ...(allowed === null
                  ? []
                  : [`Разрешено для ${label} — ${formatSquareMeters(allowed)}`]),
                `зоны запрета для ${label} — ${formatSquareMeters(prohibitedArea(prepared, plantType))}`,
              ].join(', ')}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Основание нормы: акт и пункт или «значение сервиса» с причиной.
function basisText({ basis, norm, citation }: Pick<ReportCheck, 'basis' | 'norm' | 'citation'>) {
  return basis?.basis === 'service_default'
    ? `Значение сервиса. ${basis.reason}.`
    : normReference(norm, citation);
}

type NormsTableProps = { norms: AppliedNorm[] };

function NormsTable({ norms }: NormsTableProps): JSX.Element {
  if (norms.length === 0) return <Text>Ни одна норма отступа не применялась.</Text>;
  return (
    <Table className={classes.table}>
      <Table.Thead className={classes.head}>
        <Table.Tr>
          <Table.Th>Объект</Table.Th>
          <Table.Th>Тип посадки</Table.Th>
          <Table.Th className={classes.numbers}>Отступ</Table.Th>
          <Table.Th>Основание</Table.Th>
          <Table.Th>Источник</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {norms.map((norm) => (
          <Table.Tr key={norm.key} className={classes.row}>
            <Table.Td>{norm.object}</Table.Td>
            <Table.Td>{PLANT_TYPE_LABELS[norm.plantType]}</Table.Td>
            <Table.Td className={classes.numbers}>{formatMeters(norm.required)}</Table.Td>
            <Table.Td>{basisText(norm)}</Table.Td>
            <Table.Td className={classes.source}>
              {sourceUrl(norm.norm?.source_url ?? null) ?? '—'}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// Как в карточке: до объекта — с сантиметрами, через зону — с точностью хорды буфера (1 знак),
// у срезанной зоны — только до её границы.
function measuredText(check: ReportCheck): string {
  switch (check.kind) {
    case 'object':
      return formatMeters(check.actual, 2);
    case 'measured':
      return formatMeters(check.actual, 1);
    case 'boundary':
      return `до границы зоны ${formatMeters(check.margin, 1)}`;
    case 'inside':
      return 'внутри зоны запрета';
    default: {
      const unexpected: never = check;
      return unexpected;
    }
  }
}

type ChecksTableProps = { plantings: ReportPlanting[] };

function ChecksTable({ plantings }: ChecksTableProps): JSX.Element {
  if (plantings.length === 0) return <Text>Посадок для раздела нет.</Text>;
  return (
    <Table className={classes.table}>
      <Table.Thead className={classes.head}>
        <Table.Tr>
          <Table.Th>Посадка</Table.Th>
          <Table.Th>Объект</Table.Th>
          <Table.Th className={classes.numbers}>Фактически</Table.Th>
          <Table.Th className={classes.numbers}>Требуется</Table.Th>
          <Table.Th>Основание</Table.Th>
          <Table.Th>Итог</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {plantings.flatMap((planting) => {
          const title = (
            <Table.Td rowSpan={Math.max(1, planting.checks.length)}>
              <Text size="sm" fw={600}>
                {planting.id}
              </Text>
              <Text size="sm">{PLANT_TYPE_LABELS[planting.plantType]}</Text>
              {planting.changed && <Text size="sm">Правка</Text>}
              {hasCrownNote(planting) && <Text size="sm">{CROWN_NOTE}</Text>}
            </Table.Td>
          );
          if (planting.checks.length === 0) {
            return [
              <Table.Tr key={planting.id} className={classes.row}>
                {title}
                <Table.Td colSpan={5}>{NO_CHECKS_TEXT}</Table.Td>
              </Table.Tr>,
            ];
          }
          return planting.checks.map((check, index) => (
            <Table.Tr key={`${planting.id}|${String(index)}`} className={classes.row}>
              {index === 0 && title}
              <Table.Td>{check.object}</Table.Td>
              <Table.Td className={classes.numbers}>{measuredText(check)}</Table.Td>
              <Table.Td
                className={classes.numbers}
              >{`не менее ${formatMeters(check.required)}`}</Table.Td>
              <Table.Td>{shortBasis(check)}</Table.Td>
              <Table.Td>{resultText(check)}</Table.Td>
            </Table.Tr>
          ));
        })}
      </Table.Tbody>
    </Table>
  );
}

type NotCheckedProps = {
  uncovered: EditedResult['edited']['zones']['metadata']['uncovered_categories'];
};

function NotChecked({ uncovered }: NotCheckedProps): JSX.Element {
  return (
    <section className={classes.section} aria-labelledby="report-unchecked">
      <Title order={2} id="report-unchecked">
        Что не проверялось
      </Title>
      {uncovered.length > 0 && (
        <>
          <Text>Объекты чертежа, для которых в сервисе нет нормы отступа:</Text>
          <ul className={classes.list}>
            {uncovered.map(({ category, subtype }) => (
              <li key={`${category}|${String(subtype)}`}>{obstacleLabel(category, subtype)}</li>
            ))}
          </ul>
        </>
      )}
      <Text>
        {
          'Нормы в сервисе есть, но такие объекты в чертеже пока не распознаются: отступ от них не проверялся. Здания школ и детских садов проверены как прочие здания — 5\u00A0м для дерева вместо 10\u00A0м, край улиц любой категории — как край проезжей части, 2\u00A0м.'
        }
      </Text>
      <Table className={classes.table}>
        <Table.Thead className={classes.head}>
          <Table.Tr>
            <Table.Th>Объект</Table.Th>
            <Table.Th>Норма</Table.Th>
            <Table.Th>Основание</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {NORMS_NOT_RECOGNIZED.map((norm) => (
            <Table.Tr key={norm.object} className={classes.row}>
              <Table.Td>{norm.object}</Table.Td>
              <Table.Td>{norm.values}</Table.Td>
              <Table.Td>{norm.reference}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </section>
  );
}

type GeoreferenceProps = { project: Project };

function Georeference({ project }: GeoreferenceProps): JSX.Element {
  const georeference = project.job.georeference ?? null;
  const residuals = Object.entries(georeference?.residuals_m ?? {});
  return (
    <section className={classes.section} aria-labelledby="report-georeference">
      <Title order={2} id="report-georeference">
        Геопривязка
      </Title>
      {georeference === null ? (
        <Text>
          Без геопривязки: план построен в координатах чертежа, расстояния — в метрах чертежа.
        </Text>
      ) : (
        <>
          {georeference.confidence === 'manual' ? (
            // Привязка из модуля геопривязки, применённая сервером: параметров сервер не возвращает.
            <Text>
              {`Способ: вручную в модуле геопривязки${residuals.length === 0 ? '' : `, ${serverManualMethod(residuals.map(([, value]) => value))}`}; привязку применил сервер. Опорную точку, поворот и масштаб сервер не возвращает.`}
            </Text>
          ) : (
            <>
              <Text>
                {`Способ: по геодезическим пунктам чертежа и каталогу пунктов, привязка ${GEOREFERENCE_CONFIDENCE_LABELS[georeference.confidence] ?? 'без оценки'}.`}
              </Text>
              <Text className={classes.numbers}>
                {`Совпало пунктов: ${formatNumber(georeference.matched_labels.length)}.`}
              </Text>
            </>
          )}
          {residuals.length > 0 && (
            <Table className={classes.table}>
              <Table.Thead className={classes.head}>
                <Table.Tr>
                  <Table.Th>Опорная точка</Table.Th>
                  <Table.Th>Невязка</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {residuals.map(([label, value]) => (
                  <Table.Tr key={label} className={classes.row}>
                    <Table.Td>{label}</Table.Td>
                    <Table.Td className={classes.numbers}>{formatMeters(value)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </>
      )}
    </section>
  );
}

// Скелет листа в раскладке отчёта: кнопки, титул, план и таблицы — на своих местах, пока
// загружается результат и считаются проверки. Раскладка не прыгает, когда приходят данные.
function ReportSkeleton(): JSX.Element {
  return (
    <article className={classes.report} aria-busy="true">
      <Group gap="sm" className={classes.actions}>
        <Skeleton className={classes.skeletonAction} radius="md" />
        <Skeleton className={classes.skeletonAction} radius="md" />
      </Group>
      <div className={classes.section}>
        <Skeleton className={classes.skeletonLine} />
        <Skeleton className={classes.skeletonTitle} />
        <Skeleton className={classes.skeletonLine} />
        <Skeleton className={classes.skeletonLine} />
      </div>
      <div className={classes.section}>
        <Skeleton className={classes.skeletonHeading} />
        <Skeleton className={classes.plan} />
      </div>
      {['species', 'norms', 'checks'].map((section) => (
        <div key={section} className={classes.section}>
          <Skeleton className={classes.skeletonHeading} />
          {['1', '2', '3', '4', '5'].map((row) => (
            <Skeleton key={row} className={classes.skeletonRow} />
          ))}
        </div>
      ))}
      <VisuallyHidden role="status" aria-live="polite">
        Загружаем отчёт…
      </VisuallyHidden>
    </article>
  );
}
