<script setup lang="ts">
import { AlertCircle, CheckCircle2, Circle, Clock3, ShieldCheck, Wrench } from 'lucide-vue-next'
import type { TimelineEvent } from '@cpp-pet/contracts'

defineProps<{ events: TimelineEvent[] }>()
const iconFor = (event: TimelineEvent) => event.kind === 'tool' || event.kind === 'validation'
  ? Wrench : event.kind === 'approval' ? ShieldCheck : event.status === 'failed' ? AlertCircle : event.status === 'completed' ? CheckCircle2 : event.status === 'waiting' ? Clock3 : Circle
</script>

<template>
  <div v-if="events.length" class="run-timeline">
    <article v-for="event in events" :key="event.id" :class="event.status">
      <i><component :is="iconFor(event)" :size="15" /></i>
      <div><strong>{{ event.title }}</strong><span>{{ event.summary }}</span><small v-if="event.data?.toolName">{{ event.data.toolName }}</small></div>
      <time>{{ new Date(event.occurredAt).toLocaleTimeString() }}</time>
    </article>
  </div>
  <div v-else class="panel-empty">暂无 Timeline 事件</div>
</template>
