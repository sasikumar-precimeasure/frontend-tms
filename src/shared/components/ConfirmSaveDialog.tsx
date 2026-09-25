// Ported from the sibling asset-management app's own ConfirmSaveDialog, for
// design parity on the Users/Roles edit forms - shown only when editing
// (not creating), asking the user to confirm before the save actually
// dispatches.
interface ConfirmSaveDialogProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmSaveDialog({ visible, onConfirm, onCancel }: ConfirmSaveDialogProps) {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="rounded-xl shadow-xl p-8 w-full max-w-sm mx-4 bg-surface-0 text-surface-900">
        <h2 className="text-lg font-semibold mb-2">Save Changes</h2>
        <p className="text-sm mb-6 text-surface-600">Are you sure you want to save these changes?</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-lg text-sm font-medium border transition border-surface-300 text-surface-700 hover:bg-surface-100"
          >
            No
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-(--primary-color) text-white hover:opacity-90 transition"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
