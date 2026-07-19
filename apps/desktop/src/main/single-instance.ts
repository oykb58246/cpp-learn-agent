export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: () => void): unknown
}

export function configureSingleInstance(app: SingleInstanceApp, focusExistingWindow: () => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', focusExistingWindow)
  return true
}
