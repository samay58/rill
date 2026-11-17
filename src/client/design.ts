export type AppView = 'today' | 'saved' | 'sources' | 'search' | 'add-source';

export interface NavItem {
  view: AppView;
  label: string;
  icon: 'grid' | 'bookmark' | 'feed' | 'search';
}

export const navItems: NavItem[] = [
  { view: 'today', label: 'Today', icon: 'grid' },
  { view: 'saved', label: 'Saved', icon: 'bookmark' },
  { view: 'sources', label: 'Sources', icon: 'feed' },
  { view: 'search', label: 'Search', icon: 'search' }
];

export const mobileNavItems = navItems.filter((item) => item.view !== 'search');
