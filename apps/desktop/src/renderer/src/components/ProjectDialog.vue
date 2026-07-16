<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { FileCode2, Folder, Import, Sparkles } from 'lucide-vue-next'
import type { Project, ProjectCreationMode, ProjectDraft, ProjectType } from '@cpp-pet/contracts'
import { useAppStore } from '../stores/app'
import { useWorkspaceStore } from '../stores/workspace'

const props = defineProps<{ modelValue: boolean; initialMode?: ProjectCreationMode }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; created: [project: Project] }>()
const app = useAppStore(); const workspace = useWorkspaceStore()
const mode = ref<ProjectCreationMode>('manual'); const step = ref<'input' | 'preview'>('input'); const draft = ref<ProjectDraft | null>(null); const busy = ref(false)
const form = reactive({ workspaceId: '', name: '', type: 'single-file' as ProjectType, description: '', statement: '' })
const trusted = computed(() => app.workspaces.filter(item => item.trustState === 'trusted'))
watch(() => props.modelValue, value => { if (value) { mode.value = props.initialMode ?? 'manual'; step.value = 'input'; draft.value = null; form.workspaceId = trusted.value[0]?.id ?? '' } })
async function selectRoot() { const item = await app.selectWorkspace(); if (!item) return; const trustedItem = item.trustState === 'trusted' ? item : await app.trustWorkspace(item.id); if (trustedItem) form.workspaceId = trustedItem.id }
async function preview() {
  busy.value = true
  if (mode.value === 'import') draft.value = await workspace.importPreview()
  else draft.value = await workspace.preview({ mode: mode.value, workspaceId: form.workspaceId, name: form.name, type: form.type, description: form.description || undefined, statement: form.statement || undefined })
  if (draft.value) step.value = 'preview'; busy.value = false
}
async function commit() { if (!draft.value) return; busy.value = true; const result = draft.value.mode === 'import' ? await workspace.commitImport(draft.value.draftId) : await workspace.commit(draft.value.draftId); busy.value = false; if (result) { emit('created', result); emit('update:modelValue', false); await app.refreshProjects() } }
</script>

<template>
  <el-dialog :model-value="modelValue" width="720" class="project-dialog" :close-on-click-modal="false" @update:model-value="emit('update:modelValue', $event)">
    <template #header><div class="dialog-title"><strong>{{ step === 'input' ? '建立学习项目' : '确认项目结构' }}</strong><span>{{ step === 'input' ? '选择一种来源，所有写入都限制在授权工作区。' : '检查目标位置和文件后再创建。' }}</span></div></template>
    <div v-if="step === 'input'" class="project-form">
      <div class="segmented">
        <button v-for="item in [{id:'manual',label:'手动',icon:FileCode2},{id:'problem',label:'题目',icon:Sparkles},{id:'description',label:'描述',icon:Folder},{id:'import',label:'导入',icon:Import}]" :key="item.id" :class="{ active: mode === item.id }" @click="mode = item.id as ProjectCreationMode"><component :is="item.icon" :size="16" />{{ item.label }}</button>
      </div>
      <template v-if="mode !== 'import'">
        <label>工作区</label>
        <div class="field-row">
          <el-select v-model="form.workspaceId" placeholder="选择已信任工作区">
            <el-option v-for="item in trusted" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
          <el-button @click="selectRoot">选择目录</el-button>
        </div>
        <label>项目名称</label><el-input v-model="form.name" maxlength="80" placeholder="例如：循环练习" />
        <label>项目结构</label><el-radio-group v-model="form.type"><el-radio-button value="single-file">单文件</el-radio-button><el-radio-button value="multi-file">多文件</el-radio-button><el-radio-button value="cmake">CMake</el-radio-button></el-radio-group>
        <template v-if="mode === 'problem'"><label>题目内容</label><el-input v-model="form.statement" type="textarea" :rows="5" placeholder="粘贴题面、输入输出和样例" /></template>
        <template v-if="mode === 'description'"><label>项目描述</label><el-input v-model="form.description" type="textarea" :rows="4" placeholder="例如：创建一个学生成绩管理程序" /></template>
      </template>
      <div v-else class="import-band"><Import :size="22" /><div><strong>导入已有项目</strong><span>下一步将打开系统目录选择器，只建立索引，不改写目录。</span></div></div>
    </div>
    <div v-else-if="draft" class="draft-preview">
      <div class="preview-path"><Folder :size="18" /><div><span>目标项目</span><strong>{{ draft.name }} · {{ draft.type }}</strong></div></div>
      <ul class="preview-files"><li v-for="file in draft.proposedFiles" :key="file.relativePath"><FileCode2 :size="15" />{{ file.relativePath }}</li><li v-if="!draft.proposedFiles.length"><Folder :size="15" />导入现有目录，不创建新文件</li></ul>
      <p v-for="warning in draft.warnings" :key="warning" class="warning-band">{{ warning }}</p>
    </div>
    <template #footer><el-button v-if="step === 'preview'" @click="step = 'input'">返回</el-button><el-button @click="emit('update:modelValue', false)">取消</el-button><el-button v-if="step === 'input'" type="primary" :loading="busy" :disabled="mode !== 'import' && (!form.workspaceId || !form.name)" @click="preview">预览结构</el-button><el-button v-else type="primary" :loading="busy" @click="commit">确认创建</el-button></template>
  </el-dialog>
</template>
