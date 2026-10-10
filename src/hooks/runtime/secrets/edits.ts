import { isRecord } from '../../../core/text.js';
import { MAX_CHECKED_SIZE, type TargetText } from './target.js';

// Characters the edits of one MultiEdit may scan, counted as they grow the text, so a replay stays far below the
// 10-second hook timeout (ADR-0015).
const MAX_REPLAY_WORK = 50_000_000;

/** One edit as the Edit and MultiEdit tools give it; every field is checked before it is used. */
export type Edit = unknown;

/** Every string the tool call would write into the file: content, new_string, edits and notebook source. */
export function writtenText(toolInput: Readonly<Record<string, unknown>>): string {
  const edits: readonly unknown[] = Array.isArray(toolInput.edits) ? toolInput.edits : [];
  const fields = [
    toolInput.content,
    toolInput.new_string,
    toolInput.new_source,
    ...edits.map((edit) => (isRecord(edit) ? edit.new_string : undefined)),
  ];
  return fields.filter((value): value is string => typeof value === 'string').join('\n');
}

/** The edits of an Edit or MultiEdit call, or null for a call that writes whole text. */
export function editsOf(toolInput: Readonly<Record<string, unknown>>): readonly Edit[] | null {
  if (Array.isArray(toolInput.edits)) return toolInput.edits as readonly unknown[];
  const isEdit = typeof toolInput.old_string === 'string' || typeof toolInput.new_string === 'string';
  return isEdit ? [toolInput] : null;
}

/** Applies one edit as the Edit tool does: the result, or why it cannot. */
function applyEdit(text: string, edit: Edit): TargetText {
  if (!isRecord(edit) || typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') {
    return { cause: 'an edit has no old_string or new_string' };
  }
  if (edit.replace_all !== undefined && typeof edit.replace_all !== 'boolean') {
    return { cause: 'replace_all is not true or false' };
  }
  const search = edit.old_string.replaceAll('\r\n', '\n');
  const replacement = edit.new_string.replaceAll('\r\n', '\n');
  if (search === '') return text === '' ? { text: replacement } : { cause: 'an old_string is empty' };
  if (!text.includes(search)) return { cause: 'an old_string is not in the file' };
  if (edit.replace_all === true) return { text: text.split(search).join(replacement) };
  return { text: text.replace(search, () => replacement) };
}

function oldLength(edit: Edit): number {
  return isRecord(edit) && typeof edit.old_string === 'string' ? edit.old_string.length : 0;
}

/**
 * The text the edits leave behind, or why it cannot be known: early once the text is over the size cap, or the
 * characters the edits scan, counted as they grow the text, are over the work cap.
 */
export function editedText(text: string, edits: readonly Edit[]): TargetText {
  let result: TargetText = { text };
  let work = 0;
  for (const edit of edits) {
    if (!('text' in result)) return result;
    work += result.text.length + oldLength(edit);
    if (work > MAX_REPLAY_WORK) return { cause: 'its edits are too many to replay in time' };
    result = applyEdit(result.text, edit);
    if ('text' in result && result.text.length > MAX_CHECKED_SIZE) {
      return { cause: 'the edited file would be over 1 MB' };
    }
  }
  return result;
}
