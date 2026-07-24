<script setup lang="ts">
import { ChevronDown, ChevronRight, FileCode2, FileText } from 'lucide-vue-next'
import { ref } from 'vue'
import type { FileTreeNode } from '@cpp-pet/contracts'

withDefaults(defineProps<{ nodes: FileTreeNode[]; activePath: string | undefined; depth?: number }>(), {
  depth: 0
})
const emit = defineEmits<{ open: [path: string]; menu: [event: MouseEvent, node: FileTreeNode] }>()
const expanded = ref(new Set<string>())
function toggle(node: FileTreeNode) {
  if (node.kind === 'file') emit('open', node.relativePath)
  else if (expanded.value.has(node.relativePath)) expanded.value.delete(node.relativePath)
  else expanded.value.add(node.relativePath)
}
</script>

<template>
  <ul class="file-tree">
    <li v-for="node in nodes" :key="node.relativePath">
      <button
        :class="['tree-row', node.kind, { active: activePath === node.relativePath }]"
        :style="{
          paddingLeft: `${8 + depth * 18}px`,
          '--tree-guide-width': `${depth * 18}px`
        }"
        :title="node.relativePath"
        :aria-expanded="node.kind === 'directory' ? expanded.has(node.relativePath) : undefined"
        @click="toggle(node)"
        @contextmenu.prevent="emit('menu', $event, node)"
      >
        <span class="tree-chevron">
          <ChevronDown v-if="node.kind === 'directory' && expanded.has(node.relativePath)" :size="13" />
          <ChevronRight v-else-if="node.kind === 'directory'" :size="13" />
        </span>
        <FileCode2 v-if="node.kind === 'file' && node.editable" class="tree-file-icon code" :size="14" />
        <FileText v-else-if="node.kind === 'file'" class="tree-file-icon" :size="14" />
        <span class="tree-name">{{ node.name }}</span>
      </button>
      <FileTree
        v-if="node.children && expanded.has(node.relativePath)"
        :nodes="node.children"
        :active-path="activePath"
        :depth="depth + 1"
        @open="emit('open', $event)"
        @menu="(event, item) => emit('menu', event, item)"
      />
    </li>
  </ul>
</template>
