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

export interface Project {
  number: string
  title: string
  type: string
  description: string
  stack: string[]
  href: string
  external?: boolean
  accent: 'lime' | 'blue' | 'paper'
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
  role: 'Software builder · Writer',
  headline: 'Thinking\nin motion.',
  intro: '我在写代码，也在整理思考。这里记录软件系统、AI 工程与那些值得反复推敲的问题。',
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

export const projects: Project[] = [
  {
    number: '01',
    title: 'Personal Field Notes',
    type: 'Product / 2026',
    description: '一个把长文、作品与技术笔记放在同一套内容系统里的个人站点。前台保持安静，后台保留完整的编辑与发布能力。',
    stack: ['Vue 3', 'FastAPI', 'PostgreSQL'],
    href: '/writing',
    accent: 'lime',
  },
  {
    number: '02',
    title: 'Motion Architecture',
    type: 'Experiment / 2026',
    description: '从滚动、空间与视觉同步中提炼出的轻量 WebGL 动效层。图形跟随阅读，却从不接管阅读。',
    stack: ['Three.js', 'GLSL', 'Vue'],
    href: '/#motion',
    accent: 'blue',
  },
  {
    number: '03',
    title: 'AI Systems Notebook',
    type: 'Research log / Ongoing',
    description: '关于模型推理、vLLM 与工程实践的学习档案。把零散结论变成可以检索、复用的知识。',
    stack: ['vLLM', 'Python', 'Systems'],
    href: '/writing',
    accent: 'paper',
  },
]

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
]

export const navigation = [
  { label: '文章', caption: 'Writing', to: '/writing' },
  { label: '项目', caption: 'Projects', to: '/#projects' },
  { label: '关于', caption: 'About', to: '/about' },
]
