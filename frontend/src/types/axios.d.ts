import 'axios'

declare module 'axios' {
  interface AxiosRequestConfig<D = unknown> {
    suppressErrorToast?: boolean
    transferAuthRetried?: boolean
  }

  interface InternalAxiosRequestConfig<D = unknown> {
    suppressErrorToast?: boolean
    transferAuthRetried?: boolean
  }
}
