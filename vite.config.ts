import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
    plugins: [dts({ rollupTypes: true })],
    build: {
        lib: {
            entry: resolve(__dirname, 'src/main.ts'),
            name: 'connect-surreal',
            fileName: 'connect-surreal',
            formats: ['es', 'cjs']
        },
        sourcemap: true,
        target: 'node18',
        rollupOptions: {
            // Externalize dependencies that shouldn't be bundled
            external: [
                'express-session',
                'surrealdb',
                'express',
                /^node:.*/
            ],
            output: {
                preserveModules: false,
                exports: 'auto'
            }
        },
    }
});
