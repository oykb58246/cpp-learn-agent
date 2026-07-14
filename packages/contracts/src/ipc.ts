export const ipc = {
  appBootstrap: 'app:get-bootstrap', appVersion: 'app:get-version', settingsGet: 'settings:get', settingsUpdate: 'settings:update',
  workspaceSelect: 'workspace:select-root', workspaceList: 'workspace:list', workspaceOpen: 'workspace:open',
  workspaceTrust: 'workspace:set-trust', workspaceRemove: 'workspace:remove', workspaceChanged: 'workspace:changed',
  projectPreview: 'project:preview', projectCreate: 'project:create', projectImportPreview: 'project:preview-import',
  projectImport: 'project:import', projectList: 'project:list', projectOpen: 'project:open', projectRemove: 'project:remove',
  filesTree: 'files:list-tree', filesRead: 'files:read', filesWrite: 'files:write', filesCreate: 'files:create',
  filesRename: 'files:rename', filesRemove: 'files:remove', filesSearch: 'files:search',
  filesCopy: 'files:copy', filesMove: 'files:move',
  snapshotCreate: 'snapshots:create', snapshotList: 'snapshots:list', snapshotPreview: 'snapshots:preview-restore',
  snapshotRestore: 'snapshots:restore', snapshotRemove: 'snapshots:remove',
  toolchainDetect: 'toolchain:detect', toolchainProbe: 'toolchain:probe', toolchainList: 'toolchain:list',
  toolchainBind: 'toolchain:bind', toolchainUnbind: 'toolchain:unbind', toolchainHealth: 'toolchain:health',
  compilerBuild: 'compiler:build',
  programRun: 'program:run', programStop: 'program:stop',
  mockDashboard: 'mocks:get-dashboard'
} as const
