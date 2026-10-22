// Pure report-row formatting shared by publication and directory maintenance.
// The callers retain ownership of writes, notifications and publication state.
function buildReportRowValues_(storedNamesRaw, assignedRowsRaw, missingTextRaw) {
  const storedNames = Array.isArray(storedNamesRaw) ? storedNamesRaw : [];
  const assignedRows = assignedRowsRaw && typeof assignedRowsRaw === 'object' ? assignedRowsRaw : [];
  const missingText = String(missingTextRaw || 'Пока ещё нет отчёта 🙏');
  return storedNames.map(function(storedNameRaw, index) {
    const storedName = String(storedNameRaw || '').trim();
    const cleanName = stripInitialFromName_(storedName) || storedName;
    const assigned = assignedRows[index] || missingText;
    return [prepareReportForParent_(assigned, storedName, cleanName)];
  });
}
