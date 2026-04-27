export type AppView = 'today' | 'saved' | 'sources' | 'search' | 'add-source';

export interface NavItem {
  view: AppView;
  label: string;
  icon: 'grid' | 'bookmark' | 'clock' | 'search';
}

export interface SampleEntry {
  id: string;
  source: string;
  time: string;
  title: string;
  excerpt: string;
  unread: boolean;
  saved: boolean;
}


export const navItems: NavItem[] = [
  { view: 'today', label: 'Today', icon: 'grid' },
  { view: 'saved', label: 'Saved', icon: 'bookmark' },
  { view: 'sources', label: 'Sources', icon: 'clock' },
  { view: 'search', label: 'Search', icon: 'search' }
];

export const mobileNavItems = navItems.filter((item) => item.view !== 'search');

export const sampleEntries: SampleEntry[] = [
  {
    id: 'entry-app-store',
    source: 'Daring Fireball',
    time: '1h',
    title: 'The App Store at 15',
    excerpt: "A reflection on how the economics of mobile software distribution have changed in a decade and a half of the iPhone App Store's existence.",
    unread: true,
    saved: false
  },
  {
    id: 'entry-kyoto',
    source: 'Craig Mod',
    time: '3h',
    title: 'Walking Through Kyoto in April',
    excerpt: 'A gentle account of the narrow streets, shifting light, and small moments that make walking here feel different from anywhere else.',
    unread: true,
    saved: false
  },
  {
    id: 'entry-truth',
    source: 'Stratechery',
    time: '6h',
    title: "Truth, Trust, and the Web",
    excerpt: 'Ben Thompson examines how publishing platforms handle factual claims and what this means for information-based products.',
    unread: true,
    saved: true
  },
  {
    id: 'entry-maier',
    source: 'Kottke.org',
    time: '9h',
    title: 'The Original Photographs of Vivian Maier',
    excerpt: 'A new retrospective gathers the work of the photographer whose prints were discovered after her death.',
    unread: false,
    saved: false
  }
];

export const yesterdayEntries: SampleEntry[] = [
  {
    id: 'entry-browser',
    source: 'The Browser',
    time: 'Yesterday',
    title: 'Notes on Reading Tools, Part II',
    excerpt: "Continuing the company's exploration of browser-native reading affordances and what it means to truly read online.",
    unread: false,
    saved: false
  },
  {
    id: 'entry-defaults',
    source: 'Opt Out Project',
    time: 'Yesterday',
    title: 'Why Defaults Matter More Than You Think',
    excerpt: 'A case study on how subtle product defaults shape behavior over time, and what opting out actually requires.',
    unread: false,
    saved: false
  }
];


export function unreadCount(entries: SampleEntry[] = sampleEntries): number {
  return entries.filter((entry) => entry.unread).length;
}
