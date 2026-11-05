// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Register from './Register.vue'

const state = vi.hoisted(() => ({ register: vi.fn(), isLoggedIn: false, isAdmin: false, userInfo: null }))
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

describe('registration verification', () => {
  beforeEach(() => {
    state.register.mockReset().mockResolvedValue(undefined)
    feedback.showError.mockReset()
    feedback.showSuccess.mockReset()
  })

  it('submits the verification phrase with account details and returns to login', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/register', name: 'Register', component: Register },
        { path: '/login', name: 'Login', component: { template: '<div />' } },
      ],
    })
    await router.push('/register?redirect=%2Fpost%2Ffield-note')
    const wrapper = mount(Register, { global: { plugins: [router], stubs: elementStubs } })

    await wrapper.get('input[placeholder="请输入站长提供的验证内容"]').setValue('测试短语')
    await wrapper.get('input[placeholder="请输入用户名"]').setValue('reader')
    await wrapper.get('input[placeholder="请输入邮箱"]').setValue('reader@example.com')
    await wrapper.get('input[placeholder="请输入密码"]').setValue('reader-password')
    await wrapper.get('input[placeholder="请再次输入密码"]').setValue('reader-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(state.register).toHaveBeenCalledWith({
      verification_phrase: '测试短语',
      username: 'reader',
      email: 'reader@example.com',
      password: 'reader-password',
    })
    expect(router.currentRoute.value.fullPath).toBe('/login?redirect=/post/field-note')
    wrapper.unmount()
  })

  it('renders the verification phrase as a text input so Chinese IME input is preserved', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/register', name: 'Register', component: Register }],
    })
    await router.push('/register')
    const wrapper = mount(Register, { global: { plugins: [router], stubs: elementStubs } })

    expect(wrapper.get('input[placeholder="请输入站长提供的验证内容"]').attributes('type')).toBe('text')
    await wrapper.get('input[placeholder="请输入站长提供的验证内容"]').setValue('组一辈子乐队')
    expect(wrapper.get('input[placeholder="请输入站长提供的验证内容"]').element.value).toBe('组一辈子乐队')
    wrapper.unmount()
  })
})
