/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const FONT_FAMILIES = [
  'Inter', 'Anton', 'Space Grotesk', 'JetBrains Mono', 'Playfair Display', 'Outfit',
  'Bebas Neue', 'Montserrat', 'Oswald', 'Roboto', 'Poppins', 'Lato', 'Open Sans',
  'Raleway', 'Nunito', 'Ubuntu', 'Merriweather', 'Lora', 'Libre Baskerville',
  'Dancing Script', 'Pacifico', 'Shadows Into Light', 'Indie Flower', 'Amatic SC',
  'Caveat', 'Satisfy', 'Courgette', 'Righteous', 'Lobster', 'Fredoka One',
  'Luckiest+Guy', 'Permanent Marker', 'Special Elite', 'Cormorant Garamond', 'Cinzel',
  'Marcellus', 'Alumni Sans Collegiate One', 'Bungee', 'Monoton', 'Press Start 2P',
  'Staatliches', 'Teko', 'Kanit', 'Heebo', 'Arimo', 'Titillium Web', 'Exo 2',
  'Fira Sans', 'Josefin Sans', 'Quicksand', 'Varela Round',
];

export const FILTERS = [
  'none', 'vintage', 'noir', 'warm', 'cool', 'dramatic', 'vivid', 'cinematic',
  'sepia', 'grayscale', 'invert', 'hue-rotate-90', 'hue-rotate-180', 'hue-rotate-270',
  'blur-sm', 'blur-md', 'blur-lg', 'brightness-50', 'brightness-150', 'contrast-50', 'contrast-150',
  'saturate-0', 'saturate-200', 'vignette', 'scanlines', 'film-grain', 'technicolor',
  'kodachrome', 'polaroid', 'instant', 'cross-process', 'bleach-bypass', 'fuji', 'agfa',
  'lofi', '8mm', '16mm', 'crt', 'glitch-static', 'noise', 'dust', 'light-leak',
  'retro', 'cyberpunk', 'vaporwave', 'halftone', 'pixel-art', 'edge-detect', 'emboss',
  'sharpen', 'gaussian', 'midnight', 'sunset', 'aurora', 'sepia-high', 'pop-art',
];

export const TEXT_ANIMATIONS = [
  'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right',
  'scale', 'zoom-in', 'zoom-out', 'blur', 'rotate',
  'typewriter', 'bounce', 'skew', 'reveal-horizontal', 'reveal-vertical',
  'glitch', 'neon-flicker', 'bounce-in', 'elastic-pop', 'jello',
  'swing', 'wobble', 'pulse', 'shake', 'float', 'heartbeat',
  'flip-x', 'flip-y', 'roll-in', 'roll-out', 'spiral-in', 'spiral-out',
  'blur-reveal', 'shimmer', 'rainbow', 'fire', 'ice', 'ghost',
  'shadow-pop', 'stretch-horizontal', 'stretch-vertical', 'squish',
  '3d-rotate', 'wave', 'zigzag', 'confetti', 'explosion', 'implosion',
];

export const getFilterStyle = (filter?: string): string => {
  switch (filter) {
    case 'vintage': return 'sepia(0.5) contrast(1.1) brightness(0.9) saturate(0.8)';
    case 'noir': return 'grayscale(1) contrast(1.5) brightness(0.8)';
    case 'warm': return 'sepia(0.2) saturate(1.4) hue-rotate(-10deg)';
    case 'cool': return 'saturate(1.2) hue-rotate(10deg) brightness(1.1)';
    case 'dramatic': return 'contrast(1.6) brightness(0.9) saturate(0.6)';
    case 'vivid': return 'saturate(2) contrast(1.2) brightness(1.1)';
    case 'cinematic': return 'contrast(1.2) brightness(0.9) saturate(0.9) sepia(0.1)';
    case 'sepia': return 'sepia(1)';
    case 'grayscale': return 'grayscale(1)';
    case 'invert': return 'invert(1)';
    case 'hue-rotate-90': return 'hue-rotate(90deg)';
    case 'hue-rotate-180': return 'hue-rotate(180deg)';
    case 'hue-rotate-270': return 'hue-rotate(270deg)';
    case 'blur-sm': return 'blur(4px)';
    case 'blur-md': return 'blur(8px)';
    case 'blur-lg': return 'blur(16px)';
    case 'brightness-50': return 'brightness(0.5)';
    case 'brightness-150': return 'brightness(1.5)';
    case 'contrast-50': return 'contrast(0.5)';
    case 'contrast-150': return 'contrast(1.5)';
    case 'saturate-0': return 'saturate(0)';
    case 'saturate-200': return 'saturate(2)';
    case 'technicolor': return 'contrast(1.4) saturate(1.8) hue-rotate(-5deg)';
    case 'bleach-bypass': return 'contrast(1.5) saturate(0.4) brightness(1.1)';
    case 'lofi': return 'contrast(1.2) saturate(0.8) sepia(0.2) brightness(1.1)';
    default: return 'none';
  }
};

