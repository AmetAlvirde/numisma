import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/prisma.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});
