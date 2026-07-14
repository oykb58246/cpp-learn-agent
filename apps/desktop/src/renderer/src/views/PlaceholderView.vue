<script setup lang="ts">
import { computed } from 'vue'
import { Bot, CheckCircle2, Circle, Clock3, FileWarning, GraduationCap, Network, Play, Wrench } from 'lucide-vue-next'
const props = defineProps<{ kind: string }>()
const info = computed(() => ({
  knowledge: { title: '知识树', subtitle: '按前置关系管理已学、学习中与待复习知识。', icon: Network },
  practice: { title: '练习中心', subtitle: '知识点练习、错题回补与小型项目任务。', icon: GraduationCap },
  reports: { title: '学习报告', subtitle: '从真实学习事件汇总进度、错误类型与独立完成度。', icon: FileWarning },
  runs: { title: 'Agent 记录', subtitle: '查看意图、计划、工具调用、审批与验证结果。', icon: Bot }
}[props.kind] ?? { title: '模块', subtitle: '结构已预留。', icon: Circle }))
</script>
<template><div class="placeholder-view page-scroll"><section class="page-header"><div><p class="eyebrow">后续模块插槽</p><h1>{{ info.title }}</h1><p>{{ info.subtitle }}</p></div><component :is="info.icon" :size="24" /></section><div v-if="kind === 'runs'" class="timeline-mock"><article><i class="done"><CheckCircle2 :size="16" /></i><div><strong>识别任务意图</strong><span>错误诊断 · 当前文件与编译输出</span></div><time>0.1s</time></article><article><i class="active"><Wrench :size="16" /></i><div><strong>调用本地工具</strong><span>compiler.build · 等待成员 B/C 接入真实能力</span></div><time>进行中</time></article><article><i><Clock3 :size="16" /></i><div><strong>验证与学习记录</strong><span>完成后写入错误本和知识状态</span></div></article></div><div v-else class="module-grid"><section v-for="item in 4" :key="item"><span>0{{ item }}</span><strong>{{ ['基础概念','控制结构','数组与函数','项目实践'][item-1] }}</strong><small>{{ item === 1 ? '已验证' : item === 2 ? '学习中' : '待解锁' }}</small><div class="module-progress"><i :style="{ width: item === 1 ? '100%' : item === 2 ? '55%' : '0%' }" /></div></section></div><p class="mock-note">该页面使用确定性 Mock 验证布局和契约，不代表后续业务已经实现。</p></div></template>
