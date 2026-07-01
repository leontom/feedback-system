/** Tailwind config for the admin dashboard.
 *  Rebuild the stylesheet after editing public/dashboard.html:  npm run build:css
 */
module.exports = {
  content: ['./public/dashboard.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Open Sauce Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  // Colour classes chosen at runtime from JS lookup maps — kept so purge never drops them.
  safelist: [
    'bg-red-50', 'text-red-700', 'ring-red-600/10',
    'bg-amber-50', 'text-amber-700', 'ring-amber-600/20',
    'bg-blue-50', 'text-blue-700', 'ring-blue-600/10',
    'bg-zinc-100', 'text-zinc-600', 'ring-zinc-500/10',
    'bg-indigo-600', 'bg-amber-500', 'bg-emerald-500', 'bg-zinc-400',
    'text-white', 'ring-indigo-600', 'ring-amber-500', 'ring-emerald-500', 'ring-zinc-400', 'ring-1',
    'animate-spin',
  ],
};
