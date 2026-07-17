<script setup lang="ts">
import { computed } from 'vue'
import { Check, Circle, Sparkles, X } from 'lucide-vue-next'
import { useAppStore } from '../stores/app'
import { useProductTourStore } from '../stores/product-tour'
import { progressForStep } from '../utils/product-tour'

const app = useAppStore()
const tour = useProductTourStore()
const status = computed(() => app.settings.productTourStatus)
const visible = computed(() => status.value === 'pending' || status.value === 'in-progress')
const progress = computed(() => progressForStep(app.settings.productTourStep))
const tasks = [
  { title: '认识主要功能区', detail: '知道首页、工作区、知识树和助教记录分别在哪里' },
  { title: '向 Agent 助教提问', detail: '亲自发送一个问题并读懂回答与下一步建议' },
  { title: '在代码旁继续使用', detail: '了解如何结合项目、文件和选区继续提问' }
]

async function startOrResume() {
  if (status.value === 'in-progress') tour.resume()
  else await tour.start()
}

async function dismissWelcome() {
  await tour.markWelcomeSeen()
}
</script>

<template>
  <section v-if="visible" class="beginner-quick-start" data-tour="quick-start">
    <div v-if="!app.settings.productTourWelcomeSeen" class="beginner-welcome">
      <Sparkles :size="16" />
      <span><strong>第一次使用？从这里开始</strong><small>不用先学会所有按钮，跟着三步亲自试一次即可。</small></span>
      <button class="icon-command" type="button" title="关闭欢迎提示" @click="dismissWelcome"><X :size="14" /></button>
    </div>
    <header>
      <div>
        <span class="beginner-heading-icon"><Sparkles :size="18" /></span>
        <span><h2>五分钟上手 CppPilot</h2><small>完成一次真实助教问答，就知道接下来怎么用</small></span>
      </div>
      <b>{{ progress.completed }} / {{ progress.total }}</b>
    </header>
    <ol>
      <li v-for="(task, index) in tasks" :key="task.title" :class="{ done: progress.completed > index }">
        <Check v-if="progress.completed > index" :size="14" />
        <Circle v-else :size="14" />
        <span><strong>{{ task.title }}</strong><small>{{ task.detail }}</small></span>
      </li>
    </ol>
    <footer>
      <button class="primary-command" type="button" @click="startOrResume">
        <Sparkles :size="15" />{{ status === 'in-progress' ? '继续新手体验' : '开始新手体验' }}
      </button>
      <button class="secondary-command" type="button" @click="tour.dismiss">不再提示</button>
    </footer>
  </section>
</template>
