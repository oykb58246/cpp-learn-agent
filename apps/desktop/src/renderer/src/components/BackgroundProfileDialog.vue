<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { BookOpenCheck, CircleHelp, Sparkles } from 'lucide-vue-next'
import type { BackgroundStartingPoint } from '@cpp-pet/contracts'
import { useAgentStore } from '../stores/agent'

const props = defineProps<{ modelValue: boolean; required?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>()
const store = useAgentStore()
const startingPoint = ref<BackgroundStartingPoint>('zero-beginner')
const studied = ref<string[]>([])
const focus = ref<string[]>([])
const saving = ref(false)

const categories = computed(() => [...new Set(store.catalog.map(node => node.category))])
const selected = computed(() => new Set(studied.value))

function prerequisiteClosure(id: string, result = new Set<string>()): Set<string> {
  if (result.has(id)) return result
  result.add(id)
  const node = store.catalog.find(item => item.id === id)
  for (const prerequisite of node?.prerequisites ?? []) prerequisiteClosure(prerequisite, result)
  return result
}

function toggleStudied(id: string) {
  if (selected.value.has(id)) {
    const keep = new Set(studied.value.filter(item => item !== id))
    for (const node of store.catalog) {
      if (node.id !== id && prerequisiteClosure(node.id).has(id)) keep.delete(node.id)
    }
    studied.value = [...keep]
    focus.value = focus.value.filter(item => keep.has(item))
    return
  }
  studied.value = [...new Set([...studied.value, ...prerequisiteClosure(id)])]
}

function toggleFocus(id: string) {
  focus.value = focus.value.includes(id) ? focus.value.filter(item => item !== id) : [...focus.value, id]
}

function updateVisible(value: boolean) {
  emit('update:modelValue', value)
}

async function save() {
  saving.value = true
  const result = await store.saveBackground({
    onboardingCompleted: true,
    startingPoint: startingPoint.value,
    studiedConceptIds: startingPoint.value === 'some-experience' ? studied.value : [],
    focusConceptIds: startingPoint.value === 'some-experience' ? focus.value : []
  })
  saving.value = false
  if (!result) return
  emit('update:modelValue', false)
  emit('saved')
}

function syncProfile() {
  if (!store.background) return
  startingPoint.value = store.background.startingPoint
  studied.value = [...store.background.studiedConceptIds]
  focus.value = [...store.background.focusConceptIds]
}

onMounted(async () => {
  await Promise.all([store.refreshAll(), store.loadBackground()])
  syncProfile()
})
watch(() => props.modelValue, value => { if (value) syncProfile() })
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="760"
    class="background-profile-dialog"
    :close-on-click-modal="false"
    :show-close="!required"
    :close-on-press-escape="!required"
    @update:model-value="updateVisible"
  >
    <template #header>
      <div class="dialog-title"><strong>先了解一下你的 C++ 背景</strong><span>这些信息只用于调整助教的解释方式，不代表掌握程度，也不会触发测验。</span></div>
    </template>
    <div class="background-profile-form">
      <button :class="['background-choice', { active: startingPoint === 'zero-beginner' }]" type="button" @click="startingPoint = 'zero-beginner'">
        <CircleHelp :size="20" /><span><strong>零基础</strong><small>从概念定义和最小示例开始解释</small></span>
      </button>
      <button :class="['background-choice', { active: startingPoint === 'some-experience' }]" type="button" @click="startingPoint = 'some-experience'">
        <BookOpenCheck :size="20" /><span><strong>学过一点</strong><small>告诉助教你学过哪些概念，以及哪些想听得更细</small></span>
      </button>
      <template v-if="startingPoint === 'some-experience'">
        <div class="background-hint"><Sparkles :size="16" /><span>勾选一个较后面的概念时，相关前置知识会一并作为已学过处理；未勾选的后续概念会显示为“尚未接触”。</span></div>
        <section v-for="category in categories" :key="category" class="background-concept-group">
          <header><strong>{{ category }}</strong><span>{{ store.catalog.filter(node => node.category === category).length }} 个知识点</span></header>
          <label v-for="node in store.catalog.filter(item => item.category === category)" :key="node.id" class="background-concept-row">
            <input type="checkbox" :checked="selected.has(node.id)" @change="toggleStudied(node.id)">
            <span class="concept-copy"><strong>{{ node.title }}</strong><small>{{ node.prerequisites.length ? `前置：${node.prerequisites.join('、')}` : '基础概念' }}</small></span>
            <button class="focus-toggle" type="button" :class="{ active: focus.includes(node.id) }" @click.prevent="toggleFocus(node.id)">希望重点解释</button>
          </label>
        </section>
      </template>
    </div>
    <template #footer><el-button v-if="!required" @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :loading="saving" @click="save">开始使用</el-button></template>
  </el-dialog>
</template>
