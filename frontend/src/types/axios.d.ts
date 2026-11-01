import 'axios'

declare module 'axios' {
  interface AxiosRequestConfig<D = unknown> {
    suppressErrorToast?: boolean
  }

  interface InternalAxiosRequestConfig<D = unknown> {
    suppressErrorToast?: boolean
  }
}
