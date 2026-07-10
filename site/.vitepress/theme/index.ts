import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import FeedbackForm from './FeedbackForm.vue'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'doc-after': () => h(FeedbackForm)
    })
}
