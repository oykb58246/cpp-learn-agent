<script setup lang="ts">
import { ExternalLink, ShieldAlert, X, Check } from 'lucide-vue-next'
import type { Approval } from '@cpp-pet/contracts'

defineProps<{ approval: Approval; busy?: boolean }>()
const emit = defineEmits<{ decide: [decision: 'approved' | 'rejected']; openMain: [] }>()
const displayValue = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
</script>

<template>
  <section class="approval-card">
    <header><ShieldAlert :size="18" /><div><strong>{{ approval.title }}</strong><span>{{ approval.toolName }} · {{ approval.risk }}</span></div></header>
    <p>{{ approval.description }}</p>
    <dl>
      <template v-for="(value, key) in approval.parameterSummary" :key="key"><dt>{{ key }}</dt><dd>{{ displayValue(value) }}</dd></template>
    </dl>
    <pre v-if="approval.diff" class="approval-diff"><code>{{ approval.diff }}</code></pre>
    <button v-if="approval.diff" class="message-open-main" type="button" @click="emit('openMain')"><ExternalLink :size="13" />在主窗口查看 Diff</button>
    <div v-if="approval.sideEffects.length" class="approval-effects"><span v-for="item in approval.sideEffects" :key="item">{{ item }}</span></div>
    <footer>
      <button class="secondary-command" :disabled="busy" @click="emit('decide', 'rejected')"><X :size="14" />拒绝</button>
      <button class="primary-command" :disabled="busy" @click="emit('decide', 'approved')"><Check :size="14" />批准</button>
    </footer>
  </section>
</template>
