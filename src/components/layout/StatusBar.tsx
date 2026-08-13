import { motion } from 'framer-motion';

/**
 * Global status bar anchored to the bottom of the window.
 *
 * The Studio sync indicator moved to a status dot in the Titlebar (next to the
 * version name). This bar is kept as a slim spacer so existing layout height
 * is unchanged; it renders no content.
 */
export default function StatusBar() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4, ease: 'easeOut' }}
      className="h-8 w-full bg-transparent border-t border-border flex items-center justify-between px-4 shrink-0 z-50 select-none"
    />
  );
}
