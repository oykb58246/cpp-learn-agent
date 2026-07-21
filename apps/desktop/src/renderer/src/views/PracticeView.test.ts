import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import PracticeView from './PracticeView.vue'

describe('PracticeView', () => {
  it('renders the OJ practice shell with submission and import affordances', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: {
        learning: {
          practiceCatalog: async () => ({ ok: true, data: { exercises: [], projects: [] } }),
          submitPractice: async () => ({ ok: true, data: null }),
          completePracticeProject: async () => ({ ok: true, data: null }),
          importOjScreenshot: async () => ({ ok: true, data: { status: 'refused', reason: '信息不足' } })
        }
      }
    } })
    const app = createSSRApp({ render: () => h(PracticeView) })
    app.use(createPinia())

    const html = await renderToString(app as never)

    expect(html).toContain('OJ 练习场')
    expect(html).toContain('5 个判题用例')
    expect(html).toContain('导入截图')
    expect(html).toContain('小型项目任务')
  })
})