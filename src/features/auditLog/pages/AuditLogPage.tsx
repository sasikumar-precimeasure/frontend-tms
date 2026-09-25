import { AuditLogCard } from '../components/AuditLogCard';

// Top-level page (left nav: Dashboard / Settings / Users / Audit Log) - a
// read-only viewer over tms-backend's audit_events table. Previously nested
// inside Settings; promoted to its own nav entry since it's not
// per-transformer config.
const AuditLogPage = () => {
  return (
    <div className="min-h-screen bg-surface-100">
      <header className="px-6 py-5 bg-surface-0 border-b border-surface-200">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Administration</p>
        <h1 className="text-xl font-semibold text-surface-900">Audit Log</h1>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6">
        <AuditLogCard />
      </div>
    </div>
  );
};

export default AuditLogPage;
