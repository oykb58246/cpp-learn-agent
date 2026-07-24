<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { CheckCircle2, CircleAlert, HardDrive, ImagePlus, Loader2, RefreshCw, Search, Send, Timer, UploadCloud, XCircle } from 'lucide-vue-next'
import type { PracticeCatalog, PracticeExercise, PracticeJudgeCaseResult, PracticeOjScreenshotInput, PracticeProjectCompleteResult, PracticeSubmissionResult } from '@cpp-pet/contracts'
import { useAppStore } from '../stores/app'

const app = useAppStore()
const catalog = ref<PracticeCatalog>({ exercises: [], projects: [] })
const loading = ref(false)
const importBusy = ref(false)
const importStage = ref<'analyzing' | 'refreshing'>('analyzing')
const importNotice = ref('')
const selectedExerciseId = ref('')
const searchQuery = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const codeByExercise = ref<Record<string, string>>({})
const submitting = ref(false)
const submission = ref<PracticeSubmissionResult | null>(null)
const submitNotice = ref('')
const projectBusyId = ref('')
const projectNotice = ref<PracticeProjectCompleteResult | null>(null)

const filteredExercises = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return catalog.value.exercises
  return catalog.value.exercises.filter(item =>
    item.title.toLowerCase().includes(q)
    || item.knowledgePoint.toLowerCase().includes(q)
    || (item.statement ?? '').toLowerCase().includes(q)
  )
})

const groupedExercises = computed(() => {
  const groups = new Map<string, PracticeExercise[]>()
  for (const exercise of filteredExercises.value) {
    const list = groups.get(exercise.knowledgePoint) ?? []
    list.push(exercise)
    groups.set(exercise.knowledgePoint, list)
  }
  return [...groups.entries()].map(([knowledgePoint, exercises]) => ({
    knowledgePoint,
    exercises: exercises.sort((a, b) => a.difficulty - b.difficulty || a.title.localeCompare(b.title, 'zh-Hans-CN'))
  }))
})
const selectedExercise = computed(() => {
  const found = filteredExercises.value.find(item => item.id === selectedExerciseId.value)
  return found ?? filteredExercises.value[0] ?? catalog.value.exercises[0]
})
const selectedCode = computed({
  get() {
    const exercise = selectedExercise.value
    if (!exercise) return ''
    return codeByExercise.value[exercise.id] ?? defaultStarterCode(exercise)
  },
  set(value: string) {
    const exercise = selectedExercise.value
    if (exercise) codeByExercise.value[exercise.id] = value
  }
})
const failedCases = computed(() => submission.value?.cases.filter(item => !item.passed) ?? [])
const submissionVerdict = computed(() => submission.value ? verdictFor(submission.value.status) : null)
const totalDurationMs = computed(() => submission.value
  ? submission.value.compile.process.durationMs + submission.value.cases.reduce((total, item) => total + item.durationMs, 0)
  : 0)
const slowestCaseMs = computed(() => Math.max(0, ...(submission.value?.cases.map(item => item.durationMs) ?? [])))
const peakMemoryBytes = computed(() => {
  const values = submission.value?.cases.flatMap(item => item.peakMemoryBytes === undefined ? [] : [item.peakMemoryBytes]) ?? []
  return values.length ? Math.max(...values) : null
})

onMounted(loadCatalog)

async function loadCatalog() {
  loading.value = true
  const result = await window.cppPet.learning.practiceCatalog()
  loading.value = false
  if (!result.ok) {
    app.setError(result.error)
    return
  }
  catalog.value = result.data
  if (!selectedExerciseId.value && result.data.exercises[0]) selectedExerciseId.value = result.data.exercises[0].id
}

function selectExercise(id: string) {
  selectedExerciseId.value = id
  submission.value = null
  submitNotice.value = ''
}

async function submitCurrentExercise() {
  const exercise = selectedExercise.value
  if (!exercise || submitting.value) return
  submitting.value = true
  submitNotice.value = ''
  submission.value = null
  const result = await window.cppPet.learning.submitPractice({
    exerciseId: exercise.id,
    code: selectedCode.value,
    standard: 'c++17',
    userId: 'local-user'
  })
  submitting.value = false
  if (!result.ok) {
    app.setError(result.error)
    submitNotice.value = result.error.message
    return
  }
  submission.value = result.data
}

async function completeProjectTask(taskId: string) {
  if (projectBusyId.value) return
  projectBusyId.value = taskId
  const result = await window.cppPet.learning.completePracticeProject({ taskId, userId: 'local-user' })
  projectBusyId.value = ''
  if (!result.ok) {
    app.setError(result.error)
    return
  }
  projectNotice.value = result.data
}

function chooseOjScreenshot() {
  fileInput.value?.click()
}

