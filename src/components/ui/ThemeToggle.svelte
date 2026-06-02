<script lang="ts">
import Icon from '@/components/icons/Icon.svelte';

let { themeMode = 'system', onThemeChange = () => {} } = $props<{
  themeMode?: 'light' | 'auto' | 'dark';
  onThemeChange?: (mode: 'light' | 'auto' | 'dark') => void;
}>();
</script>

<div class="flex items-center gap-0.5 bg-md-surface-variant rounded-xl p-0.5">
  <!-- Light Mode -->
  <button
    class="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 ease-out {themeMode === 'light' ? 'bg-md-primary text-md-on-primary shadow-sm' : 'text-md-on-surface/50 hover:text-md-on-surface hover:bg-md-outline-variant'} active:scale-95"
    title="Light mode"
    aria-label="Light mode"
    onclick={(e) => { e.stopPropagation(); onThemeChange('light'); }}
  >
    <Icon name="sun" class="w-4 h-4" />
  </button>

  <!-- Auto/System Mode -->
  <button
    class="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 ease-out {themeMode === 'auto' ? 'bg-md-primary text-md-on-primary shadow-sm' : 'text-md-on-surface/50 hover:text-md-on-surface hover:bg-md-outline-variant'} active:scale-95"
    title="System mode"
    aria-label="System mode"
    onclick={(e) => { e.stopPropagation(); onThemeChange('auto'); }}
  >
    <Icon name="monitor" class="w-4 h-4" />
  </button>

  <!-- Dark Mode -->
  <button
    class="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 ease-out {themeMode === 'dark' ? 'bg-md-primary text-md-on-primary shadow-sm' : 'text-md-on-surface/50 hover:text-md-on-surface hover:bg-md-outline-variant'} active:scale-95"
    title="Dark mode"
    aria-label="Dark mode"
    onclick={(e) => { e.stopPropagation(); onThemeChange('dark'); }}
  >
    <Icon name="moon" class="w-4 h-4" />
  </button>
</div>
