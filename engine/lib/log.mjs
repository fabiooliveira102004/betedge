const START = Date.now();

const pad = (n) => String(n).padStart(2, '0');

function stamp() {
  const s = (Date.now() - START) / 1000;
  return `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
}

export const log = {
  info: (...a) => console.log(`[${stamp()}]`, ...a),
  warn: (...a) => console.warn(`[${stamp()}] AVISO:`, ...a),
  error: (...a) => console.error(`[${stamp()}] ERRO:`, ...a),
  step: (title) => console.log(`\n[${stamp()}] === ${title} ===`),
};