async function importOjScreenshot(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    importNotice.value = '只支持 PNG、JPG 或 WEBP 题面截图。'
    return
  }
  importBusy.value = true
  importStage.value = 'analyzing'
  importNotice.value = 'AI 正在分析题面、样例和判题用例…'
  try {
    const previewDataUrl = await readDataUrl(file)
    const size = await readImageSize(previewDataUrl)
    const request: PracticeOjScreenshotInput = {
      previewDataUrl,
      mimeType: file.type as PracticeOjScreenshotInput['mimeType'],
      width: size.width,
      height: size.height
    }
    const result = await window.cppPet.learning.importOjScreenshot(request)
    if (!result.ok) {
      app.setError(result.error)
      importNotice.value = result.error.message
      return
    }
    if (result.data.status === 'refused') {
      importNotice.value = result.data.reason
      return
    }
    importStage.value = 'refreshing'
    importNotice.value = 'AI 分析完成，正在刷新题目列表…'
    searchQuery.value = ''
    await loadCatalog()
    selectExercise(result.data.exercise.id)
    await nextTick()
    document.querySelector<HTMLElement>(`[data-exercise-id="${result.data.exercise.id}"]`)?.scrollIntoView({ block: 'nearest' })
    importNotice.value = `已添加并打开：${result.data.exercise.title}`
  } finally {
    importBusy.value = false
  }
}

function defaultStarterCode(exercise: PracticeExercise): string {
  return exercise.starterCode ?? '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}\n'
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取截图失败。'))
    reader.readAsDataURL(file)
  })
}

function readImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('截图文件不是可识别图片。'))
    image.src = src
  })
}

function caseLabel(index: number) {
  return `#${index + 1}`
}

function verdictFor(status: PracticeSubmissionResult['status']) {
  const labels: Record<PracticeSubmissionResult['status'], { code: string; label: string }> = {
    accepted: { code: 'AC', label: '答案正确' },
    'wrong-answer': { code: 'WA', label: '答案错误' },
    'compile-error': { code: 'CE', label: '编译错误' },
    'runtime-error': { code: 'RE', label: '运行错误' },
    'time-limit-exceeded': { code: 'TLE', label: '超出时间限制' },
    'memory-limit-exceeded': { code: 'MLE', label: '内存分配失败' }
  }
  return labels[status]
}

function caseVerdict(item: PracticeJudgeCaseResult) {
  if (item.timedOut) return { code: 'TLE', label: '超时' }
  if (/bad_alloc|out of memory|cannot allocate memory|not enough memory|memory allocation/i.test(`${item.stderr}\n${item.errorMessage ?? ''}`)) return { code: 'MLE', label: '内存分配失败' }
  if (item.passed) return { code: 'AC', label: '通过' }
  if (item.exitCode !== 0) return { code: 'RE', label: '运行错误' }
  return { code: 'WA', label: '答案不一致' }
}

