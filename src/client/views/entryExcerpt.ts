import type { EntryWithState } from '../../shared/types';
import { entryPreviewText } from '../../shared/entryText';

export function entryExcerpt(entry: EntryWithState, maxChars = 180): string | null {
  return entryPreviewText(entry, maxChars);
}
