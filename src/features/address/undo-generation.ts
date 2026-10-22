/**
 * The persisted undo-generation token lives at `@/utils/storage/undo-generation.js`
 * so the import-undo (snapshot layer), the domain-switch undo (settings view)
 * and the delete-undo flows share it across UI contexts. This re-export keeps the feature-level import path
 * stable for the delete/archive flows that predate the move.
 */
export {
  __resetUndoGenerationForTests,
  isUndoCurrent,
  markAddressMutation,
} from '@/utils/storage/undo-generation.js';