function formatDuration(durationMs: number) {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(2)} s`
}

function formatMemory(bytes: number | null) {
  if (bytes === null) return '未采样'
  return bytes < 1_024 * 1_024 ? `${Math.ceil(bytes / 1_024)} KB` : `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="practice-view page-scroll">
    <section class="page-header page-header-plain">
      <div>
        <p class="eyebrow">Practice</p>
        <h1>OJ 练习场</h1>
        <p>按知识点组织 C++ 题目，提交后按 5 个判题用例给出 100 分评分。</p>
      </div>
    </section>

    <section class="practice-import-panel">
      <div>
        <UploadCloud :size="18" />
        <span>
          <strong>上传 OJ 题面截图</strong>
          <small>AI 会整理题面、样例和 5 个判题用例；信息不足会拒绝添加。</small>
        </span>
      </div>
      <button class="secondary-command" :disabled="loading" @click="loadCatalog"><RefreshCw :size="15" />刷新</button>
      <button class="primary-command" :disabled="importBusy" @click="chooseOjScreenshot"><ImagePlus :size="15" />{{ importBusy ? '整理中' : '导入截图' }}</button>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="importOjScreenshot" />
      <div v-if="importBusy" class="practice-import-progress" role="status">
        <Loader2 :size="16" class="spin" />
        <span><strong>{{ importStage === 'analyzing' ? 'AI 正在分析题面' : '正在刷新题目列表' }}</strong><small>{{ importStage === 'analyzing' ? '正在提取题意、样例与判题用例' : '导入完成后将自动打开新题目' }}</small></span>
      </div>
      <small v-if="importNotice">{{ importNotice }}</small>
    </section>

    <div v-if="loading" class="h3-state">正在加载练习题库…</div>
    <div v-else class="practice-workbench oj-workbench">
      <aside class="practice-groups">
        <div class="practice-search">
          <Search :size="15" />
          <input v-model="searchQuery" type="search" placeholder="搜索题目 / 知识点" />
        </div>
        <section v-for="group in groupedExercises" :key="group.knowledgePoint">
          <header><strong>{{ group.knowledgePoint }}</strong><span>{{ group.exercises.length }}</span></header>
          <button v-for="exercise in group.exercises" :key="exercise.id" :data-exercise-id="exercise.id" :class="{ active: selectedExercise?.id === exercise.id }" @click="selectExercise(exercise.id)">
            <span>{{ exercise.title }}</span>
            <small>难度 {{ exercise.difficulty }} · {{ exercise.source === 'user' ? '用户导入' : '内置' }}</small>
          </button>
        </section>
        <div v-if="!groupedExercises.length" class="panel-empty">没有匹配的题目</div>
      </aside>

      <main class="practice-detail">
        <template v-if="selectedExercise">
          <header>
            <div>
              <p class="eyebrow">{{ selectedExercise.knowledgePoint }}</p>
              <h2>{{ selectedExercise.title }}</h2>
            </div>
            <b>{{ selectedExercise.judgeCases.length }} 题例 · 100 分</b>
          </header>
          <p>{{ selectedExercise.statement }}</p>
          <section v-if="selectedExercise.constraints.length">
            <h3>约束</h3>
            <ul><li v-for="item in selectedExercise.constraints" :key="item">{{ item }}</li></ul>
          </section>
          <section>
            <h3>样例</h3>
            <div v-for="sample in selectedExercise.samples" :key="`${sample.input}:${sample.output}`" class="practice-sample">
              <pre><strong>输入</strong>{{ sample.input }}</pre>
              <pre><strong>输出</strong>{{ sample.output }}</pre>
            </div>
          </section>
        </template>
        <div v-else class="panel-empty">暂无练习题。</div>
      </main>

      <aside class="practice-judge-panel" v-if="selectedExercise">
        <header>
          <div>
            <strong>代码提交</strong>
            <small>C++17</small>
          </div>
          <button class="primary-command" :disabled="submitting" @click="submitCurrentExercise">
            <Loader2 v-if="submitting" :size="15" class="spin" />
            <Send v-else :size="15" />
            {{ submitting ? '判题中' : '提交' }}
          </button>
        </header>
        <textarea v-model="selectedCode" spellcheck="false" class="practice-editor" />
        <small v-if="submitNotice" class="judge-error"><CircleAlert :size="14" />{{ submitNotice }}</small>

        <section v-if="submission" class="judge-result" :class="submission.passed ? 'accepted' : 'failed'">
          <div class="judge-score">
            <CheckCircle2 v-if="submission.passed" :size="18" />
            <XCircle v-else :size="18" />
            <strong>{{ submission.score }}/{{ submission.totalScore }}</strong>
            <b>{{ submissionVerdict?.code }}</b>
            <span>{{ submissionVerdict?.label }}</span>
          </div>
          <div class="judge-metrics">
            <span><Timer :size="14" /><small>总耗时</small><strong>{{ formatDuration(totalDurationMs) }}</strong></span>
            <span><Timer :size="14" /><small>最慢用例</small><strong>{{ formatDuration(slowestCaseMs) }} / 3.00 s</strong></span>
            <span><HardDrive :size="14" /><small>峰值内存</small><strong>{{ submissionVerdict?.code === 'MLE' ? 'MLE：内存异常' : formatMemory(peakMemoryBytes) }}</strong></span>
          </div>
          <div class="judge-case-grid">
            <article v-for="(item, index) in submission.cases" :key="item.caseId" :class="{ passed: item.passed }">
              <header><b>{{ caseLabel(index) }}</b><span>{{ item.score }}/20</span></header>
              <small>{{ caseVerdict(item).code }}：{{ item.errorMessage || caseVerdict(item).label }}</small>
              <time>{{ formatDuration(item.durationMs) }}</time>
            </article>
          </div>
          <div v-if="submission.status === 'compile-error' && submission.compile.diagnostics.length" class="judge-compile-errors">
            <strong>编译器输出</strong>
            <pre v-for="(diagnostic, index) in submission.compile.diagnostics" :key="`${diagnostic.rawMessage}-${index}`">{{ diagnostic.normalizedMessage }}</pre>
          </div>
          <div v-if="failedCases.length" class="judge-diff-list">
            <article v-for="item in failedCases" :key="`${item.caseId}-diff`">
              <strong>失败用例 {{ item.caseId }}</strong>
              <pre><b>输入</b>{{ item.input }}</pre>
              <pre><b>期望</b>{{ item.expectedOutput }}</pre>
              <pre><b>实际</b>{{ item.actualOutput || item.stderr || '无输出' }}</pre>
            </article>
          </div>
        </section>
      </aside>
    </div>

    <section class="practice-projects">
      <header>
        <div><strong>小型项目任务</strong><span>{{ catalog.projects.length }} 个</span></div>
        <small v-if="projectNotice">已记录 {{ projectNotice.taskId }}，XP +{{ projectNotice.xp }}</small>
      </header>
      <article v-for="project in catalog.projects" :key="project.id">
        <div>
          <strong>{{ project.title }}</strong>
          <small>{{ project.knowledgePoint }} · 难度 {{ project.difficulty }}</small>
        </div>
        <p>{{ project.description }}</p>
        <ul><li v-for="goal in project.goals" :key="goal">{{ goal }}</li></ul>
        <code>{{ project.suggestedFiles.join(' / ') }}</code>
        <button class="secondary-command" :disabled="projectBusyId === project.id" @click="completeProjectTask(project.id)">
          <CheckCircle2 :size="15" />{{ projectBusyId === project.id ? '记录中' : '完成' }}
        </button>
      </article>
    </section>
  </div>
</template>