export const getMotionProps = (animation: string) => {
  switch (animation) {
    case 'slide-up': return { initial: { opacity: 0, y: 100 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -100 } };
    case 'slide-down': return { initial: { opacity: 0, y: -100 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 100 } };
    case 'slide-left': return { initial: { opacity: 0, x: 100 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -100 } };
    case 'slide-right': return { initial: { opacity: 0, x: -100 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 100 } };
    case 'scale': return { initial: { opacity: 0, scale: 0.2 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 2 } };
    case 'zoom-in': return { initial: { opacity: 0, scale: 0 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 3 } };
    case 'zoom-out': return { initial: { opacity: 0, scale: 3 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0 } };
    case 'blur': return { initial: { opacity: 0, filter: 'blur(30px)' }, animate: { opacity: 1, filter: 'blur(0px)' }, exit: { opacity: 0, filter: 'blur(30px)' } };
    case 'rotate': return { initial: { opacity: 0, rotate: -360 }, animate: { opacity: 1, rotate: 0 }, exit: { opacity: 0, rotate: 360 } };
    case 'bounce': return { initial: { opacity: 0, y: -300 }, animate: { opacity: 1, y: 0 }, transition: { type: 'spring' as const, bounce: 0.7 } };
    case 'typewriter': return { initial: { clipPath: 'inset(0 100% 0 0)' }, animate: { clipPath: 'inset(0 0 0 0)' }, transition: { duration: 1.5, ease: 'linear' as const } };
    case 'skew': return { initial: { skewX: 45, opacity: 0 }, animate: { skewX: 0, opacity: 1 }, exit: { skewX: -45, opacity: 0 } };
    case 'glitch': return {
      animate: { x: [0, -5, 5, -2, 2, 0], y: [0, 2, -2, 1, -1, 0], opacity: [1, 0.8, 1, 0.9, 1], filter: ['blur(0px)', 'blur(2px)', 'blur(0px)'] },
      transition: { duration: 0.3, repeat: Infinity },
    };
    case 'pulse': return { animate: { scale: [1, 1.05, 1] }, transition: { duration: 1, repeat: Infinity } };
    case 'float': return { animate: { y: [0, -20, 0] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' as const } };
    case 'shake': return { animate: { x: [-10, 10, -10, 10, 0] }, transition: { duration: 0.4, repeat: Infinity } };
    case 'neon-flicker': return {
      animate: {
        opacity: [1, 0.3, 0.8, 0.2, 1, 0.4, 0.9],
        textShadow: ['0 0 10px #fff, 0 0 20px #fff, 0 0 40px #f0f', '0 0 5px #fff, 0 0 10px #fff, 0 0 20px #f0f', '0 0 10px #fff, 0 0 20px #fff, 0 0 40px #f0f'],
      },
      transition: { duration: 2, repeat: Infinity },
    };
    case 'heartbeat': return { animate: { scale: [1, 1.2, 1, 1.1, 1] }, transition: { duration: 1.5, repeat: Infinity } };
    case 'wobble': return { animate: { rotate: [-5, 5, -5, 5, 0] }, transition: { duration: 1, repeat: Infinity } };
    case 'flip-x': return { initial: { rotateX: 90, opacity: 0 }, animate: { rotateX: 0, opacity: 1 }, exit: { rotateX: -90, opacity: 0 } };
    case 'flip-y': return { initial: { rotateY: 90, opacity: 0 }, animate: { rotateY: 0, opacity: 1 }, exit: { rotateY: -90, opacity: 0 } };
    case 'reveal-horizontal': return { initial: { width: 0 }, animate: { width: 'auto' }, transition: { duration: 0.8, ease: 'circOut' as const } };
    case 'reveal-vertical': return { initial: { height: 0 }, animate: { height: 'auto' }, transition: { duration: 0.8, ease: 'circOut' as const } };
    case 'crossfade': return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.5 } };
    case 'pixelate': return { initial: { filter: 'blur(20px) contrast(200%)' }, animate: { filter: 'blur(0px) contrast(100%)' }, transition: { duration: 0.8 } };
    case 'shimmer': return { animate: { backgroundPosition: ['-200% 0', '200% 0'] }, transition: { duration: 2, repeat: Infinity, ease: 'linear' as const } };
    case 'elastic-pop': return { initial: { scale: 0 }, animate: { scale: 1 }, transition: { type: 'spring' as const, damping: 10, stiffness: 100 } };
    case 'zigzag': return { animate: { x: [0, 20, -20, 20, 0], y: [0, -10, 10, -10, 0] }, transition: { duration: 2, repeat: Infinity } };
    default: return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
  }
};
