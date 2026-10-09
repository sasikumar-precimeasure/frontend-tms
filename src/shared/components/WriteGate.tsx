import type { ReactNode } from 'react';
import { useCanWrite } from '../hooks/usePermissions';
import type { PermissionMenu } from '../hooks/usePermissions';

// Wraps a settings screen that a user may only be allowed to VIEW: without
// write permission on `menu`, every input, select and button inside is
// disabled (a disabled <fieldset> disables all of its form controls) and a
// notice explains why. The backend / gateway service refuse the change too -
// this just stops a read-only user from editing in the first place.
export function WriteGate({ menu, children }: { menu: PermissionMenu; children: ReactNode }) {
  const canWrite = useCanWrite(menu);
  return (
    <>
      {!canWrite && <ReadOnlyNotice menu={menu} />}
      <fieldset disabled={!canWrite} className="min-w-0 space-y-4">
        {children}
      </fieldset>
    </>
  );
}

export function ReadOnlyNotice({ menu }: { menu: PermissionMenu }) {
  return (
    <div className="px-4 py-2.5 rounded-lg bg-surface-100 text-surface-600 text-sm font-medium mb-4">
      View only - your role can see {menu} but not change it. Ask an administrator for write permission.
    </div>
  );
}
