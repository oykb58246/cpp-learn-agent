<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookOpen, CheckCircle2, Info, Lightbulb } from 'lucide-vue-next'
import { featureHelpTopic, featureHelpTopics, type FeatureHelpId } from '../utils/feature-help'

const props = defineProps<{ modelValue: boolean; topicId: FeatureHelpId }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const activeId = ref<FeatureHelpId>(props.topicId)
const active = computed(() => featureHelpTopic(activeId.value))

watch(() => props.topicId, value => { activeId.value = value })
watch(() => props.modelValue, visible => {
  if (visible) activeId.value = props.topicId
})
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="min(860px, calc(100vw - 32px))"
    class="feature-help-dialog"
    title="功能帮助"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="feature-help-layout">
      <nav aria-label="帮助主题">
        <button
          v-for="topic in featureHelpTopics"
          :key="topic.id"
          type="button"
          :class="{ active: activeId === topic.id }"
          @click="activeId = topic.id"
        >
          <span>{{ topic.title }}</span>
          <small>{{ topic.category }}</small>
        </button>
      </nav>
      <article>
        <header>
          <BookOpen :size="20" />
          <div>
            <p>{{ active.category }}</p>
            <h2>{{ active.title }}</h2>
            <span>{{ active.summary }}</span>
          </div>
        </header>
        <section>
          <h3><Lightbulb :size="16" />工作原理</h3>
          <p>{{ active.principle }}</p>
        </section>
        <section>
          <h3><CheckCircle2 :size="16" />使用步骤</h3>
          <ol>
            <li v-for="step in active.steps" :key="step">{{ step }}</li>
          </ol>
        </section>
        <section>
          <h3><Info :size="16" />注意事项</h3>
          <ul>
            <li v-for="note in active.notes" :key="note">{{ note }}</li>
          </ul>
        </section>
      </article>
    </div>
  </el-dialog>
</template>
