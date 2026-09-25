// Visual design ported from the sibling project's asset-management app
// (src/constants/uiStyles.ts's LIGHT_THEME.LISTVIEW / DETAILVIEW) for the
// Users/Roles admin screens specifically, per an explicit design-parity
// request - tms's own data fields are unchanged, only the layout/spacing/
// class shapes below are copied so these screens look the same.
//
// Colors are NOT copied as literal gray-900/white/gray-200 classes (those
// are light-mode-only in the source app) - instead they're mapped onto
// tms's own surface-*/primary token scale, which already flips automatically
// under :root[data-theme='dark'] (see index.css). This keeps the exact same
// visual proportions and structure as the source design while staying
// dark-mode-aware like every other screen in tms; the source app's own dark
// theme values were never part of what was asked to match.
export const ADMIN_UI = {
  LISTVIEW: {
    BODY_BACKGROUND: 'h-full bg-surface-100 flex flex-col p-4',
    PAGE_TITLE: 'font-bold text-surface-900',
    PAGE_TITLE_SIZE: '30px',
    SEARCH_FIELD_LABEL: 'text-base font-semibold text-surface-900',
    SEARCH_FIELD:
      'border-2 rounded-3xl pl-9 pr-3 py-1.75 text-sm w-64 focus:outline-none focus:ring-0 focus:border-primary border-surface-300 bg-surface-0 text-surface-800 placeholder-surface-400',
    DATATABLE_HEADER: 'bg-primary-50 border-surface-200 px-6 py-4 text-left text-base font-bold text-surface-900',
    DATATABLE_BODY: 'bg-surface-0 text-sm text-surface-900',
    DATATABLE_NO_DATA: 'bg-surface-0 text-center py-8 text-surface-500',
  },
  DETAILVIEW: {
    BODY_BACKGROUND: 'min-h-screen bg-surface-100 p-8',
    PAGE_TITLE: 'block text-base font-bold text-surface-900 mb-2',
    FIELD_SUB_TITLE: 'block text-base font-semibold text-surface-900 mb-2 mt-2 ml-1',
    FIELD_SUB_TITLE_SIZE: '22px',
    FIELD_TITLE: 'block text-base font-semibold text-surface-900 mb-2',
    FIELD_TEXT_SIZE: '16px',
    FIELD_TEXT_INPUT:
      'w-full px-4 py-3 border border-surface-300 rounded-lg bg-surface-0 text-surface-900 outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
    ROLES_PERMISSION: 'border border-surface-200 rounded-lg overflow-hidden',
    ROLES_HEADER_ROW: 'grid grid-cols-3 bg-surface-0 font-semibold px-4 py-3 text-surface-900',
    ROLES_SECTION_HEADER: 'bg-surface-0 px-4 py-2 font-bold border-t border-surface-200 text-surface-900',
    ROLES_SECTION_ITEM: 'grid grid-cols-3 px-4 py-3 border-t border-surface-200 items-center text-surface-800',
  },
} as const;
