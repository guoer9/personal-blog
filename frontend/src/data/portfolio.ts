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
  name: 'GUOER',
  monogram: 'G/',
  role: 'Code · Film · Music',
  headline: 'Thinking\nin motion.',
  intro: '我是小果，也叫 GUOER。写代码，拍下生活，也把一些心情写进音乐。这里收集我的项目、影像、声音与一路留下的思考。',
  location: 'Shanghai, CN',
  availability: 'Building in public',
  principles: [
    {
      title: '先做清楚，再做复杂',
      body: '把问题拆到能被解释、被测试、被维护的尺度，再决定是否需要更复杂的工具。',
    },
    {
      title: '把过程留下来',
      body: '文章是另一种工程产物。它让选择、取舍与失败也能成为下一次工作的起点。',
    },
    {
      title: '视觉服务于内容',
      body: '动效可以制造惊喜，但阅读、导航与信息获取始终应当优先。',
    },
  ],
}

export const resources: Resource[] = [
  {
    index: 'A',
    title: 'Writing archive',
    description: '按时间浏览所有公开文章，从最新思考开始。',
    kind: 'INDEX',
    href: '/writing',
  },
  {
    index: 'B',
    title: 'About this space',
    description: '了解这个博客为何存在，以及我如何看待技术与写作。',
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

export const navigation = [
  { label: '文章', caption: 'Writing', to: '/writing' },
  { label: '作品', caption: 'Works', to: '/works' },
  { label: '资料库', caption: 'Documents', to: '/documents' },
  { label: '关于', caption: 'About', to: '/about' },
]
