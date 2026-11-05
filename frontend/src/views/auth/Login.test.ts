// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.vue'

const state = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn(), isLoggedIn: false, isAdmin: false, userInfo: null }))
const feedback = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/stores/user', () => ({ useUserStore: () => state }))
vi.mock('@/ui/feedback', () => feedback)

const formStub = defineComponent({
  emits: ['submit'],
  setup(_props, { slots, emit, expose }) {
    expose({ validate: async () => true })
    return () => h('form', { onSubmit: (event: Event) => emit('submit', event) }, slots.default?.())
  },
})
const formItemStub = defineComponent({ setup(_props, { slots }) { return () => h('div', slots.default?.()) } })
const inputStub = defineComponent({
  props: { modelValue: { type: String, default: '' }, type: String, placeholder: String, autocomplete: String },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('input', {
      type: props.type || 'text', placeholder: props.placeholder, autocomplete: props.autocomplete,
      value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value),
    })
  },
})
const buttonStub = defineComponent({
  props: { nativeType: String, loading: Boolean },
  setup(props, { slots }) { return () => h('button', { type: props.nativeType || 'button', disabled: props.loading }, slots.default?.()) },
})
const elementStubs = { ElForm: formStub, ElFormItem: formItemStub, ElInput: inputStub, ElButton: buttonStub }

describe('public login', () => {
  beforeEach(() => {
    state.login.mockReset().mockResolvedValue(undefined)
    state.logout.mockReset()
    feedback.showError.mockReset()
    feedback.showSuccess.mockReset()
  })

  it('logs in using only username and password then returns to the requested article', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'Login', component: Login },
        { path: '/register', name: 'Register', component: { template: '<div />' } },
        { path: '/post/:slug', name: 'PostDetail', component: { template: '<div />' } },
        { path: '/', name: 'Home', component: { template: '<div />' } },
      ],
    })
    await router.push('/login?redirect=%2Fpost%2Ffield-note')
    const wrapper = mount(Login, { global: { plugins: [router], stubs: elementStubs } })

    expect(wrapper.find('input[placeholder*="验证"]').exists()).toBe(false)
    await wrapper.get('input[placeholder="用户名或邮箱"]').setValue('reader')
    await wrapper.get('input[placeholder="输入密码"]').setValue('reader-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(state.login).toHaveBeenCalledWith({ username: 'reader', password: 'reader-password' })
    expect(router.currentRoute.value.fullPath).toBe('/post/field-note')
    wrapper.unmount()
  })

  it('does not redirect ordinary members to the admin area', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'Login', component: Login },
        { path: '/register', name: 'Register', component: { template: '<div />' } },
        { path: '/admin', name: 'Admin', component: { template: '<div />' } },
        { path: '/', name: 'Home', component: { template: '<div />' } },
      ],
    })
    await router.push('/login?redirect=%2Fadmin')
    const wrapper = mount(Login, { global: { plugins: [router], stubs: elementStubs } })
    await wrapper.get('input[placeholder="用户名或邮箱"]').setValue('reader')
    await wrapper.get('input[placeholder="输入密码"]').setValue('reader-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/')
    wrapper.unmount()
  })

  it('rejects backslash redirects that can be interpreted as an external URL', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'Login', component: Login },
        { path: '/register', name: 'Register', component: { template: '<div />' } },
        { path: '/', name: 'Home', component: { template: '<div />' } },
        { path: '/:pathMatch(.*)*', name: 'NotFound', component: { template: '<div />' } },
      ],
    })
    await router.push({ name: 'Login', query: { redirect: '/\\outside.example' } })
    const wrapper = mount(Login, { global: { plugins: [router], stubs: elementStubs } })
    await wrapper.get('input[placeholder="用户名或邮箱"]').setValue('reader')
    await wrapper.get('input[placeholder="输入密码"]').setValue('reader-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/')
    wrapper.unmount()
  })
})
