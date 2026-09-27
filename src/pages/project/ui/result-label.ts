import { RESULT_COUNT_FORMS, resultCounts, type ResultData } from '@/entities/project';
import { formatCount } from '@/shared/lib/format';

// Краткое содержание плана для скринридера: «План посадок: 24 дерева, 12 кустарников, 5 зон запрета».
export function resultLabel(data: ResultData): string {
  const counts = resultCounts(data);
  const parts = [
    formatCount(counts.trees, RESULT_COUNT_FORMS.trees),
    formatCount(counts.shrubs, RESULT_COUNT_FORMS.shrubs),
    formatCount(counts.zones, RESULT_COUNT_FORMS.zones),
  ];
  return `План посадок: ${parts.join(', ')}`;
}
