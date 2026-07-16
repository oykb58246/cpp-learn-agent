export function createElectronEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides }
  delete environment.ELECTRON_RUN_AS_NODE
  return environment
}
