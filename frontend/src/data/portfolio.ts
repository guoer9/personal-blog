import { stageIdentity } from './stage'

export interface Profile {
  name: string
  monogram: string
  role: string
  headline: string
  intro: string
  location: string
  availability: string
  principles: Array<{ title: string; body: string }>
}

export interface Resource {
  index: string
  title: string
  description: string
  kind: string
  href: string
}

export const profile: Profile = {
  name: stageIdentity.alias,
  monogram: 'G/',
  role: stageIdentity.role,
  headline: 'Sound\nin motion.',
  intro: '我是陈果，GUOER。做音乐，也用影像记录生活。这里放着我的声音、画面，以及创作过程中留下的笔记。',
  location: 'Shanghai, CN',
  availability: 'Music & moving images',
  principles: [
    {
      title: '从声音开始',
      body: '旋律、节奏和音色，是这里最先展开的表达。',
    },
    {
      title: '把画面留下来',
      body: '用影像保存生活的片段，让声音有时也能被看见。',
    },
    {
      title: '给想法一个形状',
      body: '代码、交互与文字，也是把创作呈现出来的方式。',
    },
  ],
}

export const resources: Resource[] = [
  {
    index: 'A',
    title: 'Archive',
    description: '文章、资料和创作过程中留下的笔记。',
    kind: 'INDEX',
    href: '/writing',
  },
  {
    index: 'B',
    title: 'About this space',
    description: '陈果 / GUOER，音乐、影像与创作。',
    kind: 'NOTE',
    href: '/about',
  },
  {
    index: 'C',
    title: 'Search the notes',
    description: '用一个关键词，找到散落在不同时间里的相关内容。',
    kind: 'QUERY',
    href: '/search',
  },
  {
    index: 'D',
    title: 'Temporary transfer',
    description: '上传文件并分享一个限时取件码。',
    kind: 'SHARE',
    href: '/transfer',
  },
]

export interface NavigationItem {
  label: string
  caption: string
  to: string
  priority: 'primary' | 'secondary'
}

export const navigation: NavigationItem[] = [
  { label: '音乐', caption: 'Music', to: '/works?type=music', priority: 'primary' },
  { label: '影像', caption: 'Films', to: '/works?type=film', priority: 'primary' },
  { label: '关于', caption: 'About', to: '/about', priority: 'primary' },
  { label: '档案', caption: 'Archive', to: '/writing', priority: 'secondary' },
  { label: '代码', caption: 'Code', to: '/works?type=code', priority: 'secondary' },
  { label: '临时传输', caption: 'Transfer', to: '/transfer', priority: 'secondary' },
]
