export const CATALOG_TITLE_MARKUP_MESSAGE = 'Title cannot contain angle brackets';

export function titleContainsMarkup(title: string): boolean {
  return /[<>]/.test(title);
}
