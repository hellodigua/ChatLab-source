import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'

export default defineConfig(() => {
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        // 使用系统环境变量
        'process.env.APTABASE_APP_KEY': JSON.stringify(process.env.APTABASE_APP_KEY || ''),
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'electron/main/index.ts'),
            'worker/dbWorker': resolve(__dirname, 'electron/main/worker/dbWorker.ts'),
          },
        },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'electron/preload/index.ts'),
          },
        },
      },
    },
    renderer: {
      resolve: {
        alias: {
          '@': resolve('src/'),
          '~': resolve('src/'),
        },
      },
      plugins: [
        vue(),
        ui({
          ui: {
            colors: {
              primary: 'pink', // 使用自定义 pink 作为主色
              neutral: 'slate',
            },
          },
        }),
        VueI18nPlugin({
          // 指定全局语言包目录
          include: [resolve(__dirname, 'src/i18n/locales/**')],
          // 默认语言
          defaultSFCLang: 'json',
          // 启用组件内 <i18n> 块
          compositionOnly: true,
        }),
      ],
      root: 'src/',
      build: {
        sourcemap: false,
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/index.html'),
          },
        },
      },
      server: {
        host: '0.0.0.0',
        port: 3400,
        hmr: {
          protocol: 'ws',
          host: 'localhost',
          port: 3400,
        },
      },
    },
  }
})
