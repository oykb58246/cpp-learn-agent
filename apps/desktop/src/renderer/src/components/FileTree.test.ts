import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import FileTree from './FileTree.vue'

describe('FileTree', () => {
  it('renders a compact VS Code-style hierarchy without folder glyphs', async () => {
    const html = await renderToString(createSSRApp({
      render: () => h(FileTree, {
        activePath: 'main.cpp',
        depth: 1,
        nodes: [
          {
            name: 'src',
            relativePath: 'src',
            kind: 'directory',
            editable: false,
            modifiedAt: new Date().toISOString(),
            children: []
          },
          {
            name: 'main.cpp',
            relativePath: 'main.cpp',
            kind: 'file',
            editable: true,
            size: 32,
            modifiedAt: new Date().toISOString()
          }
        ]
      })
    }) as never)

    expect(html).toContain('tree-row directory')
    expect(html).toContain('tree-row file active')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('padding-left:26px')
    expect(html).toContain('--tree-guide-width:18px')
    expect(html).toContain('tree-file-icon code')
    expect(html).not.toContain('lucide-folder')
  })
})
