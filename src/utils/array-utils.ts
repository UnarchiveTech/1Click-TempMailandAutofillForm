/** Move an item so it appears immediately before the item at targetIndex. */
export function moveItemBefore<T>(
  items: readonly T[],
  sourceIndex: number,
  targetIndex: number
): T[] | null {
  if (
    !Number.isInteger(sourceIndex) ||
    !Number.isInteger(targetIndex) ||
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= items.length ||
    targetIndex >= items.length ||
    sourceIndex === targetIndex
  ) {
    return null;
  }

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  if (moved === undefined) return null;

  const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  next.splice(insertionIndex, 0, moved);
  return next;
}
