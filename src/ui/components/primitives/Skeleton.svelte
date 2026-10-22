<script lang="ts">
let {
  class: className = '',
  width = '100%',
  height = '1rem',
  radius,
  variant = 'default',
}: {
  class?: string;
  width?: string;
  height?: string;
  radius?: string;
  variant?: 'default' | 'text' | 'circular' | 'rectangular';
} = $props();

function getVariantClasses() {
  switch (variant) {
    case 'text':
      return 'h-4 rounded';
    case 'circular':
      return 'rounded-full';
    case 'rectangular':
      return 'rounded-md';
    default:
      return 'rounded-lg';
  }
}
</script>

<div 
  class="animate-pulse motion-reduce:animate-none bg-md-outline-variant {getVariantClasses()} {className}"
  style="width: {width}; height: {height}; {radius ? `border-radius: ${radius};` : ''}"
></div>
