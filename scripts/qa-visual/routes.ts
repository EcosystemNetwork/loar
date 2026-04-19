export type Viewport = { name: string; width: number; height: number };

export const VIEWPORTS: Viewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

export type RouteSpec = {
  path: string;
  name: string;
  waitFor?: string;
  scroll?: boolean;
  skip?: boolean;
};

export const ROUTES: RouteSpec[] = [
  { path: '/', name: 'home', scroll: true },
  { path: '/discover', name: 'discover' },
  { path: '/gallery', name: 'gallery' },
  { path: '/market', name: 'market' },
  { path: '/pricing', name: 'pricing', scroll: true },
  { path: '/create', name: 'create-hub' },
  { path: '/wiki', name: 'wiki' },
  { path: '/editor', name: 'editor' },
  { path: '/activity', name: 'activity' },
  { path: '/dashboard', name: 'dashboard' },
  { path: '/governance', name: 'governance' },
  { path: '/staking', name: 'staking' },
  { path: '/docs', name: 'docs' },
  { path: '/login', name: 'login' },
  { path: '/dmca', name: 'dmca' },
  { path: '/terms', name: 'terms' },
  { path: '/privacy', name: 'privacy' },
];
