import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import AgentComposer from './AgentComposer.vue'

describe('AgentComposer', () => {
  it('keeps the prompt input and submit command available while a run is cancellable', async () => {
    const app = createSSRApp({
      render: () => h(AgentComposer, { busy: false, cancellable: true })
    })

    const html = await renderToString(app as never)

    expect(html).toContain('<textarea')
    expect(html).toContain('class="icon-command stop"')
    expect(html).toContain('class="primary-command"')
  })
})
