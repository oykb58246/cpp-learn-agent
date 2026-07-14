<script setup lang="ts">
import { ChevronDown, ChevronRight, FileCode2, FileText, Folder, FolderOpen } from 'lucide-vue-next'
import { ref } from 'vue'
import type { FileTreeNode } from '@cpp-pet/contracts'

defineProps<{ nodes: FileTreeNode[]; activePath: string | undefined }>()
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
      <button :class="['tree-row', { active: activePath === node.relativePath }]" @click="toggle(node)" @contextmenu.prevent="emit('menu', $event, node)">
        <ChevronDown v-if="node.kind === 'directory' && expanded.has(node.relativePath)" :size="14" />
        <ChevronRight v-else-if="node.kind === 'directory'" :size="14" />
        <span v-else class="tree-indent" />
        <FolderOpen v-if="node.kind === 'directory' && expanded.has(node.relativePath)" :size="16" />
        <Folder v-else-if="node.kind === 'directory'" :size="16" />
        <FileCode2 v-else-if="node.editable" :size="16" />
        <FileText v-else :size="16" />
        <span>{{ node.name }}</span>
      </button>
      <FileTree v-if="node.children && expanded.has(node.relativePath)" :nodes="node.children" :active-path="activePath" @open="emit('open', $event)" @menu="(event, item) => emit('menu', event, item)" />
    </li>
  </ul>
</template>
