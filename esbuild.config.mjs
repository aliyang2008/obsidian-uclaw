import esbuild from 'esbuild'
import process from 'process'

const prod = process.argv[2] === 'production'

const ctx = await esbuild.context({
  entryPoints: ['main.ts'],
  bundle: true,
  outfile: 'main.js',
  platform: 'browser',
  target: 'es2020',
  format: 'cjs',
  external: ['obsidian', 'electron'],
  sourcemap: prod ? false : 'inline',
  minify: prod,
  logLevel: 'info'
})

if (prod) {
  await ctx.rebuild()
  await ctx.dispose()
} else {
  await ctx.watch()
  console.log('👀 监听中...')
}
