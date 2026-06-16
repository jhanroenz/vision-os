<script lang="ts">
  interface Props {
    size?: number;
    animated?: boolean;
    boot?: boolean;
    class?: string;
  }

  let { size = 48, animated = true, boot = false, class: className = '' }: Props = $props();

  const uid = `vos-logo-${crypto.randomUUID().slice(0, 8)}`;
</script>

<svg
  class="visionos-logo {className}"
  class:visionos-logo--animated={animated}
  class:visionos-logo--boot={boot}
  width={size}
  height={size}
  viewBox="0 0 100 100"
  role="img"
  aria-label="VisionOS"
  xmlns="http://www.w3.org/2000/svg"
>
  <defs>
    <radialGradient id="{uid}-glow" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="#b8f7ff" stop-opacity="0.55" />
      <stop offset="45%" stop-color="#2ec8ff" stop-opacity="0.22" />
      <stop offset="100%" stop-color="#0050aa" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="{uid}-node" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="55%" stop-color="#8ee9ff" />
      <stop offset="100%" stop-color="#1aa8ff" stop-opacity="0.8" />
    </radialGradient>
    <filter id="{uid}-blur" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="1.4" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    <filter id="{uid}-halo" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3.5" result="halo" />
      <feMerge>
        <feMergeNode in="halo" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>

  <circle class="visionos-logo-halo" cx="50" cy="50" r="44" fill={`url(#${uid}-glow)`} filter={`url(#${uid}-halo)`} />

  <g class="visionos-logo-wire" filter={`url(#${uid}-blur)`}>
    <circle cx="50" cy="50" r="40" fill="none" stroke="#5fe4ff" stroke-width="0.9" opacity="0.95" />
    <ellipse cx="50" cy="50" rx="40" ry="11" fill="none" stroke="#4ad8ff" stroke-width="0.75" opacity="0.9" />
    <ellipse cx="50" cy="50" rx="40" ry="11" fill="none" stroke="#4ad8ff" stroke-width="0.75" opacity="0.75" transform="rotate(30 50 50)" />
    <ellipse cx="50" cy="50" rx="40" ry="11" fill="none" stroke="#4ad8ff" stroke-width="0.75" opacity="0.75" transform="rotate(60 50 50)" />
    <ellipse cx="50" cy="50" rx="40" ry="11" fill="none" stroke="#4ad8ff" stroke-width="0.75" opacity="0.75" transform="rotate(90 50 50)" />
    <ellipse cx="50" cy="50" rx="40" ry="11" fill="none" stroke="#4ad8ff" stroke-width="0.75" opacity="0.75" transform="rotate(120 50 50)" />
    <ellipse cx="50" cy="50" rx="40" ry="11" fill="none" stroke="#4ad8ff" stroke-width="0.75" opacity="0.75" transform="rotate(150 50 50)" />
    <ellipse cx="50" cy="32" rx="30" ry="8" fill="none" stroke="#67e8ff" stroke-width="0.65" opacity="0.7" />
    <ellipse cx="50" cy="68" rx="30" ry="8" fill="none" stroke="#67e8ff" stroke-width="0.65" opacity="0.7" />
    <ellipse cx="50" cy="24" rx="18" ry="5.5" fill="none" stroke="#8ef0ff" stroke-width="0.55" opacity="0.55" />
    <ellipse cx="50" cy="76" rx="18" ry="5.5" fill="none" stroke="#8ef0ff" stroke-width="0.55" opacity="0.55" />
    <ellipse cx="50" cy="50" rx="11" ry="40" fill="none" stroke="#4ad8ff" stroke-width="0.7" opacity="0.65" />
    <ellipse cx="50" cy="50" rx="11" ry="40" fill="none" stroke="#4ad8ff" stroke-width="0.7" opacity="0.65" transform="rotate(60 50 50)" />
    <ellipse cx="50" cy="50" rx="11" ry="40" fill="none" stroke="#4ad8ff" stroke-width="0.7" opacity="0.65" transform="rotate(120 50 50)" />
  </g>

  <g class="visionos-logo-nodes">
    <circle cx="50" cy="10" r="2.4" fill={`url(#${uid}-node)`} />
    <circle cx="50" cy="90" r="2.4" fill={`url(#${uid}-node)`} />
    <circle cx="10" cy="50" r="2.2" fill={`url(#${uid}-node)`} />
    <circle cx="90" cy="50" r="2.2" fill={`url(#${uid}-node)`} />
    <circle cx="25" cy="25" r="1.9" fill={`url(#${uid}-node)`} opacity="0.95" />
    <circle cx="75" cy="25" r="1.9" fill={`url(#${uid}-node)`} opacity="0.95" />
    <circle cx="25" cy="75" r="1.9" fill={`url(#${uid}-node)`} opacity="0.95" />
    <circle cx="75" cy="75" r="1.9" fill={`url(#${uid}-node)`} opacity="0.95" />
    <circle cx="50" cy="50" r="2.6" fill={`url(#${uid}-node)`} />
    <circle cx="35" cy="50" r="1.6" fill={`url(#${uid}-node)`} opacity="0.9" />
    <circle cx="65" cy="50" r="1.6" fill={`url(#${uid}-node)`} opacity="0.9" />
    <circle cx="50" cy="35" r="1.6" fill={`url(#${uid}-node)`} opacity="0.9" />
    <circle cx="50" cy="65" r="1.6" fill={`url(#${uid}-node)`} opacity="0.9" />
    <circle cx="32" cy="38" r="1.4" fill={`url(#${uid}-node)`} opacity="0.85" />
    <circle cx="68" cy="38" r="1.4" fill={`url(#${uid}-node)`} opacity="0.85" />
    <circle cx="32" cy="62" r="1.4" fill={`url(#${uid}-node)`} opacity="0.85" />
    <circle cx="68" cy="62" r="1.4" fill={`url(#${uid}-node)`} opacity="0.85" />
  </g>
</svg>
