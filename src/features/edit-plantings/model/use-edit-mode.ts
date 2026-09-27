import { useAppDispatch, useAppSelector } from '@/shared/lib/store';

import {
  type EditTool,
  isUnsaved,
  plantingEditsActions as actions,
  selectProjectEdits,
} from './edits';

export type EditMode = {
  // Правки загружены, и черновик не устарел: править можно.
  available: boolean;
  editing: boolean;
  tool: EditTool;
  // Есть правки, которых нет на сервере: выход и уход со страницы спрашивают подтверждение.
  unsaved: boolean;
  setEditing: (editing: boolean) => void;
  setTool: (tool: EditTool) => void;
};

// Режим правки — без исходной расстановки: его читают шапка экрана и карта.
export function useEditMode(projectId: string): EditMode {
  const dispatch = useAppDispatch();
  const entry = useAppSelector((state) => selectProjectEdits(state, projectId));
  return {
    available: entry !== undefined && !entry.readOnly && entry.stale === null,
    editing: entry?.editing ?? false,
    tool: entry?.tool ?? 'select',
    unsaved: entry !== undefined && isUnsaved(entry),
    setEditing: (editing) => {
      dispatch(actions.editingChanged({ projectId, editing }));
    },
    setTool: (tool) => {
      dispatch(actions.toolChanged({ projectId, tool }));
    },
  };
}
