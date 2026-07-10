<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vitepress'

const route = useRoute()
const name = ref('')
const email = ref('')
const section = ref('')
const comment = ref('')
const state = ref<'idle' | 'sending' | 'ok' | 'error'>('idle')

async function submit() {
  if (!name.value.trim() || !comment.value.trim()) return
  state.value = 'sending'
  const body = new URLSearchParams({
    'form-name': 'feedback',
    name: name.value,
    email: email.value,
    section: section.value,
    comment: comment.value,
    page: route.path
  })
  try {
    const res = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
    state.value = res.ok ? 'ok' : 'error'
  } catch {
    state.value = 'error'
  }
}
</script>

<template>
  <div class="feedback">
    <h2>Leave feedback</h2>
    <p class="hint">Your comments go straight to the team — no account needed.</p>

    <template v-if="state !== 'ok'">
      <label>
        Name
        <input v-model="name" type="text" autocomplete="name" />
      </label>
      <label>
        Email (optional)
        <input v-model="email" type="email" autocomplete="email" />
      </label>
      <label>
        Which section
        <input v-model="section" type="text" placeholder="e.g. section 10, D-12…" />
      </label>
      <label>
        Comment
        <textarea v-model="comment" rows="5" />
      </label>
      <button :disabled="state === 'sending' || !name.trim() || !comment.trim()" @click="submit">
        {{ state === 'sending' ? 'Sending…' : 'Send feedback' }}
      </button>
      <p v-if="state === 'error'" class="error">
        Could not send — are you viewing the deployed site? (The form only works on Netlify.)
      </p>
    </template>
    <p v-else class="ok">Thanks — feedback received for <code>{{ route.path }}</code>.</p>
  </div>
</template>

<style scoped>
.feedback {
  margin-top: 48px;
  padding: 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}
.feedback h2 {
  margin: 0 0 4px;
  border: none;
  padding: 0;
  font-size: 20px;
}
.hint {
  color: var(--vp-c-text-2);
  margin: 0 0 16px;
  font-size: 14px;
}
label {
  display: block;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 12px;
}
input,
textarea {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 8px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  font-weight: 400;
}
button {
  margin-top: 4px;
  padding: 8px 18px;
  border-radius: 6px;
  background: var(--vp-c-brand-1);
  color: white;
  font-weight: 600;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: var(--vp-c-danger-1);
  font-size: 14px;
  margin-top: 8px;
}
.ok {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
</style>
