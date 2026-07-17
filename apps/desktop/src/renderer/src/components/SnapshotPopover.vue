<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Camera, Plus, RotateCcw, Trash2, X } from 'lucide-vue-next'
import type { Project, SnapshotManifest } from '@cpp-pet/contracts'

defineProps<{
  snapshots: SnapshotManifest[]
  project?: Project | null
}>()

const emit = defineEmits<{
  close: []
  create: [label: string]
  restore: [snapshotId: string]
  remove: [snapshotId: string]
}>()

const root = ref<HTMLElement | null>(null)
const label = ref('')

function createSnapshot() {
  emit('create', label.value.trim() || '手动快照')
  label.value = ''
}

function closeOnPointerDown(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('[aria-controls="workspace-snapshot-popover"]')) return
  if (!root.value?.contains(target)) emit('close')
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnPointerDown)
  document.addEventListener('keydown', closeOnEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOnPointerDown)
  document.removeEventListener('keydown', closeOnEscape)
})
</script>

<template>
  <section ref="root" class="snapshot-popover" role="dialog" aria-label="项目快照">
    <header>
      <div><Camera :size="17" /><strong>快照</strong></div>
      <button class="icon-command" type="button" title="关闭快照" aria-label="关闭快照" @click="emit('close')"><X :size="15" /></button>
    </header>

    <form class="snapshot-create" @submit.prevent="createSnapshot">
      <input v-model="label" aria-label="快照标签" placeholder="快照标签" />
      <button type="submit"><Plus :size="15" />创建</button>
    </form>

    <div class="snapshot-list">
      <article v-for="item in snapshots" :key="item.id">
        <div><strong>{{ item.label }}</strong><span>{{ item.entries.length }} 个文件 · {{ new Date(item.createdAt).toLocaleString() }}</span></div>
        <button type="button" title="恢复快照" aria-label="恢复快照" @click="emit('restore', item.id)"><RotateCcw :size="15" /></button>
        <button type="button" title="删除快照" aria-label="删除快照" @click="emit('remove', item.id)"><Trash2 :size="15" /></button>
      </article>
      <div v-if="!snapshots.length" class="inspector-empty">保存文件或手动创建快照后，版本记录会显示在这里。</div>
    </div>

    <section v-if="project" class="project-meta">
      <h3>项目</h3>
      <dl>
        <div><dt>类型</dt><dd>{{ project.type }}</dd></div>
        <div><dt>来源</dt><dd>{{ project.creationMode }}</dd></div>
        <div><dt>Root</dt><dd>{{ project.relativeRoot }}</dd></div>
      </dl>
    </section>
  </section>
</template>
