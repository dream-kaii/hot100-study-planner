# Hot 100 Study Workbench design system

## Product context

A personal Chinese learning workbench for LeetCode Hot 100 practice. The user needs to scan progress quickly, open a problem, read a concise solution, switch between Java and Python, run public examples locally, record mistakes, and return to due reviews. The interface should feel like a focused study tool rather than a marketing site or chat product.

## Visual direction

Use a quiet, editorial workspace with strong hierarchy and generous whitespace. Use slate text and surfaces, indigo for active navigation, green for completed states, orange for due reviews, and red only for errors. Avoid neon gradients, oversized hero type, noisy textures, decorative shards, chat bubbles, and AI-themed sparkle motifs.

## Tokens

```css
:root {
  --bg: #f4f6fa;
  --surface: #ffffff;
  --surface-muted: #eef2f7;
  --ink: #172033;
  --muted: #6b778c;
  --line: #dbe2ec;
  --primary: #4f46e5;
  --primary-soft: #eef0ff;
  --success: #15946a;
  --success-soft: #e8f7f0;
  --warning: #c47716;
  --warning-soft: #fff5df;
  --danger: #c43d4b;
  --danger-soft: #fff0f1;
  --radius-card: 12px;
  --radius-control: 8px;
  --shadow-card: 0 8px 24px rgba(28, 39, 61, 0.06);
  --focus: 0 0 0 3px rgba(79, 70, 229, 0.22);
}
```

- Typography: system `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`; monospace for code.
- Spacing: 4px base, common values 8/12/16/24/32.
- Layout: max-width 1440px, 24px page padding on desktop, 16px on mobile.
- Motion: short 160ms transitions for color, border, and elevation; no continuous decorative animation.
- Accessibility: keyboard focus ring on every interactive control, text labels alongside icons, status colors paired with words.
